/**
 * Maps raw Jira statuses to the display stages used everywhere on the
 * wallboard (chips, labels, progress). Anything unrecognized — Closed,
 * Awaiting Release, future statuses — counts as Done. Blocked is kept
 * distinct (never Done) so stuck work can't masquerade as finished.
 */

export type Stage =
  | "To Do"
  | "Blocked"
  | "In Progress"
  | "Code Review"
  | "Testing"
  | "Done";

export const STAGE_COLORS: Record<Stage, string> = {
  "To Do": "#8b949e",
  Blocked: "#f85149",
  "In Progress": "#4493f8",
  "Code Review": "#a371f7",
  Testing: "#d29922",
  Done: "#3fb950",
};

export function stageOf(status: string): Stage {
  switch (status.toLowerCase()) {
    case "blocked":
      return "Blocked";
    case "open":
      return "To Do";
    case "in progress":
      return "In Progress";
    case "resolved":
      return "Code Review";
    case "testing":
      return "Testing";
    default:
      return "Done";
  }
}

export function stageColor(status: string): string {
  return STAGE_COLORS[stageOf(status)];
}
