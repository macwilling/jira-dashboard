export type ApprovalStatus = "none" | "pending" | "approved" | "cancelled";

export interface Release {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  releaseDate: string | null;
  startDate: string | null;
  released: boolean;
  archived: boolean;
  deletedAt: string | null;
  jiraRaw: unknown;
  receivedAt: string;
  updatedAt: string;
  /** Gate state for auto-dispatch. "none" = no gate (legacy or unconfigured). */
  approvalStatus: ApprovalStatus;
  /** Monotonic counter. Bumped on Jira updates while pending so stale Slack clicks can be rejected. */
  approvalVersion: number;
  approvalMessageTs: string | null;
  approvalMessageChannel: string | null;
  approvedAt: string | null;
  /** Slack user ID of whoever clicked Approve — e.g. "U12345". */
  approvedBy: string | null;
}

/** Shape of the `version` object in a Jira webhook payload. */
export interface JiraVersionPayload {
  id: string;
  name: string;
  description?: string;
  releaseDate?: string;
  startDate?: string;
  released?: boolean;
  archived?: boolean;
  projectId: number | string;
}

export type ActionType = "manual" | "google_task" | "calendar_event";
export type ReleaseType = "major" | "minor" | "patch";
export type TaskInstanceStatus = "pending" | "done" | "skipped";

/**
 * Events that can trigger a notification rule. These are fired by the release
 * webhook handler and dispatcher — not by anything scheduled — so `dayOffset`
 * semantics don't apply.
 */
export type ReleaseEventType =
  | "release.created"
  | "release.date_changed"
  | "release.released"
  | "task.failed";

export interface NotificationButton {
  /** Button label shown in Slack. Supports merge fields. */
  label: string;
  /** Link URL opened on click. Supports merge fields (e.g. {{release.id}}). */
  url: string;
}

export interface ReleaseNotification {
  id: string;
  templateId: string;
  eventType: ReleaseEventType;
  message: string;
  /**
   * Slack destination: a channel ID (C…, G…) or user ID (U…) for DMs. Posted
   * via chat.postMessage with the server's SLACK_BOT_TOKEN. Null = rule
   * incomplete; fire-time logs a warning and skips.
   */
  target: string | null;
  /**
   * Optional CTA buttons rendered as a Slack actions block below the message.
   * Empty array = plain text message. Slack caps this at 5 buttons per block.
   */
  buttons: NotificationButton[];
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReleaseTemplate {
  id: string;
  name: string;
  /** Null or empty = matches any platform. */
  platformPrefixes: string[] | null;
  /** Null or empty = matches any release type. */
  releaseTypes: ReleaseType[] | null;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Fields on a TaskDefinition that a template-task use-site may override.
 * Any field NOT listed in a definition's `configurableFields` is locked —
 * the definition's value is enforced at materialize time regardless of what's
 * stored on the template task row.
 */
export type ConfigurableField =
  | "label"
  | "description"
  | "dayOffset"
  | "allDay"
  | "startTime"
  | "durationMinutes"
  | "actionConfig";

/**
 * A reusable action definition in the library. Templates can link tasks to a
 * definition so the same action ("Create deploy calendar event") is materialized
 * consistently across many templates. The definition author decides per-field
 * whether use-sites may override (`configurableFields`) or must use the
 * definition's value (locked — everything not in that list).
 */
export interface TaskDefinition {
  id: string;
  name: string;
  label: string;
  description: string | null;
  actionType: ActionType;
  dayOffset: number;
  allDay: boolean;
  startTime: string | null;
  durationMinutes: number;
  actionConfig: Record<string, unknown> | null;
  configurableFields: ConfigurableField[];
  createdAt: string;
  updatedAt: string;
}

/** Per-use-site overrides. Only keys in the definition's configurableFields are honored. */
export interface TemplateTaskOverrides {
  label?: string;
  description?: string | null;
  dayOffset?: number;
  allDay?: boolean;
  startTime?: string | null;
  durationMinutes?: number;
  actionConfig?: Record<string, unknown> | null;
}

export interface ReleaseTemplateTask {
  id: string;
  templateId: string;
  label: string;
  description: string | null;
  actionType: ActionType;
  dayOffset: number;
  allDay: boolean;
  startTime: string | null; // "HH:MM" — null when allDay
  durationMinutes: number;
  position: number;
  actionConfig: Record<string, unknown> | null;
  /** Null = inline task. Non-null = linked to the library. */
  definitionId: string | null;
  /** Honored only for fields in the linked definition's configurableFields. */
  overrides: TemplateTaskOverrides | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReleaseTaskInstance {
  id: string;
  releaseId: string;
  templateTaskId: string;
  templateId: string;
  label: string;
  description: string | null;
  actionType: ActionType;
  dayOffset: number;
  allDay: boolean;
  startTime: string | null;
  durationMinutes: number;
  dueDate: string | null;
  status: TaskInstanceStatus;
  actionConfig: Record<string, unknown> | null;
  externalId: string | null;
  externalUrl: string | null;
  lastDispatchError: string | null;
  lastDispatchAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type JiraVersionWebhookEvent =
  | "jira:version_created"
  | "jira:version_updated"
  | "jira:version_released"
  | "jira:version_unreleased"
  | "jira:version_deleted"
  | "jira:version_moved"
  | "jira:version_merged";
