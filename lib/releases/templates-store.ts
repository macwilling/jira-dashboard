import { d1Query } from "@/lib/d1/client";
import { addDays, matchTemplate } from "./matcher";
import { buildMergeContext, renderMergeFields } from "./merge-fields";
import type {
  Release,
  ReleaseTemplate,
  ReleaseTemplateTask,
  ReleaseTaskInstance,
  ActionType,
  ReleaseType,
  TaskInstanceStatus,
} from "./types";

// ─── Row shapes ────────────────────────────────────────────────────────────────

interface TemplateRow {
  id: string;
  name: string;
  platform_prefix: string | null;   // legacy single-value column, kept for safety
  release_type: string | null;      // legacy single-value column, kept for safety
  platform_prefixes: string | null; // JSON array, e.g. '["web","android"]'
  release_types: string | null;     // JSON array, e.g. '["minor","major"]'
  priority: number;
  created_at: string;
  updated_at: string;
}

interface TemplateTaskRow {
  id: string;
  template_id: string;
  label: string;
  description: string | null;
  action_type: string;
  day_offset: number;
  all_day: number;
  start_time: string | null;
  duration_minutes: number;
  position: number;
  action_config: string | null;
  created_at: string;
  updated_at: string;
}

interface TaskInstanceRow {
  id: string;
  release_id: string;
  template_task_id: string;
  template_id: string;
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

// ─── Mappers ───────────────────────────────────────────────────────────────────

function parseJsonStringArray(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const filtered = parsed.filter((v): v is string => typeof v === "string" && v.length > 0);
    return filtered.length > 0 ? filtered : null;
  } catch {
    return null;
  }
}

function rowToTemplate(row: TemplateRow): ReleaseTemplate {
  // Prefer the new JSON array columns; fall back to legacy single-value columns
  // for rows that existed before migration 0006 ran.
  const platformPrefixes =
    parseJsonStringArray(row.platform_prefixes) ??
    (row.platform_prefix ? [row.platform_prefix] : null);
  const releaseTypes =
    (parseJsonStringArray(row.release_types) as ReleaseType[] | null) ??
    (row.release_type ? [row.release_type as ReleaseType] : null);

  return {
    id: row.id,
    name: row.name,
    platformPrefixes,
    releaseTypes,
    priority: row.priority,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToTemplateTask(row: TemplateTaskRow): ReleaseTemplateTask {
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
    templateId: row.template_id,
    label: row.label,
    description: row.description,
    actionType: row.action_type as ActionType,
    dayOffset: row.day_offset,
    allDay: row.all_day === 1,
    startTime: row.start_time,
    durationMinutes: row.duration_minutes,
    position: row.position,
    actionConfig,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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
    templateTaskId: row.template_task_id,
    templateId: row.template_id,
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

// ─── Templates ─────────────────────────────────────────────────────────────────

export async function listTemplates(): Promise<ReleaseTemplate[]> {
  const { results } = await d1Query<TemplateRow>(
    `SELECT * FROM release_templates ORDER BY priority ASC, created_at ASC`
  );
  return results.map(rowToTemplate);
}

export async function getTemplate(id: string): Promise<ReleaseTemplate | null> {
  const { results } = await d1Query<TemplateRow>(
    `SELECT * FROM release_templates WHERE id = ? LIMIT 1`,
    [id]
  );
  return results[0] ? rowToTemplate(results[0]) : null;
}

function serializeConditionList(values: string[] | null | undefined): string | null {
  if (!values) return null;
  const cleaned = values.map((v) => v.trim()).filter((v) => v.length > 0);
  return cleaned.length > 0 ? JSON.stringify(cleaned) : null;
}

export async function createTemplate(data: {
  name: string;
  platformPrefixes?: string[] | null;
  releaseTypes?: ReleaseType[] | null;
}): Promise<ReleaseTemplate> {
  // Place new template at the end (max priority + 1)
  const { results: maxResult } = await d1Query<{ max_p: number | null }>(
    `SELECT MAX(priority) as max_p FROM release_templates`
  );
  const maxPriority = maxResult[0]?.max_p ?? -1;
  const priority = maxPriority + 1;

  const id = newId();
  const now = new Date().toISOString();
  const platformJson = serializeConditionList(data.platformPrefixes);
  const typesJson = serializeConditionList(data.releaseTypes ?? null);

  await d1Query(
    `INSERT INTO release_templates
       (id, name, platform_prefixes, release_types, priority, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, data.name, platformJson, typesJson, priority, now, now],
  );

  return {
    id,
    name: data.name,
    platformPrefixes: platformJson ? (JSON.parse(platformJson) as string[]) : null,
    releaseTypes: typesJson ? (JSON.parse(typesJson) as ReleaseType[]) : null,
    priority,
    createdAt: now,
    updatedAt: now,
  };
}

export async function updateTemplate(
  id: string,
  data: {
    name?: string;
    platformPrefixes?: string[] | null;
    releaseTypes?: ReleaseType[] | null;
  }
): Promise<void> {
  const now = new Date().toISOString();
  const fields: string[] = ["updated_at = ?"];
  const params: (string | number | null)[] = [now];

  if (data.name !== undefined) {
    fields.push("name = ?");
    params.push(data.name);
  }
  if ("platformPrefixes" in data) {
    fields.push("platform_prefixes = ?");
    params.push(serializeConditionList(data.platformPrefixes));
    // Null out the legacy column so it can't silently override the new list on read.
    fields.push("platform_prefix = NULL");
  }
  if ("releaseTypes" in data) {
    fields.push("release_types = ?");
    params.push(serializeConditionList(data.releaseTypes ?? null));
    fields.push("release_type = NULL");
  }

  params.push(id);
  await d1Query(
    `UPDATE release_templates SET ${fields.join(", ")} WHERE id = ?`,
    params
  );
}

export async function deleteTemplate(id: string): Promise<void> {
  await d1Query(`DELETE FROM release_templates WHERE id = ?`, [id]);
}

/**
 * Batch-update template priorities based on an ordered array of IDs.
 * Each ID gets its priority set to its index position.
 */
export async function reorderTemplates(orderedIds: string[]): Promise<void> {
  const now = new Date().toISOString();
  for (let i = 0; i < orderedIds.length; i++) {
    await d1Query(
      `UPDATE release_templates SET priority = ?, updated_at = ? WHERE id = ?`,
      [i, now, orderedIds[i]]
    );
  }
}

// ─── Template Tasks ────────────────────────────────────────────────────────────

export async function listTemplateTasks(
  templateId: string
): Promise<ReleaseTemplateTask[]> {
  const { results } = await d1Query<TemplateTaskRow>(
    `SELECT * FROM release_template_tasks WHERE template_id = ? ORDER BY position ASC`,
    [templateId]
  );
  return results.map(rowToTemplateTask);
}

export async function createTemplateTask(data: {
  templateId: string;
  label: string;
  actionType: ActionType;
  dayOffset: number;
  position?: number;
  actionConfig?: Record<string, unknown> | null;
}): Promise<ReleaseTemplateTask> {
  const id = newId();
  const now = new Date().toISOString();

  let position = data.position;
  if (position === undefined) {
    const { results } = await d1Query<{ max_pos: number | null }>(
      `SELECT MAX(position) as max_pos FROM release_template_tasks WHERE template_id = ?`,
      [data.templateId]
    );
    position = (results[0]?.max_pos ?? -1) + 1;
  }

  await d1Query(
    `INSERT INTO release_template_tasks
       (id, template_id, label, action_type, day_offset, position, action_config, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      data.templateId,
      data.label,
      data.actionType,
      data.dayOffset,
      position,
      data.actionConfig ? JSON.stringify(data.actionConfig) : null,
      now,
      now,
    ]
  );

  return {
    id,
    templateId: data.templateId,
    label: data.label,
    description: null,
    actionType: data.actionType,
    dayOffset: data.dayOffset,
    allDay: true,
    startTime: null,
    durationMinutes: 30,
    position,
    actionConfig: data.actionConfig ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

export async function updateTemplateTask(
  id: string,
  data: {
    label?: string;
    actionType?: ActionType;
    dayOffset?: number;
    position?: number;
    actionConfig?: Record<string, unknown> | null;
  }
): Promise<void> {
  const now = new Date().toISOString();
  const fields: string[] = ["updated_at = ?"];
  const params: (string | number | null)[] = [now];

  if (data.label !== undefined) { fields.push("label = ?"); params.push(data.label); }
  if (data.actionType !== undefined) { fields.push("action_type = ?"); params.push(data.actionType); }
  if (data.dayOffset !== undefined) { fields.push("day_offset = ?"); params.push(data.dayOffset); }
  if (data.position !== undefined) { fields.push("position = ?"); params.push(data.position); }
  if ("actionConfig" in data) {
    fields.push("action_config = ?");
    params.push(data.actionConfig ? JSON.stringify(data.actionConfig) : null);
  }

  params.push(id);
  await d1Query(
    `UPDATE release_template_tasks SET ${fields.join(", ")} WHERE id = ?`,
    params
  );
}

export async function deleteTemplateTask(id: string): Promise<void> {
  await d1Query(`DELETE FROM release_template_tasks WHERE id = ?`, [id]);
}

/**
 * Replace all tasks for a template in one shot (used by the editor's Save).
 * Deletes existing tasks and inserts the new list.
 */
export interface TemplateTaskInput {
  label: string;
  description?: string | null;
  actionType: ActionType;
  dayOffset: number;
  allDay?: boolean;
  startTime?: string | null;
  durationMinutes?: number;
  actionConfig?: Record<string, unknown> | null;
}

export async function replaceTemplateTasks(
  templateId: string,
  tasks: TemplateTaskInput[]
): Promise<ReleaseTemplateTask[]> {
  await d1Query(
    `DELETE FROM release_template_tasks WHERE template_id = ?`,
    [templateId]
  );
  const now = new Date().toISOString();
  const created: ReleaseTemplateTask[] = [];
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const id = newId();
    const allDay = t.allDay ?? true;
    const startTime = allDay ? null : t.startTime ?? null;
    const durationMinutes = t.durationMinutes ?? 30;
    await d1Query(
      `INSERT INTO release_template_tasks
         (id, template_id, label, description, action_type, day_offset,
          all_day, start_time, duration_minutes, position, action_config,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        templateId,
        t.label,
        t.description ?? null,
        t.actionType,
        t.dayOffset,
        allDay ? 1 : 0,
        startTime,
        durationMinutes,
        i,
        t.actionConfig ? JSON.stringify(t.actionConfig) : null,
        now,
        now,
      ]
    );
    created.push({
      id,
      templateId,
      label: t.label,
      description: t.description ?? null,
      actionType: t.actionType,
      dayOffset: t.dayOffset,
      allDay,
      startTime,
      durationMinutes,
      position: i,
      actionConfig: t.actionConfig ?? null,
      createdAt: now,
      updatedAt: now,
    });
  }
  return created;
}

// ─── Task Instances ────────────────────────────────────────────────────────────

export async function listTaskInstances(
  releaseId: string
): Promise<ReleaseTaskInstance[]> {
  const { results } = await d1Query<TaskInstanceRow>(
    `SELECT * FROM release_task_instances WHERE release_id = ? ORDER BY due_date IS NULL, due_date ASC, rowid ASC`,
    [releaseId]
  );
  return results.map(rowToTaskInstance);
}

async function insertInstanceFromTemplateTask(
  releaseId: string,
  templateId: string,
  release: Pick<Release, "id" | "name" | "description" | "releaseDate">,
  task: ReleaseTemplateTask,
  now: string,
): Promise<ReleaseTaskInstance> {
  const id = newId();
  const dueDate = release.releaseDate
    ? addDays(release.releaseDate, task.dayOffset)
    : null;
  const ctx = buildMergeContext(release, dueDate, task.dayOffset);
  const label = renderMergeFields(task.label, ctx) ?? task.label;
  const description = renderMergeFields(task.description, ctx);

  await d1Query(
    `INSERT INTO release_task_instances
       (id, release_id, template_task_id, template_id, label, description,
        action_type, day_offset, all_day, start_time, duration_minutes,
        due_date, status, action_config, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    [
      id,
      releaseId,
      task.id,
      templateId,
      label,
      description,
      task.actionType,
      task.dayOffset,
      task.allDay ? 1 : 0,
      task.allDay ? null : task.startTime,
      task.durationMinutes,
      dueDate,
      task.actionConfig ? JSON.stringify(task.actionConfig) : null,
      now,
      now,
    ],
  );

  return {
    id,
    releaseId,
    templateTaskId: task.id,
    templateId,
    label,
    description,
    actionType: task.actionType,
    dayOffset: task.dayOffset,
    allDay: task.allDay,
    startTime: task.allDay ? null : task.startTime,
    durationMinutes: task.durationMinutes,
    dueDate,
    status: "pending",
    actionConfig: task.actionConfig,
    externalId: null,
    externalUrl: null,
    lastDispatchError: null,
    lastDispatchAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Generate task instances for a release from a matched template.
 * Skips generation if instances already exist (idempotent).
 */
export async function generateTaskInstances(
  release: Pick<Release, "id" | "name" | "description" | "releaseDate">,
  templateId: string,
): Promise<ReleaseTaskInstance[]> {
  // Idempotency check
  const { results: existing } = await d1Query<{ id: string }>(
    `SELECT id FROM release_task_instances WHERE release_id = ? LIMIT 1`,
    [release.id]
  );
  if (existing.length > 0) return listTaskInstances(release.id);

  const tasks = await listTemplateTasks(templateId);
  const now = new Date().toISOString();
  const created: ReleaseTaskInstance[] = [];

  for (const task of tasks) {
    created.push(
      await insertInstanceFromTemplateTask(release.id, templateId, release, task, now),
    );
  }

  return created;
}

/**
 * Regenerate task instances for a release (clears existing pending instances first).
 * Used when the matched template changes or the user manually triggers regeneration.
 */
export async function regenerateTaskInstances(
  release: Pick<Release, "id" | "name" | "description" | "releaseDate">,
  templateId: string,
): Promise<ReleaseTaskInstance[]> {
  // Keep rows that actually dispatched to Google (have an external_id); drop
  // everything else. Historical 'skipped' rows from the old UI fall into this
  // bucket — the new status-page model has no user-settable skip.
  await d1Query(
    `DELETE FROM release_task_instances WHERE release_id = ? AND external_id IS NULL`,
    [release.id]
  );

  const tasks = await listTemplateTasks(templateId);
  const now = new Date().toISOString();
  const created: ReleaseTaskInstance[] = [];

  for (const task of tasks) {
    created.push(
      await insertInstanceFromTemplateTask(release.id, templateId, release, task, now),
    );
  }

  return created;
}

/**
 * Recompute due_date for all pending task instances when a release_date changes.
 */
export async function cascadeTaskDates(
  releaseId: string,
  newReleaseDate: string | null
): Promise<void> {
  if (!newReleaseDate) {
    await d1Query(
      `UPDATE release_task_instances SET due_date = NULL, updated_at = ?
       WHERE release_id = ? AND status = 'pending'`,
      [new Date().toISOString(), releaseId]
    );
    return;
  }

  const { results } = await d1Query<{ id: string; day_offset: number }>(
    `SELECT id, day_offset FROM release_task_instances WHERE release_id = ? AND status = 'pending'`,
    [releaseId]
  );

  const now = new Date().toISOString();
  for (const row of results) {
    const dueDate = addDays(newReleaseDate, row.day_offset);
    await d1Query(
      `UPDATE release_task_instances SET due_date = ?, updated_at = ? WHERE id = ?`,
      [dueDate, now, row.id]
    );
  }
}

export async function updateTaskInstanceStatus(
  id: string,
  status: TaskInstanceStatus
): Promise<void> {
  await d1Query(
    `UPDATE release_task_instances SET status = ?, updated_at = ? WHERE id = ?`,
    [status, new Date().toISOString(), id]
  );
}

export async function setTaskInstanceExternalRef(
  id: string,
  externalId: string,
  externalUrl: string
): Promise<void> {
  const now = new Date().toISOString();
  await d1Query(
    `UPDATE release_task_instances
       SET external_id = ?, external_url = ?, last_dispatch_error = NULL,
           last_dispatch_at = ?, updated_at = ?
     WHERE id = ?`,
    [externalId, externalUrl, now, now, id]
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

export async function clearTaskInstanceDispatchError(id: string): Promise<void> {
  const now = new Date().toISOString();
  await d1Query(
    `UPDATE release_task_instances
       SET last_dispatch_error = NULL, last_dispatch_at = ?, updated_at = ?
     WHERE id = ?`,
    [now, now, id],
  );
}

/**
 * Clears external_id/url and resets status to 'pending' so a retry will re-dispatch.
 * Used when the remote resource has been deleted and we want to recreate it.
 */
export async function clearTaskInstanceExternalRef(id: string): Promise<void> {
  const now = new Date().toISOString();
  await d1Query(
    `UPDATE release_task_instances
       SET external_id = NULL, external_url = NULL, status = 'pending', updated_at = ?
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
 * Find the matching template for a release name and generate instances if needed.
 * Safe to call on every webhook event — generateTaskInstances is idempotent.
 */
export async function maybeGenerateInstances(
  release: Pick<Release, "id" | "name" | "description" | "releaseDate">,
): Promise<void> {
  const templates = await listTemplates();
  const matched = matchTemplate(release.name, templates);
  if (!matched) return;
  await generateTaskInstances(release, matched.id);
}
