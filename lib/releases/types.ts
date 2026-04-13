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

export type ActionType = "manual" | "google_task" | "calendar_event" | "slack_message";
export type ReleaseType = "major" | "minor" | "patch";
export type TaskInstanceStatus = "pending" | "done" | "skipped";

export interface ReleaseTemplate {
  id: string;
  name: string;
  platformPrefix: string | null;
  releaseType: ReleaseType | null;
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
