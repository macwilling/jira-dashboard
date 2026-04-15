// ─── Jira webhook payload ─────────────────────────────────────────────────────

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

export type JiraVersionWebhookEvent =
  | "jira:version_created"
  | "jira:version_updated"
  | "jira:version_released"
  | "jira:version_unreleased"
  | "jira:version_deleted"
  | "jira:version_moved"
  | "jira:version_merged";

// ─── Release ──────────────────────────────────────────────────────────────────

export type ApprovalStatus = "none" | "pending" | "approved" | "cancelled";

/** Reason a release is frozen awaiting human resolution. Open enum — add as needed. */
export type ResolutionReason = "category_changed";

/**
 * Snapshot captured at the moment resolution was required, so the user can see
 * what changed even after the underlying release has moved on.
 */
export interface ResolutionSnapshot {
  oldCategoryId: string | null;
  oldCategoryKey: string | null;
  oldWorkflowId: string | null;
  oldWorkflowName: string | null;
  newCategoryId: string | null;
  newCategoryKey: string | null;
  newWorkflowId: string | null;
  newWorkflowName: string | null;
  taskCounts: {
    pending: number;
    dispatched: number;
    completed: number;
  };
  detectedAt: string;
}

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

  /** Resolved category ID, or null if the release name didn't match any category. */
  categoryId: string | null;
  /** True while the release is frozen awaiting admin resolution. */
  resolutionRequired: boolean;
  resolutionReason: ResolutionReason | null;
  resolutionSnapshot: ResolutionSnapshot | null;

  /** Gate state for auto-dispatch (approval target is sourced from the workflow). */
  approvalStatus: ApprovalStatus;
  /** Monotonic counter. Bumped on Jira updates while pending so stale Slack clicks can be rejected. */
  approvalVersion: number;
  approvalMessageTs: string | null;
  approvalMessageChannel: string | null;
  approvedAt: string | null;
  /** Slack user ID of whoever clicked Approve — e.g. "U12345". */
  approvedBy: string | null;
}

// ─── Categorization ───────────────────────────────────────────────────────────

export type ReleaseType = "major" | "minor" | "patch";

/**
 * Exhaustive, non-overlapping lookup table: (platform_prefix, release_type)
 * maps to exactly one workflow. The UNIQUE(platform_prefix, release_type)
 * constraint at the DB level enforces mutual exclusivity.
 *
 * workflowId may be null — the category exists (and will match releases) but
 * hasn't been assigned a workflow yet; matching releases sit unmatched.
 */
export interface ReleaseCategory {
  id: string;
  /** Stable short key for UI/URLs, e.g. "web-major". */
  key: string;
  platformPrefix: string;
  releaseType: ReleaseType;
  workflowId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Workflow ─────────────────────────────────────────────────────────────────

export type ActionType = "manual" | "google_task" | "calendar_event";
export type TaskInstanceStatus = "pending" | "done" | "skipped";

/**
 * Fields on a TaskDefinition that a workflow-task use-site may override.
 * Any field NOT listed in a definition's `configurableFields` is locked —
 * the definition's value wins at materialize time regardless of what's
 * stored on the workflow task row. This enforces consistency for
 * universal steps (e.g. "add release to the release calendar").
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
 * A reusable action definition in the library. Workflows can link tasks to a
 * definition so the same action is materialized consistently across many
 * workflows. The definition author decides per-field whether use-sites may
 * override (`configurableFields`) or must use the definition's value.
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
export interface WorkflowTaskOverrides {
  label?: string;
  description?: string | null;
  dayOffset?: number;
  allDay?: boolean;
  startTime?: string | null;
  durationMinutes?: number;
  actionConfig?: Record<string, unknown> | null;
}

export interface Workflow {
  id: string;
  name: string;
  /** Slack channel/user ID to gate dispatch on, or null to skip approval. */
  approvalSlackTarget: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowTask {
  id: string;
  workflowId: string;
  /** Null = inline one-off; non-null = linked to a library definition (locks apply). */
  definitionId: string | null;
  label: string;
  description: string | null;
  actionType: ActionType;
  dayOffset: number;
  position: number;
  allDay: boolean;
  startTime: string | null;
  durationMinutes: number;
  actionConfig: Record<string, unknown> | null;
  /** Honored only for fields in the linked definition's configurableFields. */
  overrides: WorkflowTaskOverrides | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Notifications ────────────────────────────────────────────────────────────

/**
 * Events that can trigger a notification rule. Fired by the orchestrator in
 * response to a lifecycle event — not scheduled.
 */
export type ReleaseEventType =
  | "release.created"
  | "release.date_changed"
  | "release.released"
  | "task.failed"
  | "release.needs_resolution";

export interface NotificationButton {
  /** Button label shown in Slack. Supports merge fields. */
  label: string;
  /** Link URL opened on click. Supports merge fields (e.g. {{release.id}}). */
  url: string;
}

export interface WorkflowNotification {
  id: string;
  workflowId: string;
  eventType: ReleaseEventType;
  message: string;
  /** Slack channel ID (C…/G…) or user ID (U…). */
  target: string;
  buttons: NotificationButton[];
  position: number;
  createdAt: string;
  updatedAt: string;
}

// ─── Task instances ───────────────────────────────────────────────────────────

export interface ReleaseTaskInstance {
  id: string;
  releaseId: string;
  workflowId: string;
  workflowTaskId: string;
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

// ─── Audit log ────────────────────────────────────────────────────────────────

/**
 * Discrete event types written to `release_events`. This is a wider vocabulary
 * than ReleaseEventType (notifications) because we log more internal state
 * than we fire to Slack.
 */
export type AuditEventType =
  | "release.ingested"
  | "release.deleted"
  | "release.purged"
  | "category.assigned"
  | "category.changed"
  | "resolution.required"
  | "resolution.keep_original"
  | "resolution.switch_workflow"
  | "resolution.discard"
  | "approval.pending"
  | "approval.approved"
  | "approval.cancelled"
  | "approval.superseded"
  | "dispatch.success"
  | "dispatch.failure"
  | "task.generated"
  | "task.rescheduled";

export interface ReleaseEvent {
  id: string;
  releaseId: string;
  eventType: AuditEventType;
  details: Record<string, unknown> | null;
  /** User ID, 'system', 'cron', etc. */
  actor: string | null;
  createdAt: string;
}
