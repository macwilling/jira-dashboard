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
