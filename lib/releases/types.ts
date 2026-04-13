export interface Release {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  releaseDate: string | null;
  startDate: string | null;
  released: boolean;
  archived: boolean;
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

export type JiraVersionWebhookEvent =
  | "jira:version_created"
  | "jira:version_updated"
  | "jira:version_released"
  | "jira:version_unreleased"
  | "jira:version_deleted"
  | "jira:version_moved"
  | "jira:version_merged";
