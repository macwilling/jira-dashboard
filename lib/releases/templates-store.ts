import { d1Query } from "@/lib/d1/client";
import { addDays, matchTemplates } from "./matcher";
import { buildMergeContext, renderMergeFields } from "./merge-fields";
import type {
  Release,
  ReleaseTemplate,
  ReleaseTemplateTask,
  ReleaseTaskInstance,
  ActionType,
  ReleaseType,
  TaskInstanceStatus,
  TaskDefinition,
  ConfigurableField,
  TemplateTaskOverrides,
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
  definition_id: string | null;
  overrides: string | null;
  created_at: string;
  updated_at: string;
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

function rowToTemplateTask(row: TemplateTaskRow): ReleaseTemplateTask {
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
    actionConfig: parseJsonObject(row.action_config),
    definitionId: row.definition_id,
    overrides: parseJsonObject(row.overrides) as TemplateTaskOverrides | null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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
    definitionId: null,
    overrides: null,
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
  definitionId?: string | null;
  overrides?: TemplateTaskOverrides | null;
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
    const definitionId = t.definitionId ?? null;
    const overrides = t.overrides ?? null;
    await d1Query(
      `INSERT INTO release_template_tasks
         (id, template_id, label, description, action_type, day_offset,
          all_day, start_time, duration_minutes, position, action_config,
          definition_id, overrides,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        definitionId,
        overrides ? JSON.stringify(overrides) : null,
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
      definitionId,
      overrides,
      createdAt: now,
      updatedAt: now,
    });
  }
  return created;
}

// ─── Task Definitions (Library) ────────────────────────────────────────────────

export async function listTaskDefinitions(): Promise<TaskDefinition[]> {
  const { results } = await d1Query<TaskDefinitionRow>(
    `SELECT * FROM release_task_definitions ORDER BY name ASC`
  );
  return results.map(rowToTaskDefinition);
}

export async function getTaskDefinition(id: string): Promise<TaskDefinition | null> {
  const { results } = await d1Query<TaskDefinitionRow>(
    `SELECT * FROM release_task_definitions WHERE id = ? LIMIT 1`,
    [id],
  );
  return results[0] ? rowToTaskDefinition(results[0]) : null;
}

/** Map of id → definition. Used by materialization to avoid N+1 lookups. */
export async function getTaskDefinitionsById(
  ids: string[],
): Promise<Map<string, TaskDefinition>> {
  const out = new Map<string, TaskDefinition>();
  const unique = Array.from(new Set(ids)).filter((v) => v);
  if (unique.length === 0) return out;
  // D1 IN (?,?,?…) — keep it simple; the list is always short (<50).
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
  if (data.durationMinutes !== undefined) assign("duration_minutes", data.durationMinutes);
  if ("actionConfig" in data) {
    assign("action_config", data.actionConfig ? JSON.stringify(data.actionConfig) : null);
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

/** Returns the number of template tasks linked to this definition. */
export async function countTemplateTasksUsingDefinition(id: string): Promise<number> {
  const { results } = await d1Query<{ n: number }>(
    `SELECT COUNT(*) as n FROM release_template_tasks WHERE definition_id = ?`,
    [id],
  );
  return results[0]?.n ?? 0;
}

/**
 * Delete a task definition. By default refuses if template tasks still link to
 * it — pass `detachLinked: true` to clear those links (leaving the template
 * tasks as inline rows using whatever values were last stored).
 */
export async function deleteTaskDefinition(
  id: string,
  opts: { detachLinked?: boolean } = {},
): Promise<void> {
  const inUse = await countTemplateTasksUsingDefinition(id);
  if (inUse > 0 && !opts.detachLinked) {
    throw new Error(
      `Cannot delete: ${inUse} template task${inUse === 1 ? "" : "s"} still link to this definition`,
    );
  }
  if (inUse > 0 && opts.detachLinked) {
    await d1Query(
      `UPDATE release_template_tasks
         SET definition_id = NULL, overrides = NULL, updated_at = ?
         WHERE definition_id = ?`,
      [new Date().toISOString(), id],
    );
  }
  await d1Query(`DELETE FROM release_task_definitions WHERE id = ?`, [id]);
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
 * Resolved values for a template task after applying its linked library
 * definition (if any) and honoring locks vs. configurable overrides. If the
 * task is inline (no definitionId), template row values are used verbatim.
 *
 * `actionType` is always locked — changing it at the use-site would change
 * what kind of resource gets dispatched, which isn't a reasonable override.
 */
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

function resolveTemplateTask(
  task: ReleaseTemplateTask,
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
    startTime: allDay ? null : pick<string | null>("startTime", definition.startTime),
    durationMinutes: pick<number>("durationMinutes", definition.durationMinutes),
    actionConfig: pick<Record<string, unknown> | null>(
      "actionConfig",
      definition.actionConfig,
    ),
  };
}

/**
 * Gather and resolve every template task that applies to a release, across
 * every matched template. Result is ordered by (template.priority, task.position)
 * and deduped by (definitionId, resolvedDayOffset) so a definition shared across
 * layered templates fires once per distinct offset.
 */
async function collectResolvedTasks(
  release: Pick<Release, "id" | "name">,
): Promise<Array<{ templateId: string; task: ReleaseTemplateTask; resolved: ResolvedTask }>> {
  const templates = await listTemplates(); // already sorted by priority ASC
  const matched = matchTemplates(release.name, templates);
  if (matched.length === 0) return [];

  // Load tasks for every matched template in parallel.
  const taskLists = await Promise.all(
    matched.map((t) => listTemplateTasks(t.id)),
  );

  // Resolve library definitions referenced anywhere in the matched set.
  const allDefIds = taskLists
    .flat()
    .map((t) => t.definitionId)
    .filter((v): v is string => !!v);
  const definitions = await getTaskDefinitionsById(allDefIds);

  const seenKeys = new Set<string>();
  const out: Array<{ templateId: string; task: ReleaseTemplateTask; resolved: ResolvedTask }> = [];

  for (let i = 0; i < matched.length; i++) {
    const tmpl = matched[i];
    const tasks = taskLists[i]; // already ordered by position ASC

    for (const task of tasks) {
      const def = task.definitionId ? definitions.get(task.definitionId) ?? null : null;
      const resolved = resolveTemplateTask(task, def);

      // Dedup only when a library definition is in play. Inline tasks always
      // materialize — there's no reliable identity to dedup on.
      if (task.definitionId) {
        const key = `${task.definitionId}:${resolved.dayOffset}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
      }

      out.push({ templateId: tmpl.id, task, resolved });
    }
  }

  return out;
}

async function insertInstanceFromResolved(
  releaseId: string,
  templateId: string,
  release: Pick<Release, "id" | "name" | "description" | "releaseDate">,
  templateTaskId: string,
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
       (id, release_id, template_task_id, template_id, label, description,
        action_type, day_offset, all_day, start_time, duration_minutes,
        due_date, status, action_config, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    [
      id,
      releaseId,
      templateTaskId,
      templateId,
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
    releaseId,
    templateTaskId,
    templateId,
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

/**
 * Generate task instances for a release by layering ALL matching templates.
 * Idempotent: skips if any instances already exist. No-match = no instances
 * (the release shows up as "unmatched" in the UI).
 */
export async function generateTaskInstances(
  release: Pick<Release, "id" | "name" | "description" | "releaseDate">,
): Promise<ReleaseTaskInstance[]> {
  const { results: existing } = await d1Query<{ id: string }>(
    `SELECT id FROM release_task_instances WHERE release_id = ? LIMIT 1`,
    [release.id]
  );
  if (existing.length > 0) return listTaskInstances(release.id);

  const collected = await collectResolvedTasks(release);
  if (collected.length === 0) return [];

  const now = new Date().toISOString();
  const created: ReleaseTaskInstance[] = [];
  for (const { templateId, task, resolved } of collected) {
    created.push(
      await insertInstanceFromResolved(
        release.id,
        templateId,
        release,
        task.id,
        resolved,
        now,
      ),
    );
  }
  return created;
}

/**
 * Regenerate task instances: drops rows that haven't dispatched to Google yet
 * (preserving any with an external_id so we don't orphan live resources), then
 * re-materializes from the currently matching templates.
 */
export async function regenerateTaskInstances(
  release: Pick<Release, "id" | "name" | "description" | "releaseDate">,
): Promise<ReleaseTaskInstance[]> {
  await d1Query(
    `DELETE FROM release_task_instances WHERE release_id = ? AND external_id IS NULL`,
    [release.id]
  );

  const collected = await collectResolvedTasks(release);
  if (collected.length === 0) return listTaskInstances(release.id);

  const now = new Date().toISOString();
  const created: ReleaseTaskInstance[] = [];
  for (const { templateId, task, resolved } of collected) {
    created.push(
      await insertInstanceFromResolved(
        release.id,
        templateId,
        release,
        task.id,
        resolved,
        now,
      ),
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
 * Generate task instances for a release by layering ALL matching templates.
 * Safe to call on every webhook event — generateTaskInstances is idempotent.
 * If no template matches, no instances are created (the release shows as
 * "unmatched" in the UI — typically a typo in the Jira version name).
 */
export async function maybeGenerateInstances(
  release: Pick<Release, "id" | "name" | "description" | "releaseDate">,
): Promise<void> {
  await generateTaskInstances(release);
}
