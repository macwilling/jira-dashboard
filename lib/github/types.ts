export interface PRRecord {
  number: number;
  title: string;
  author: string;
  authorName: string;
  repo: string;
  mergedAt: string;
  url: string;
}

export interface PRStats {
  prs: PRRecord[];
  totalPRs: number;
  contributors: string[];
  activeDays: number;
  dateRange: { from: string; to: string };
}

/** Per-repo aggregate for the wallboard KPI strip. */
export interface PRSummary {
  openCount: number;
  avgOpenAgeDays: number;
  openedToday: number;
  mergedToday: number;
}

/** A PR or deployment event for the wallboard activity feed. */
export interface RepoEvent {
  id: string; // stable across polls — used for client-side dedupe
  kind:
    | "pr-open"
    | "pr-merged"
    | "pr-closed"
    | "deploy-start"
    | "deploy-ok"
    | "deploy-fail";
  repo: string;
  /** Short display label, e.g. "web#482" or "api · production" */
  label: string;
  title: string;
  actor: string | null;
  at: string; // ISO timestamp
}
