import { countIssuesByJql, fetchLabelSuggestions } from "./client";

/**
 * Bug-backlog metrics over an arbitrary date range.
 *
 * Data-quality context: `resolutiondate` on IST bugs is corrupted — periodic
 * backlog-cleanup passes stamp a resolved date (and no-op done→done changelog
 * entries) on bugs that were actually fixed long ago, collapsing many true
 * close dates onto a single backfill date. So every metric here is derived from
 * the immutable status timeline (`status WAS IN (...) ON`, `status CHANGED
 * FROM (...) TO (...) DURING`) rather than `resolved`, matching the validated
 * Apps Script pipeline in scripts/bug-data.gs. A configurable cleanup-label
 * exclusion is layered on top of the "real fix" close count to drop cleanup
 * passes that performed a genuine open→done transition.
 */

// Instance-global bug status sets (same as scripts/bug-data.gs).
export const OPEN_STATUSES = [
  "Open",
  "Blocked",
  "Reopened",
  "Backlog",
  "In Progress",
  "Testing",
];
export const DONE_STATUSES = ["Closed", "Resolved", "Awaiting Release", "GA"];

export const DEFAULT_PROJECT_KEY = "IST";
export const DEFAULT_CLEANUP_PREFIXES = ["backlog-cleanup", "backlog-bankruptcy"];

export interface BugMetricsParams {
  /** Inclusive range start, "YYYY-MM-DD". */
  start: string;
  /** Inclusive range end, "YYYY-MM-DD". */
  end: string;
  projectKey?: string;
  openStatuses?: string[];
  doneStatuses?: string[];
  /** Label prefixes whose bugs are excluded from the "real fix" close count. */
  cleanupLabelPrefixes?: string[];
}

export interface BugMetrics {
  range: { start: string; end: string };
  /** Open bugs right now (live status). */
  currentOpen: number;
  /** Point-in-time backlog at the start of the range. */
  backlogStart: number;
  /** Point-in-time backlog at the end of the range. */
  backlogEnd: number;
  /** Bugs created within the range. */
  opened: number;
  /** Real open→done transitions in the range, excluding cleanup-labeled bugs. */
  closedReal: number;
  /** All open→done transitions in the range, including cleanup passes. */
  closedTotal: number;
  /** closedTotal − closedReal — the cleanup distortion made visible. */
  cleanupExcluded: number;
  /** opened − closedReal (flow-based net change). */
  netChange: number;
  /** (backlogStart − backlogEnd) / backlogStart × 100, stock-based. */
  netReductionPct: number;
  /** Concrete labels the prefixes expanded to (for transparency in the UI). */
  expandedCleanupLabels: string[];
}

/** Quote a value list for a JQL `IN (...)` clause. */
function jqlList(values: string[]): string {
  return values.map((v) => `"${v.replace(/"/g, '\\"')}"`).join(", ");
}

// In-process cache for prefix→labels expansion. Labels change rarely and the
// dashboard re-fetches on every range change; caching avoids hammering the
// autocomplete endpoint. Per-server-instance, warms on first request.
const LABEL_CACHE_TTL_MS = 30 * 60 * 1000; // 30 min
const labelCache = new Map<string, { labels: string[]; fetchedAt: number }>();

/**
 * Expand cleanup label prefixes into the concrete label names Jira knows about.
 * Fails open: a prefix that resolves to nothing simply contributes no labels,
 * so we never accidentally exclude every bug.
 */
export async function expandCleanupLabels(
  prefixes: string[]
): Promise<string[]> {
  const all = new Set<string>();

  await Promise.all(
    prefixes.map(async (prefix) => {
      const cached = labelCache.get(prefix);
      let labels: string[];
      if (cached && Date.now() - cached.fetchedAt < LABEL_CACHE_TTL_MS) {
        labels = cached.labels;
      } else {
        const suggestions = await fetchLabelSuggestions(prefix);
        // Autocomplete can match on substring; keep true prefix matches only.
        labels = suggestions.filter((l) =>
          l.toLowerCase().startsWith(prefix.toLowerCase())
        );
        labelCache.set(prefix, { labels, fetchedAt: Date.now() });
      }
      labels.forEach((l) => all.add(l));
    })
  );

  return [...all];
}

/** Compute all bug-backlog metrics for a range via exact paginate-and-count. */
export async function computeBugMetrics(
  params: BugMetricsParams
): Promise<BugMetrics> {
  const {
    start,
    end,
    projectKey = DEFAULT_PROJECT_KEY,
    openStatuses = OPEN_STATUSES,
    doneStatuses = DONE_STATUSES,
    cleanupLabelPrefixes = DEFAULT_CLEANUP_PREFIXES,
  } = params;

  const base = `project = "${projectKey}" AND issuetype = Bug`;
  const open = jqlList(openStatuses);
  const done = jqlList(doneStatuses);

  const expandedCleanupLabels = await expandCleanupLabels(cleanupLabelPrefixes);
  // Only apply the exclusion if we actually resolved labels (fail open).
  const cleanupClause =
    expandedCleanupLabels.length > 0
      ? ` AND (labels IS EMPTY OR labels NOT IN (${jqlList(
          expandedCleanupLabels
        )}))`
      : "";

  // backlogStart evaluated at the start of the start-day (before range
  // activity); backlogEnd at the end of the end-day. This makes the identity
  // backlogEnd ≈ backlogStart + opened − closedTotal hold cleanly.
  const jql = {
    currentOpen: `${base} AND status IN (${open})`,
    backlogStart: `${base} AND status WAS IN (${open}) ON "${start}"`,
    backlogEnd: `${base} AND status WAS IN (${open}) ON "${end} 23:59"`,
    opened: `${base} AND created >= "${start}" AND created <= "${end} 23:59"`,
    closedTotal: `${base} AND status CHANGED FROM (${open}) TO (${done}) DURING ("${start}", "${end} 23:59")`,
    closedReal: `${base} AND status CHANGED FROM (${open}) TO (${done}) DURING ("${start}", "${end} 23:59")${cleanupClause}`,
  };

  const [currentOpen, backlogStart, backlogEnd, opened, closedTotal, closedReal] =
    await Promise.all([
      countIssuesByJql(jql.currentOpen),
      countIssuesByJql(jql.backlogStart),
      countIssuesByJql(jql.backlogEnd),
      countIssuesByJql(jql.opened),
      countIssuesByJql(jql.closedTotal),
      countIssuesByJql(jql.closedReal),
    ]);

  const netReductionPct =
    backlogStart > 0
      ? ((backlogStart - backlogEnd) / backlogStart) * 100
      : 0;

  return {
    range: { start, end },
    currentOpen,
    backlogStart,
    backlogEnd,
    opened,
    closedReal,
    closedTotal,
    cleanupExcluded: closedTotal - closedReal,
    netChange: opened - closedReal,
    netReductionPct,
    expandedCleanupLabels,
  };
}
