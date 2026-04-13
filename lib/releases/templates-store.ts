import { d1Query } from "@/lib/d1/client";
import { addDays, matchTemplate } from "./matcher";
import type {
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
  platform_prefix: string | null;
  release_type: string | null;
  priority: number;
  created_at: string;
  updated_at: string;
}

interface TemplateTaskRow {
  id: string;
  template_id: string;
  label: string;
  action_type: string;
  day_offset: number;
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
  action_type: string;
  day_offset: number;
  due_date: string | null;
  status: string;
  action_config: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Mappers ───────────────────────────────────────────────────────────────────

function rowToTemplate(row: TemplateRow): ReleaseTemplate {
  return {
    id: row.id,
    name: row.name,
    platformPrefix: row.platform_prefix,
    releaseType: (row.release_type as ReleaseType) ?? null,
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
    actionType: row.action_type as ActionType,
    dayOffset: row.day_offset,
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
    actionType: row.action_type as ActionType,
    dayOffset: row.day_offset,
    dueDate: row.due_date,
    status: row.status as TaskInstanceStatus,
    actionConfig,
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

export async function createTemplate(data: {
  name: string;
  platformPrefix?: string | null;
  releaseType?: ReleaseType | null;
}): Promise<ReleaseTemplate> {
  // Place new template at the end (max priority + 1)
  const { results: maxResult } = await d1Query<{ max_p: number | null }>(
    `SELECT MAX(priority) as max_p FROM release_templates`
  );
  const maxPriority = maxResult[0]?.max_p ?? -1;
  const priority = maxPriority + 1;

  const id = newId();
  const now = new Date().toISOString();

  await d1Query(
    `INSERT INTO release_templates (id, name, platform_prefix, release_type, priority, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      data.name,
      data.platformPrefix ?? null,
      data.releaseType ?? null,
      priority,
      now,
      now,
    ]
  );

  return {
    id,
    name: data.name,
    platformPrefix: data.platformPrefix ?? null,
    releaseType: data.releaseType ?? null,
    priority,
    createdAt: now,
    updatedAt: now,
  };
}

export async function updateTemplate(
  id: string,
  data: {
    name?: string;
    platformPrefix?: string | null;
    releaseType?: ReleaseType | null;
  }
): Promise<void> {
  const now = new Date().toISOString();
  const fields: string[] = ["updated_at = ?"];
  const params: (string | number | null)[] = [now];

  if (data.name !== undefined) {
    fields.push("name = ?");
    params.push(data.name);
  }
  if ("platformPrefix" in data) {
    fields.push("platform_prefix = ?");
    params.push(data.platformPrefix ?? null);
  }
  if ("releaseType" in data) {
    fields.push("release_type = ?");
    params.push(data.releaseType ?? null);
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
    actionType: data.actionType,
    dayOffset: data.dayOffset,
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
export async function replaceTemplateTasks(
  templateId: string,
  tasks: Array<{
    label: string;
    actionType: ActionType;
    dayOffset: number;
    actionConfig?: Record<string, unknown> | null;
  }>
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
    await d1Query(
      `INSERT INTO release_template_tasks
         (id, template_id, label, action_type, day_offset, position, action_config, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        templateId,
        t.label,
        t.actionType,
        t.dayOffset,
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
      actionType: t.actionType,
      dayOffset: t.dayOffset,
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

/**
 * Generate task instances for a release from a matched template.
 * Skips generation if instances already exist (idempotent).
 */
export async function generateTaskInstances(
  releaseId: string,
  templateId: string,
  releaseDate: string | null
): Promise<ReleaseTaskInstance[]> {
  // Idempotency check
  const { results: existing } = await d1Query<{ id: string }>(
    `SELECT id FROM release_task_instances WHERE release_id = ? LIMIT 1`,
    [releaseId]
  );
  if (existing.length > 0) return listTaskInstances(releaseId);

  const tasks = await listTemplateTasks(templateId);
  const now = new Date().toISOString();
  const created: ReleaseTaskInstance[] = [];

  for (const task of tasks) {
    const id = newId();
    const dueDate =
      releaseDate ? addDays(releaseDate, task.dayOffset) : null;

    await d1Query(
      `INSERT INTO release_task_instances
         (id, release_id, template_task_id, template_id, label, action_type, day_offset, due_date, status, action_config, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      [
        id,
        releaseId,
        task.id,
        templateId,
        task.label,
        task.actionType,
        task.dayOffset,
        dueDate,
        task.actionConfig ? JSON.stringify(task.actionConfig) : null,
        now,
        now,
      ]
    );

    created.push({
      id,
      releaseId,
      templateTaskId: task.id,
      templateId,
      label: task.label,
      actionType: task.actionType,
      dayOffset: task.dayOffset,
      dueDate,
      status: "pending",
      actionConfig: task.actionConfig,
      createdAt: now,
      updatedAt: now,
    });
  }

  return created;
}

/**
 * Regenerate task instances for a release (clears existing pending instances first).
 * Used when the matched template changes or the user manually triggers regeneration.
 */
export async function regenerateTaskInstances(
  releaseId: string,
  templateId: string,
  releaseDate: string | null
): Promise<ReleaseTaskInstance[]> {
  await d1Query(
    `DELETE FROM release_task_instances WHERE release_id = ? AND status = 'pending'`,
    [releaseId]
  );

  const tasks = await listTemplateTasks(templateId);
  const now = new Date().toISOString();
  const created: ReleaseTaskInstance[] = [];

  for (const task of tasks) {
    const id = newId();
    const dueDate = releaseDate ? addDays(releaseDate, task.dayOffset) : null;

    await d1Query(
      `INSERT INTO release_task_instances
         (id, release_id, template_task_id, template_id, label, action_type, day_offset, due_date, status, action_config, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      [
        id,
        releaseId,
        task.id,
        templateId,
        task.label,
        task.actionType,
        task.dayOffset,
        dueDate,
        task.actionConfig ? JSON.stringify(task.actionConfig) : null,
        now,
        now,
      ]
    );

    created.push({
      id,
      releaseId,
      templateTaskId: task.id,
      templateId,
      label: task.label,
      actionType: task.actionType,
      dayOffset: task.dayOffset,
      dueDate,
      status: "pending",
      actionConfig: task.actionConfig,
      createdAt: now,
      updatedAt: now,
    });
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

/**
 * Find the matching template for a release name and generate instances if needed.
 * Safe to call on every webhook event — generateTaskInstances is idempotent.
 */
export async function maybeGenerateInstances(
  releaseId: string,
  releaseName: string,
  releaseDate: string | null
): Promise<void> {
  const templates = await listTemplates();
  const matched = matchTemplate(releaseName, templates);
  if (!matched) return;
  await generateTaskInstances(releaseId, matched.id, releaseDate);
}
