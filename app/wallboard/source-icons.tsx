import {
  Check,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { FeedKind } from "./feed";

/** Which system a feed event originated from. */
export function sourceOf(kind: FeedKind): "jira" | "github" {
  return kind.startsWith("pr-") || kind.startsWith("deploy-")
    ? "github"
    : "jira";
}

/** Jira mark (Atlassian brand set), fill follows currentColor. */
function JiraMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M11.571 11.513H0a5.218 5.218 0 0 0 5.232 5.215h2.13v2.057A5.215 5.215 0 0 0 12.575 24V12.518a1.005 1.005 0 0 0-1.005-1.005zm5.723-5.756H5.736a5.215 5.215 0 0 0 5.215 5.214h2.129v2.058a5.218 5.218 0 0 0 5.215 5.214V6.758a1.001 1.001 0 0 0-1.001-1.001zM23.013 0H11.455a5.215 5.215 0 0 0 5.215 5.215h2.129v2.057A5.215 5.215 0 0 0 24 12.483V1.005A1.001 1.001 0 0 0 23.013 0z" />
    </svg>
  );
}

/** GitHub octocat mark (Octicons), fill follows currentColor. */
function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={className} aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

/** PR events get GitHub's per-state symbols (matching github.com's own
 *  iconography); deploys keep the octocat mark; everything else is Jira. */
const PR_ICONS: Partial<
  Record<FeedKind, React.ComponentType<{ className?: string }>>
> = {
  "pr-open": GitPullRequest,
  "pr-draft": GitPullRequestDraft,
  "pr-approved": Check,
  "pr-merged": GitMerge,
  "pr-closed": GitPullRequestClosed,
};

/**
 * Source icon for a feed event, tinted via `color` (pass the event's
 * FEED_COLORS entry so kind color-coding carries over from the old dot).
 */
/** Atlassian brand blue, brightened variant for dark backgrounds. */
const JIRA_BLUE = "#2684FF";

export function SourceIcon({
  kind,
  color,
  className,
}: {
  kind: FeedKind;
  color: string;
  className?: string;
}) {
  const jira = sourceOf(kind) === "jira";
  const Mark = PR_ICONS[kind] ?? (jira ? JiraMark : GitHubMark);
  return (
    <span
      className={cn("block", className)}
      style={{ color: jira ? JIRA_BLUE : color }}
    >
      <Mark className="h-full w-full" />
    </span>
  );
}
