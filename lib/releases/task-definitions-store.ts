/**
 * CRUD for the task definition library. Definitions are reusable blueprints
 * that workflow tasks can link to — the definition's locked fields (everything
 * not listed in configurableFields) are enforced at materialize time.
 */

import { d1Query } from "@/lib/d1/client";
import { countWorkflowTasksUsingDefinition } from "./workflows-store";
import type {
  ActionType,
  ConfigurableField,
  TaskDefinition,
} from "./types";

const ALL_CONFIGURABLE_FIELDS: ConfigurableField[] = [
  "label",
  "description",
  "dayOffset",
  "allDay",
  "startTime",
  "durationMinutes",
  "actionConfig",
];

function parseConfigurableFields(raw: string | null): ConfigurableField[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is ConfigurableField =>
      typeof v === "string" &&
      (ALL_CONFIGURABLE_FIELDS as string[]).includes(v),
    );
  } catch {
    return [];
  }
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

interface TaskDefinitionRow {
  id: string;
  name: string;
  label: string;
  description: string | null;
  action_type: string;
  day_offset: number;
  all_day: number;
  start_time: string | null;
  duration_minutes: number;
  action_config: string | null;
  configurable_fields: string;
  created_at: string;
  updated_at: string;
}

function rowToTaskDefinition(row: TaskDefinitionRow): TaskDefinition {
  return {
    id: row.id,
    name: row.name,
    label: row.label,
    description: row.description,
    actionType: row.action_type as ActionType,
    dayOffset: row.day_offset,
    allDay: row.all_day === 1,
    startTime: row.start_time,
    durationMinutes: row.duration_minutes,
    actionConfig: parseJsonObject(row.action_config),
    configurableFields: parseConfigurableFields(row.configurable_fields),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function newId(): string {
  return crypto.randomUUID();
}

export async function listTaskDefinitions(): Promise<TaskDefinition[]> {
  const { results } = await d1Query<TaskDefinitionRow>(
    `SELECT * FROM release_task_definitions ORDER BY name ASC`,
  );
  return results.map(rowToTaskDefinition);
}

export async function getTaskDefinition(
  id: string,
): Promise<TaskDefinition | null> {
  const { results } = await d1Query<TaskDefinitionRow>(
    `SELECT * FROM release_task_definitions WHERE id = ? LIMIT 1`,
    [id],
  );
  return results[0] ? rowToTaskDefinition(results[0]) : null;
}

/** Map id → definition. Used by materialization to avoid N+1 lookups. */
export async function getTaskDefinitionsById(
  ids: string[],
): Promise<Map<string, TaskDefinition>> {
  const out = new Map<string, TaskDefinition>();
  const unique = Array.from(new Set(ids)).filter((v) => v);
  if (unique.length === 0) return out;
  const placeholders = unique.map(() => "?").join(",");
  const { results } = await d1Query<TaskDefinitionRow>(
    `SELECT * FROM release_task_definitions WHERE id IN (${placeholders})`,
    unique,
  );
  for (const row of results) out.set(row.id, rowToTaskDefinition(row));
  return out;
}

export interface TaskDefinitionInput {
  name: string;
  label: string;
  description?: string | null;
  actionType: ActionType;
  dayOffset?: number;
  allDay?: boolean;
  startTime?: string | null;
  durationMinutes?: number;
  actionConfig?: Record<string, unknown> | null;
  configurableFields?: ConfigurableField[];
}

export async function createTaskDefinition(
  data: TaskDefinitionInput,
): Promise<TaskDefinition> {
  const id = newId();
  const now = new Date().toISOString();
  const allDay = data.allDay ?? true;
  const startTime = allDay ? null : data.startTime ?? null;
  const durationMinutes = data.durationMinutes ?? 30;
  const dayOffset = data.dayOffset ?? 0;
  const configurable = data.configurableFields ?? [];

  await d1Query(
    `INSERT INTO release_task_definitions
       (id, name, label, description, action_type, day_offset,
        all_day, start_time, duration_minutes, action_config,
        configurable_fields, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      data.name,
      data.label,
      data.description ?? null,
      data.actionType,
      dayOffset,
      allDay ? 1 : 0,
      startTime,
      durationMinutes,
      data.actionConfig ? JSON.stringify(data.actionConfig) : null,
      JSON.stringify(configurable),
      now,
      now,
    ],
  );

  return {
    id,
    name: data.name,
    label: data.label,
    description: data.description ?? null,
    actionType: data.actionType,
    dayOffset,
    allDay,
    startTime,
    durationMinutes,
    actionConfig: data.actionConfig ?? null,
    configurableFields: configurable,
    createdAt: now,
    updatedAt: now,
  };
}

export async function updateTaskDefinition(
  id: string,
  data: Partial<TaskDefinitionInput>,
): Promise<void> {
  const now = new Date().toISOString();
  const fields: string[] = ["updated_at = ?"];
  const params: (string | number | null)[] = [now];

  const assign = (col: string, val: string | number | null) => {
    fields.push(`${col} = ?`);
    params.push(val);
  };
  if (data.name !== undefined) assign("name", data.name);
  if (data.label !== undefined) assign("label", data.label);
  if ("description" in data) assign("description", data.description ?? null);
  if (data.actionType !== undefined) assign("action_type", data.actionType);
  if (data.dayOffset !== undefined) assign("day_offset", data.dayOffset);
  if (data.allDay !== undefined) assign("all_day", data.allDay ? 1 : 0);
  if ("startTime" in data) assign("start_time", data.startTime ?? null);
  if (data.durationMinutes !== undefined) {
    assign("duration_minutes", data.durationMinutes);
  }
  if ("actionConfig" in data) {
    assign(
      "action_config",
      data.actionConfig ? JSON.stringify(data.actionConfig) : null,
    );
  }
  if (data.configurableFields !== undefined) {
    assign("configurable_fields", JSON.stringify(data.configurableFields));
  }

  params.push(id);
  await d1Query(
    `UPDATE release_task_definitions SET ${fields.join(", ")} WHERE id = ?`,
    params,
  );
}

/**
 * Delete a task definition. By default refuses if any workflow tasks still
 * link to it — pass `detachLinked: true` to clear those links (leaving the
 * workflow tasks as inline rows using whatever values were last stored).
 */
export async function deleteTaskDefinition(
  id: string,
  opts: { detachLinked?: boolean } = {},
): Promise<void> {
  const inUse = await countWorkflowTasksUsingDefinition(id);
  if (inUse > 0 && !opts.detachLinked) {
    throw new Error(
      `Cannot delete: ${inUse} workflow task${inUse === 1 ? "" : "s"} still link to this definition`,
    );
  }
  if (inUse > 0 && opts.detachLinked) {
    await d1Query(
      `UPDATE workflow_tasks
          SET definition_id = NULL, overrides = NULL, updated_at = ?
          WHERE definition_id = ?`,
      [new Date().toISOString(), id],
    );
  }
  await d1Query(`DELETE FROM release_task_definitions WHERE id = ?`, [id]);
}
