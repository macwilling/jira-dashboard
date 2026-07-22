/**
 * Shared derivation + helpers for the wallboard's sprint-board views.
 *
 * Two board layouts consume this:
 *  - ScrollingStoryBoard  — the original auto-scrolling, story-grouped board
 *    (subtasks as chips under each story). Uses `groupByStory`.
 *  - StoryCompletionBoard — a static per-story completion list (segmented
 *    progress bar per root). Uses `buildStoryRows`.
 *
 * Both are kept so the planned multi-page wallboard can show either.
 */

import { Ticket } from "@/lib/types";
import { Stage, stageOf } from "../stages";

export const ACCENT = "#4493f8";

/** A subtask counts as "moved" if it was touched within this many hours. */
export const MOVE_WINDOW_H = 24;
/** Idle badge appears once a group has been untouched this long. */
export const IDLE_BADGE_H = 48;

export interface StoryGroup {
  story: Ticket | null; // null = "Other work" (bugs/tasks with no parent story)
  subs: Ticket[];
}

export function hoursSince(iso: string, nowMs: number): number {
  return (nowMs - new Date(iso).getTime()) / 3_600_000;
}
export function hasMoved(t: Ticket, nowMs: number): boolean {
  return hoursSince(t.lastActivityDate, nowMs) <= MOVE_WINDOW_H;
}
export function fmtAgo(h: number): string {
  return h < 24 ? `${Math.max(0, Math.floor(h))}h` : `${Math.floor(h / 24)}d`;
}
export function movedCount(g: StoryGroup, nowMs: number): number {
  const items = g.subs.length > 0 ? g.subs : g.story ? [g.story] : [];
  return items.filter((t) => hasMoved(t, nowMs)).length;
}
export function idleHours(g: StoryGroup, nowMs: number): number {
  const items = [...g.subs, ...(g.story ? [g.story] : [])];
  if (items.length === 0) return 0;
  return Math.min(...items.map((t) => hoursSince(t.lastActivityDate, nowMs)));
}
export function groupPct(g: StoryGroup): number {
  if (g.subs.length === 0) {
    return g.story && stageOf(g.story.status) === "Done" ? 100 : 0;
  }
  const done = g.subs.filter((t) => stageOf(t.status) === "Done").length;
  return Math.round((done / g.subs.length) * 100);
}
export function isFullyDone(g: StoryGroup): boolean {
  if (!g.story) return false;
  return (
    stageOf(g.story.status) === "Done" &&
    g.subs.every((t) => stageOf(t.status) === "Done")
  );
}

/**
 * Groups sprint tickets by story for the scrolling board. A group root is any
 * Story, or any ticket that has subtasks pointing at it; leftover bugs/tasks
 * with no parent story collapse into a single "Other work" group. Fully-done
 * stories are split out so the caller can dim/collapse them.
 */
export function groupByStory(
  tickets: Ticket[],
  nowMs: number
): { activeGroups: StoryGroup[]; collapsedGroups: StoryGroup[] } {
  const byKey = new Map(tickets.map((t) => [t.key, t]));
  const parentKeys = new Set(
    tickets.map((t) => t.parentKey).filter((k): k is string => !!k && byKey.has(k))
  );
  const roots = tickets.filter(
    (t) => t.type === "Story" || parentKeys.has(t.key)
  );
  const rootKeys = new Set(roots.map((t) => t.key));

  const groups: StoryGroup[] = roots.map((story) => ({ story, subs: [] }));
  const groupByKey = new Map(groups.map((g) => [g.story!.key, g]));
  const orphans: Ticket[] = [];

  for (const t of tickets) {
    if (rootKeys.has(t.key)) continue;
    const parent = t.parentKey ? groupByKey.get(t.parentKey) : undefined;
    if (parent) parent.subs.push(t);
    else orphans.push(t); // bugs/tasks with no parent story (or parent outside sprint)
  }

  // Within a group: moved subtasks first, then most recently active
  const subSort = (a: Ticket, b: Ticket) =>
    (hasMoved(b, nowMs) ? 1 : 0) - (hasMoved(a, nowMs) ? 1 : 0) ||
    new Date(b.lastActivityDate).getTime() - new Date(a.lastActivityDate).getTime();
  for (const g of groups) g.subs.sort(subSort);
  orphans.sort(subSort);

  const collapsed = groups.filter(isFullyDone);
  const active = groups
    .filter((g) => !isFullyDone(g))
    .sort(
      (a, b) =>
        movedCount(b, nowMs) - movedCount(a, nowMs) ||
        idleHours(a, nowMs) - idleHours(b, nowMs)
    );
  if (orphans.length > 0) active.push({ story: null, subs: orphans });

  return { activeGroups: active, collapsedGroups: collapsed };
}

/* ============================================================
 * Completion-list model (StoryCompletionBoard)
 * ============================================================ */

/** Left→right fill order for the segmented completion bar. */
export const SEGMENT_ORDER: Stage[] = [
  "Done",
  "Testing",
  "Code Review",
  "In Progress",
  "Blocked",
  "To Do",
];

/** Stages that mean "work has actually started" (vs. sitting in the backlog). */
const STARTED_STAGES: Stage[] = ["In Progress", "Code Review", "Testing"];

export interface StoryRow {
  /** The root work item — a Story, Task, Bug or Design (never a subtask). */
  ticket: Ticket;
  subs: Ticket[];
  total: number;
  done: number;
  /** Non-zero segments in SEGMENT_ORDER, for the progress bar. */
  segments: { stage: Stage; count: number }[];
  /** 0–100. Subtask completion, or the root's own status when it has none. */
  pct: number;
  rootStage: Stage;
  hasSubs: boolean;
  blocked: boolean;
  /** Work has started (root in-progress-ish, or any subtask past To Do). */
  started: boolean;
  moved: boolean;
  idleH: number;
  /** Newest lastActivityDate across the root and its subtasks (ms epoch). */
  lastEditedMs: number;
}

function rowIsDone(row: Pick<StoryRow, "rootStage" | "total" | "done">): boolean {
  return row.rootStage === "Done" && row.done === row.total;
}

/**
 * One row per root work item (subtasks fold into their parent). Splits fully-
 * done rows out into a count so the many closed/roll-off tickets don't dominate
 * the board. Active rows are ordered blocked → in-progress (least complete
 * first, surfacing laggards) → not-started, with the most-stalled first inside
 * each bucket.
 */
export function buildStoryRows(
  tickets: Ticket[],
  nowMs: number
): { active: StoryRow[]; doneCount: number } {
  const subsByParent = new Map<string, Ticket[]>();
  for (const t of tickets) {
    if (t.type === "Subtask" && t.parentKey) {
      const list = subsByParent.get(t.parentKey);
      if (list) list.push(t);
      else subsByParent.set(t.parentKey, [t]);
    }
  }

  const rows: StoryRow[] = tickets
    .filter((t) => t.type !== "Subtask")
    .map((ticket) => {
      const subs = (subsByParent.get(ticket.key) ?? []).sort(
        (a, b) =>
          new Date(b.lastActivityDate).getTime() -
          new Date(a.lastActivityDate).getTime()
      );
      const total = subs.length;
      const rootStage = stageOf(ticket.status);

      const counts = new Map<Stage, number>();
      for (const s of subs) {
        const st = stageOf(s.status);
        counts.set(st, (counts.get(st) ?? 0) + 1);
      }
      const segments = SEGMENT_ORDER.filter((st) => counts.get(st))
        .map((st) => ({ stage: st, count: counts.get(st)! }));
      const done = counts.get("Done") ?? 0;

      const pct =
        total > 0
          ? Math.round((done / total) * 100)
          : rootStage === "Done"
            ? 100
            : 0;

      const blocked =
        rootStage === "Blocked" || subs.some((s) => stageOf(s.status) === "Blocked");
      const started =
        pct > 0 ||
        STARTED_STAGES.includes(rootStage) ||
        subs.some((s) => STARTED_STAGES.includes(stageOf(s.status)));

      const items = [ticket, ...subs];
      const idleH = Math.min(
        ...items.map((t) => hoursSince(t.lastActivityDate, nowMs))
      );
      const moved = items.some((t) => hasMoved(t, nowMs));
      // A group's "last edited" is the newest touch anywhere in it — the root
      // or any subtask — so a moved subtask floats its whole story to the top.
      const lastEditedMs = Math.max(
        ...items.map((t) => new Date(t.lastActivityDate).getTime())
      );

      return {
        ticket,
        subs,
        total,
        done,
        segments,
        pct,
        rootStage,
        hasSubs: total > 0,
        blocked,
        started,
        moved,
        idleH,
        lastEditedMs,
      };
    });

  const doneCount = rows.filter(rowIsDone).length;

  const active = rows
    .filter((r) => !rowIsDone(r))
    .sort((a, b) => b.lastEditedMs - a.lastEditedMs); // most recently updated first

  return { active, doneCount };
}
