/**
 * Merge field rendering for release template tasks and notifications.
 *
 * Tokens use double-braces so they don't collide with code snippets or Jira
 * macros in labels: e.g. "Deploy {{release.name}}" → "Deploy web@1.2.0".
 *
 * For tasks: rendered at generation time (generateTaskInstances /
 * regenerateTaskInstances) so the UI always shows real values, not raw tokens.
 *
 * For notifications: rendered at fire time inside fireReleaseEvent — the event
 * bucket is only populated in that path, and varies per event type.
 */

import { addDays, parseReleaseName } from "./matcher";
import type { Release, ReleaseEventType } from "./types";

export interface MergeFieldDef {
  token: string;
  label: string;
  example: string;
  group: "Release" | "Task" | "Event";
  /** Event types this token is populated for. Undefined = always available. */
  events?: ReleaseEventType[];
}

export const MERGE_FIELDS: readonly MergeFieldDef[] = [
  { token: "{{release.id}}",          label: "Release ID (Jira)",   example: "13673",       group: "Release" },
  { token: "{{release.name}}",        label: "Release name",        example: "web@1.2.0",   group: "Release" },
  { token: "{{release.platform}}",    label: "Platform",            example: "web",         group: "Release" },
  { token: "{{release.version}}",     label: "Version",             example: "1.2.0",       group: "Release" },
  { token: "{{release.releaseType}}", label: "Release type",        example: "minor",       group: "Release" },
  { token: "{{release.date}}",        label: "Release date",        example: "2026-05-01",  group: "Release" },
  { token: "{{release.description}}", label: "Release description", example: "",            group: "Release" },
  { token: "{{task.dueDate}}",        label: "Task due date",       example: "2026-04-28",  group: "Task" },
  { token: "{{task.dayOffset}}",      label: "Day offset (±N)",     example: "-3",          group: "Task" },
];

export const EVENT_MERGE_FIELDS: readonly MergeFieldDef[] = [
  { token: "{{event.oldDate}}",   label: "Previous release date", example: "2026-05-01", group: "Event", events: ["release.date_changed"] },
  { token: "{{event.newDate}}",   label: "New release date",      example: "2026-05-15", group: "Event", events: ["release.date_changed"] },
  { token: "{{event.taskLabel}}", label: "Failed task label",     example: "Deploy web@1.2.0", group: "Event", events: ["task.failed"] },
  { token: "{{event.error}}",     label: "Failure message",       example: "Google auth expired", group: "Event", events: ["task.failed"] },
];

export interface MergeContext {
  release: {
    id: string;
    name: string;
    platform: string;
    version: string;
    releaseType: string;
    date: string;
    description: string;
  };
  task: {
    dueDate: string;
    dayOffset: string;
  };
  event: {
    oldDate: string;
    newDate: string;
    taskLabel: string;
    error: string;
  };
}

function versionFromName(name: string): string {
  const atIdx = name.indexOf("@");
  const semverPart = atIdx >= 0 ? name.slice(atIdx + 1).trim() : name.trim();
  const match = semverPart.match(/^\d+\.\d+\.\d+/);
  return match ? match[0] : "";
}

/**
 * Normalize to MM/DD/YYYY for display. Jira sometimes sends full ISO timestamps
 * (`2026-04-30T00:00:00.0+0000`); the app stores dates as YYYY-MM-DD internally.
 * Merge output targets Slack messages / Google tasks, where MM/DD/YYYY reads
 * more naturally for US-based users. Done as string slicing so we don't shift
 * the date across timezones.
 */
function toDateOnly(value: string | null | undefined): string {
  if (!value) return "";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return value;
  const [, y, m, d] = match;
  return `${m}/${d}/${y}`;
}

export interface EventContextOverride {
  oldDate?: string | null;
  newDate?: string | null;
  taskLabel?: string | null;
  error?: string | null;
}

export function buildMergeContext(
  release: Pick<Release, "id" | "name" | "description" | "releaseDate">,
  dueDate: string | null,
  dayOffset: number,
  event?: EventContextOverride,
): MergeContext {
  const parsed = parseReleaseName(release.name);
  return {
    release: {
      id: release.id,
      name: release.name,
      platform: parsed.platform ?? "",
      version: versionFromName(release.name),
      releaseType: parsed.releaseType ?? "",
      date: toDateOnly(release.releaseDate),
      description: release.description ?? "",
    },
    task: {
      dueDate: toDateOnly(dueDate),
      dayOffset: dayOffset === 0 ? "0" : dayOffset > 0 ? `+${dayOffset}` : String(dayOffset),
    },
    event: {
      oldDate: toDateOnly(event?.oldDate),
      newDate: toDateOnly(event?.newDate),
      taskLabel: event?.taskLabel ?? "",
      error: event?.error ?? "",
    },
  };
}

const SAMPLE_RELEASE = {
  id: "13673",
  name: "web@1.2.0",
  description: "Sample release — payment gateway upgrade",
  releaseDate: "2026-05-01",
};

export interface SampleContextOverrides {
  /** Defaults to -3; pass the actual row's offset for a more accurate preview. */
  dayOffset?: number;
}

/**
 * Sample context used for previews / test messages. Every bucket populated so
 * any token has a visible value, regardless of whether it would actually be
 * set for a given event type at fire time. Pass `dayOffset` to make the
 * computed `task.dueDate` match the row being previewed.
 */
export function buildSampleMergeContext(
  overrides?: SampleContextOverrides,
): MergeContext {
  const dayOffset = overrides?.dayOffset ?? -3;
  const dueDate = addDays(SAMPLE_RELEASE.releaseDate, dayOffset);
  return buildMergeContext(SAMPLE_RELEASE, dueDate, dayOffset, {
    oldDate: "2026-04-25",
    newDate: "2026-05-01",
    taskLabel: "Deploy web@1.2.0",
    error: "Google auth expired — reconnect in Settings",
  });
}

/**
 * Substitute {{entity.field}} tokens in `text`. Unknown tokens are left intact
 * so typos are visible in the output instead of silently blanking.
 */
export function renderMergeFields(text: string | null, ctx: MergeContext): string | null {
  if (text == null) return null;
  return text.replace(/\{\{(release|task|event)\.(\w+)\}\}/g, (match, entity, field) => {
    const bucket = ctx[entity as keyof MergeContext] as Record<string, string>;
    if (!(field in bucket)) return match;
    return bucket[field];
  });
}
