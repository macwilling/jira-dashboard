/**
 * CRUD for workflows and their children (tasks + notifications).
 *
 * A workflow owns:
 *   - an ordered task list (inline tasks OR references into the task library)
 *   - a set of event-driven notification rules
 *   - an optional approval Slack target that gates dispatch
 *
 * Task definitions (the library) live in task-definitions-store.ts.
 */

import { d1Query } from "@/lib/d1/client";
import type {
  ActionType,
  NotificationButton,
  ReleaseEventType,
  Workflow,
  WorkflowNotification,
  WorkflowTask,
  WorkflowTaskOverrides,
} from "./types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function newId(): string {
  return crypto.randomUUID();
}

function parseJsonObject(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function parseButtons(raw: string | null): NotificationButton[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (b): b is NotificationButton =>
          b && typeof b.label === "string" && typeof b.url === "string",
      )
      .map((b) => ({ label: b.label, url: b.url }));
  } catch {
    return [];
  }
}

function serializeButtons(
  buttons: NotificationButton[] | undefined,
): string | null {
  if (!buttons || buttons.length === 0) return null;
  return JSON.stringify(
    buttons.map((b) => ({ label: b.label, url: b.url })),
  );
}

// ─── Workflow CRUD ────────────────────────────────────────────────────────────

interface WorkflowRow {
  id: string;
  name: string;
  approval_slack_target: string | null;
  created_at: string;
  updated_at: string;
}

function rowToWorkflow(row: WorkflowRow): Workflow {
  return {
    id: row.id,
    name: row.name,
    approvalSlackTarget: row.approval_slack_target,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listWorkflows(): Promise<Workflow[]> {
  const { results } = await d1Query<WorkflowRow>(
    `SELECT * FROM workflow ORDER BY name ASC`,
  );
  return results.map(rowToWorkflow);
}

export async function getWorkflow(id: string): Promise<Workflow | null> {
  const { results } = await d1Query<WorkflowRow>(
    `SELECT * FROM workflow WHERE id = ? LIMIT 1`,
    [id],
  );
  return results[0] ? rowToWorkflow(results[0]) : null;
}

export async function createWorkflow(data: {
  name: string;
  approvalSlackTarget?: string | null;
}): Promise<Workflow> {
  const id = newId();
  const now = new Date().toISOString();
  const target = data.approvalSlackTarget?.trim() || null;

  await d1Query(
    `INSERT INTO workflow (id, name, approval_slack_target, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [id, data.name, target, now, now],
  );

  return {
    id,
    name: data.name,
    approvalSlackTarget: target,
    createdAt: now,
    updatedAt: now,
  };
}

export async function updateWorkflow(
  id: string,
  data: { name?: string; approvalSlackTarget?: string | null },
): Promise<void> {
  const now = new Date().toISOString();
  const sets: string[] = ["updated_at = ?"];
  const params: (string | null)[] = [now];

  if (data.name !== undefined) {
    sets.push("name = ?");
    params.push(data.name);
  }
  if (data.approvalSlackTarget !== undefined) {
    sets.push("approval_slack_target = ?");
    params.push(data.approvalSlackTarget?.trim() || null);
  }
  params.push(id);

  await d1Query(
    `UPDATE workflow SET ${sets.join(", ")} WHERE id = ?`,
    params,
  );
}

export async function deleteWorkflow(id: string): Promise<void> {
  await d1Query(`DELETE FROM workflow WHERE id = ?`, [id]);
}

// ─── Workflow tasks ───────────────────────────────────────────────────────────

interface WorkflowTaskRow {
  id: string;
  workflow_id: string;
  definition_id: string | null;
  label: string;
  description: string | null;
  action_type: string;
  day_offset: number;
  position: number;
  all_day: number;
  start_time: string | null;
  duration_minutes: number;
  action_config: string | null;
  overrides: string | null;
  created_at: string;
  updated_at: string;
}

function rowToWorkflowTask(row: WorkflowTaskRow): WorkflowTask {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    definitionId: row.definition_id,
    label: row.label,
    description: row.description,
    actionType: row.action_type as ActionType,
    dayOffset: row.day_offset,
    position: row.position,
    allDay: row.all_day === 1,
    startTime: row.start_time,
    durationMinutes: row.duration_minutes,
    actionConfig: parseJsonObject(row.action_config),
    overrides: parseJsonObject(row.overrides) as WorkflowTaskOverrides | null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listWorkflowTasks(
  workflowId: string,
): Promise<WorkflowTask[]> {
  const { results } = await d1Query<WorkflowTaskRow>(
    `SELECT * FROM workflow_tasks
      WHERE workflow_id = ?
      ORDER BY position ASC`,
    [workflowId],
  );
  return results.map(rowToWorkflowTask);
}

export interface WorkflowTaskInput {
  definitionId?: string | null;
  label: string;
  description?: string | null;
  actionType: ActionType;
  dayOffset: number;
  allDay?: boolean;
  startTime?: string | null;
  durationMinutes?: number;
  actionConfig?: Record<string, unknown> | null;
  overrides?: WorkflowTaskOverrides | null;
}

/**
 * Replace all tasks for a workflow in one shot. Matches the editor's "Save"
 * UX: on save, the full task list is rewritten, so we don't need delta CRUD.
 */
export async function replaceWorkflowTasks(
  workflowId: string,
  tasks: WorkflowTaskInput[],
): Promise<WorkflowTask[]> {
  await d1Query(
    `DELETE FROM workflow_tasks WHERE workflow_id = ?`,
    [workflowId],
  );
  const now = new Date().toISOString();
  const created: WorkflowTask[] = [];

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const id = newId();
    const actionConfigJson = t.actionConfig
      ? JSON.stringify(t.actionConfig)
      : null;
    const overridesJson = t.overrides ? JSON.stringify(t.overrides) : null;

    await d1Query(
      `INSERT INTO workflow_tasks (
         id, workflow_id, definition_id, label, description, action_type,
         day_offset, position, all_day, start_time, duration_minutes,
         action_config, overrides, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        workflowId,
        t.definitionId ?? null,
        t.label,
        t.description ?? null,
        t.actionType,
        t.dayOffset,
        i,
        t.allDay === false ? 0 : 1,
        t.startTime ?? null,
        t.durationMinutes ?? 30,
        actionConfigJson,
        overridesJson,
        now,
        now,
      ],
    );

    created.push({
      id,
      workflowId,
      definitionId: t.definitionId ?? null,
      label: t.label,
      description: t.description ?? null,
      actionType: t.actionType,
      dayOffset: t.dayOffset,
      position: i,
      allDay: t.allDay !== false,
      startTime: t.startTime ?? null,
      durationMinutes: t.durationMinutes ?? 30,
      actionConfig: t.actionConfig ?? null,
      overrides: t.overrides ?? null,
      createdAt: now,
      updatedAt: now,
    });
  }
  return created;
}

export async function countWorkflowTasksUsingDefinition(
  definitionId: string,
): Promise<number> {
  const { results } = await d1Query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM workflow_tasks WHERE definition_id = ?`,
    [definitionId],
  );
  return results[0]?.n ?? 0;
}

// ─── Workflow notifications ───────────────────────────────────────────────────

interface WorkflowNotificationRow {
  id: string;
  workflow_id: string;
  event_type: string;
  message: string;
  target: string;
  buttons: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

function rowToWorkflowNotification(
  row: WorkflowNotificationRow,
): WorkflowNotification {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    eventType: row.event_type as ReleaseEventType,
    message: row.message,
    target: row.target,
    buttons: parseButtons(row.buttons),
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listWorkflowNotifications(
  workflowId: string,
): Promise<WorkflowNotification[]> {
  const { results } = await d1Query<WorkflowNotificationRow>(
    `SELECT * FROM workflow_notifications
      WHERE workflow_id = ?
      ORDER BY position ASC`,
    [workflowId],
  );
  return results.map(rowToWorkflowNotification);
}

export async function listNotificationsForEvent(
  workflowId: string,
  eventType: ReleaseEventType,
): Promise<WorkflowNotification[]> {
  const { results } = await d1Query<WorkflowNotificationRow>(
    `SELECT * FROM workflow_notifications
      WHERE workflow_id = ? AND event_type = ?
      ORDER BY position ASC`,
    [workflowId, eventType],
  );
  return results.map(rowToWorkflowNotification);
}

export interface WorkflowNotificationInput {
  eventType: ReleaseEventType;
  message: string;
  target: string;
  buttons?: NotificationButton[];
}

export async function replaceWorkflowNotifications(
  workflowId: string,
  notifications: WorkflowNotificationInput[],
): Promise<WorkflowNotification[]> {
  await d1Query(
    `DELETE FROM workflow_notifications WHERE workflow_id = ?`,
    [workflowId],
  );
  const now = new Date().toISOString();
  const created: WorkflowNotification[] = [];

  for (let i = 0; i < notifications.length; i++) {
    const n = notifications[i];
    const id = newId();
    const target = n.target.trim();
    const cleanButtons = (n.buttons ?? []).filter(
      (b) => b.label.trim() && b.url.trim(),
    );
    const buttonsJson = serializeButtons(cleanButtons);

    await d1Query(
      `INSERT INTO workflow_notifications
         (id, workflow_id, event_type, message, target, buttons, position,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, workflowId, n.eventType, n.message, target, buttonsJson, i, now, now],
    );
    created.push({
      id,
      workflowId,
      eventType: n.eventType,
      message: n.message,
      target,
      buttons: cleanButtons,
      position: i,
      createdAt: now,
      updatedAt: now,
    });
  }
  return created;
}
