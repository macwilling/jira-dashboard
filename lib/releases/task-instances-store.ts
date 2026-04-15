/**
 * Storage + materialization for per-release task instances.
 *
 * A task instance is a concrete row derived from (a) a workflow task and (b)
 * a release. The workflow task is a template; the instance is the "live"
 * record with a real due date, status, and external ref. Instances are what
 * the dispatcher reads and what the UI renders.
 *
 * Materialization walks the workflow's task list, resolves library links
 * (locks + overrides), computes due dates from release.releaseDate +
 * dayOffset, and renders merge fields into label/description.
 */

import { d1Query } from "@/lib/d1/client";
import { addDays } from "./matcher";
import { buildMergeContext, renderMergeFields } from "./merge-fields";
import { getTaskDefinitionsById } from "./task-definitions-store";
import { listWorkflowTasks } from "./workflows-store";
import type {
  ActionType,
  ConfigurableField,
  Release,
  ReleaseTaskInstance,
  TaskDefinition,
  TaskInstanceStatus,
  WorkflowTask,
} from "./types";

// ─── Row mapping ──────────────────────────────────────────────────────────────

interface TaskInstanceRow {
  id: string;
  release_id: string;
  workflow_id: string;
  workflow_task_id: string;
  label: string;
  description: string | null;
  action_type: string;
  day_offset: number;
  all_day: number;
  start_time: string | null;
  duration_minutes: number;
  due_date: string | null;
  status: string;
  action_config: string | null;
  external_id: string | null;
  external_url: string | null;
  last_dispatch_error: string | null;
  last_dispatch_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToTaskInstance(row: TaskInstanceRow): ReleaseTaskInstance {
  let actionConfig: Record<string, unknown> | null = null;
  if (row.action_config) {
    try {
      actionConfig = JSON.parse(row.action_config);
    } catch {
      actionConfig = null;
    }
  }
  return {
    id: row.id,
    releaseId: row.release_id,
    workflowId: row.workflow_id,
    workflowTaskId: row.workflow_task_id,
    label: row.label,
    description: row.description,
    actionType: row.action_type as ActionType,
    dayOffset: row.day_offset,
    allDay: row.all_day === 1,
    startTime: row.start_time,
    durationMinutes: row.duration_minutes,
    dueDate: row.due_date,
    status: row.status as TaskInstanceStatus,
    actionConfig,
    externalId: row.external_id,
    externalUrl: row.external_url,
    lastDispatchError: row.last_dispatch_error,
    lastDispatchAt: row.last_dispatch_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function newId(): string {
  return crypto.randomUUID();
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function listTaskInstances(
  releaseId: string,
): Promise<ReleaseTaskInstance[]> {
  const { results } = await d1Query<TaskInstanceRow>(
    `SELECT * FROM release_task_instances
      WHERE release_id = ?
      ORDER BY due_date IS NULL, due_date ASC, rowid ASC`,
    [releaseId],
  );
  return results.map(rowToTaskInstance);
}

export async function getTaskInstance(
  id: string,
): Promise<ReleaseTaskInstance | null> {
  const { results } = await d1Query<TaskInstanceRow>(
    `SELECT * FROM release_task_instances WHERE id = ? LIMIT 1`,
    [id],
  );
  return results[0] ? rowToTaskInstance(results[0]) : null;
}

// ─── Resolution (library defaults + locks + overrides) ────────────────────────

interface ResolvedTask {
  label: string;
  description: string | null;
  actionType: ActionType;
  dayOffset: number;
  allDay: boolean;
  startTime: string | null;
  durationMinutes: number;
  actionConfig: Record<string, unknown> | null;
}

/**
 * Resolve a workflow task against its linked library definition (if any).
 * Fields locked by the definition (i.e. NOT in configurableFields) always
 * use the definition's value. Configurable fields use the workflow task's
 * override when present, else the definition's default.
 *
 * actionType is always locked — swapping it at the use-site would change the
 * kind of resource dispatched, which is never a reasonable override.
 */
function resolveWorkflowTask(
  task: WorkflowTask,
  definition: TaskDefinition | null,
): ResolvedTask {
  if (!task.definitionId || !definition) {
    return {
      label: task.label,
      description: task.description,
      actionType: task.actionType,
      dayOffset: task.dayOffset,
      allDay: task.allDay,
      startTime: task.allDay ? null : task.startTime,
      durationMinutes: task.durationMinutes,
      actionConfig: task.actionConfig,
    };
  }

  const overrides = task.overrides ?? {};
  const canOverride = new Set<ConfigurableField>(definition.configurableFields);
  const pick = <T>(field: ConfigurableField, defValue: T): T =>
    canOverride.has(field) && field in overrides
      ? ((overrides as Record<string, unknown>)[field] as T)
      : defValue;

  const allDay = pick<boolean>("allDay", definition.allDay);
  return {
    label: pick<string>("label", definition.label),
    description: pick<string | null>("description", definition.description),
    actionType: definition.actionType,
    dayOffset: pick<number>("dayOffset", definition.dayOffset),
    allDay,
    startTime: allDay
      ? null
      : pick<string | null>("startTime", definition.startTime),
    durationMinutes: pick<number>(
      "durationMinutes",
      definition.durationMinutes,
    ),
    actionConfig: pick<Record<string, unknown> | null>(
      "actionConfig",
      definition.actionConfig,
    ),
  };
}

// ─── Generation ───────────────────────────────────────────────────────────────

async function insertInstance(
  release: Pick<Release, "id" | "name" | "description" | "releaseDate">,
  workflowId: string,
  workflowTaskId: string,
  resolved: ResolvedTask,
  now: string,
): Promise<ReleaseTaskInstance> {
  const id = newId();
  const dueDate = release.releaseDate
    ? addDays(release.releaseDate, resolved.dayOffset)
    : null;
  const ctx = buildMergeContext(release, dueDate, resolved.dayOffset);
  const label = renderMergeFields(resolved.label, ctx) ?? resolved.label;
  const description = renderMergeFields(resolved.description, ctx);

  await d1Query(
    `INSERT INTO release_task_instances
       (id, release_id, workflow_id, workflow_task_id, label, description,
        action_type, day_offset, all_day, start_time, duration_minutes,
        due_date, status, action_config, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    [
      id,
      release.id,
      workflowId,
      workflowTaskId,
      label,
      description,
      resolved.actionType,
      resolved.dayOffset,
      resolved.allDay ? 1 : 0,
      resolved.allDay ? null : resolved.startTime,
      resolved.durationMinutes,
      dueDate,
      resolved.actionConfig ? JSON.stringify(resolved.actionConfig) : null,
      now,
      now,
    ],
  );

  return {
    id,
    releaseId: release.id,
    workflowId,
    workflowTaskId,
    label,
    description,
    actionType: resolved.actionType,
    dayOffset: resolved.dayOffset,
    allDay: resolved.allDay,
    startTime: resolved.allDay ? null : resolved.startTime,
    durationMinutes: resolved.durationMinutes,
    dueDate,
    status: "pending",
    actionConfig: resolved.actionConfig,
    externalId: null,
    externalUrl: null,
    lastDispatchError: null,
    lastDispatchAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

async function collectResolvedTasks(
  workflowId: string,
): Promise<Array<{ taskId: string; resolved: ResolvedTask }>> {
  const tasks = await listWorkflowTasks(workflowId);
  if (tasks.length === 0) return [];

  const defIds = tasks
    .map((t) => t.definitionId)
    .filter((v): v is string => !!v);
  const definitions = await getTaskDefinitionsById(defIds);

  return tasks.map((task) => {
    const def = task.definitionId
      ? definitions.get(task.definitionId) ?? null
      : null;
    return { taskId: task.id, resolved: resolveWorkflowTask(task, def) };
  });
}

/**
 * Materialize task instances for a release using the given workflow.
 * Idempotent: skips if any instances already exist for this release. Callers
 * that want a fresh set should use `regenerateTaskInstances`.
 */
export async function generateTaskInstances(
  release: Pick<Release, "id" | "name" | "description" | "releaseDate">,
  workflowId: string,
): Promise<ReleaseTaskInstance[]> {
  const { results: existing } = await d1Query<{ id: string }>(
    `SELECT id FROM release_task_instances WHERE release_id = ? LIMIT 1`,
    [release.id],
  );
  if (existing.length > 0) return listTaskInstances(release.id);

  const collected = await collectResolvedTasks(workflowId);
  if (collected.length === 0) return [];

  const now = new Date().toISOString();
  const created: ReleaseTaskInstance[] = [];
  for (const { taskId, resolved } of collected) {
    created.push(
      await insertInstance(release, workflowId, taskId, resolved, now),
    );
  }
  return created;
}

/**
 * Replace non-dispatched task instances with a fresh set from the workflow.
 * Preserves any rows with an external_id so we don't orphan live Google
 * resources. Used when the release name / workflow changes before approval.
 */
export async function regenerateTaskInstances(
  release: Pick<Release, "id" | "name" | "description" | "releaseDate">,
  workflowId: string,
): Promise<ReleaseTaskInstance[]> {
  await d1Query(
    `DELETE FROM release_task_instances
      WHERE release_id = ? AND external_id IS NULL`,
    [release.id],
  );

  const collected = await collectResolvedTasks(workflowId);
  if (collected.length === 0) return listTaskInstances(release.id);

  const now = new Date().toISOString();
  const created: ReleaseTaskInstance[] = [];
  for (const { taskId, resolved } of collected) {
    created.push(
      await insertInstance(release, workflowId, taskId, resolved, now),
    );
  }
  return created;
}

/**
 * Delete all non-dispatched instances for a release. Used during
 * category-change resolution when the user chooses "discard" or
 * "switch_workflow" (the caller is responsible for deleting remote resources
 * for dispatched ones before/after calling this).
 */
export async function clearNonDispatchedInstances(
  releaseId: string,
): Promise<void> {
  await d1Query(
    `DELETE FROM release_task_instances
      WHERE release_id = ? AND external_id IS NULL`,
    [releaseId],
  );
}

// ─── Instance mutations (used by dispatcher, UI, resolution) ──────────────────

export async function updateTaskInstanceStatus(
  id: string,
  status: TaskInstanceStatus,
): Promise<void> {
  await d1Query(
    `UPDATE release_task_instances SET status = ?, updated_at = ? WHERE id = ?`,
    [status, new Date().toISOString(), id],
  );
}

export async function setTaskInstanceExternalRef(
  id: string,
  externalId: string,
  externalUrl: string,
): Promise<void> {
  const now = new Date().toISOString();
  await d1Query(
    `UPDATE release_task_instances
        SET external_id = ?, external_url = ?, last_dispatch_error = NULL,
            last_dispatch_at = ?, updated_at = ?
      WHERE id = ?`,
    [externalId, externalUrl, now, now, id],
  );
}

export async function setTaskInstanceDispatchError(
  id: string,
  error: string,
): Promise<void> {
  const now = new Date().toISOString();
  await d1Query(
    `UPDATE release_task_instances
        SET last_dispatch_error = ?, last_dispatch_at = ?, updated_at = ?
      WHERE id = ?`,
    [error, now, now, id],
  );
}

export async function clearTaskInstanceDispatchError(
  id: string,
): Promise<void> {
  const now = new Date().toISOString();
  await d1Query(
    `UPDATE release_task_instances
        SET last_dispatch_error = NULL, last_dispatch_at = ?, updated_at = ?
      WHERE id = ?`,
    [now, now, id],
  );
}

/**
 * Clear external_id/url and reset status to pending. Used when the remote
 * resource was deleted and we want a retry to recreate it.
 */
export async function clearTaskInstanceExternalRef(
  id: string,
): Promise<void> {
  const now = new Date().toISOString();
  await d1Query(
    `UPDATE release_task_instances
        SET external_id = NULL, external_url = NULL, status = 'pending',
            updated_at = ?
      WHERE id = ?`,
    [now, id],
  );
}

export async function setTaskInstanceDueDate(
  id: string,
  dueDate: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  await d1Query(
    `UPDATE release_task_instances
        SET due_date = ?, updated_at = ?
      WHERE id = ?`,
    [dueDate, now, id],
  );
}

/**
 * Count task instances by dispatch state, for resolution-snapshot previews.
 */
export async function countInstancesByState(
  releaseId: string,
): Promise<{ pending: number; dispatched: number; completed: number }> {
  const { results } = await d1Query<{
    pending: number;
    dispatched: number;
    completed: number;
  }>(
    `SELECT
       SUM(CASE WHEN external_id IS NULL AND status = 'pending' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN external_id IS NOT NULL AND status != 'done' THEN 1 ELSE 0 END) AS dispatched,
       SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS completed
      FROM release_task_instances
      WHERE release_id = ?`,
    [releaseId],
  );
  const row = results[0];
  return {
    pending: row?.pending ?? 0,
    dispatched: row?.dispatched ?? 0,
    completed: row?.completed ?? 0,
  };
}
