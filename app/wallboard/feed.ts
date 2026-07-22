import { ChangelogEntry, Ticket } from "@/lib/types";

export type FeedKind =
  | "status"
  | "comment"
  | "priority"
  | "assignee"
  | "new"
  | "pr-open"
  | "pr-draft"
  | "pr-approved"
  | "pr-merged"
  | "pr-closed"
  | "deploy-start"
  | "deploy-ok"
  | "deploy-fail";

export interface FeedEvent {
  id: string;
  key: string;
  summary: string;
  kind: FeedKind;
  text: string;
  who: string | null;
  at: number; // epoch ms
  /** Extra context, e.g. a comment-body preview. Shown on toasts. */
  detail?: string;
}

/** Flattens a markdown comment body into a short plain-text preview. */
export function commentPreview(body: string, max = 140): string {
  const text = body
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "[image]")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`>#|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? text.slice(0, max).trimEnd() + "…" : text;
}

export const FEED_COLORS: Record<FeedKind, string> = {
  status: "#a371f7",
  comment: "#4493f8",
  priority: "#f85149",
  assignee: "#d29922",
  new: "#3fb950",
  "pr-open": "#3fb950",
  "pr-draft": "#8b949e",
  "pr-approved": "#3fb950",
  "pr-merged": "#a371f7",
  "pr-closed": "#f85149",
  "deploy-start": "#4493f8",
  "deploy-ok": "#3fb950",
  "deploy-fail": "#f85149",
};

interface TicketSnapshot {
  status: string;
  priority: string;
  assigneeId: string;
  commentCount: number;
}

export type BoardSnapshot = Map<string, TicketSnapshot>;

export function buildSnapshot(tickets: Ticket[]): BoardSnapshot {
  const snap: BoardSnapshot = new Map();
  for (const t of tickets) {
    snap.set(t.key, {
      status: t.status,
      priority: t.priority,
      assigneeId: t.assigneeId,
      commentCount: t.comments.length,
    });
  }
  return snap;
}

/**
 * Diffs two polls of the sprint ticket list into feed events. Runs entirely
 * client-side — change detection costs zero extra API calls.
 */
export function diffSnapshots(
  prev: BoardSnapshot,
  tickets: Ticket[],
  memberName: (id: string) => string | null
): FeedEvent[] {
  const now = Date.now();
  const events: FeedEvent[] = [];

  for (const t of tickets) {
    const before = prev.get(t.key);
    const base = { key: t.key, summary: t.summary, at: now };

    if (!before) {
      events.push({
        ...base,
        id: `${t.key}-new-${now}`,
        kind: "new",
        text: "added to the sprint",
        who: memberName(t.assigneeId),
      });
      continue;
    }

    if (before.status !== t.status) {
      events.push({
        ...base,
        id: `${t.key}-status-${now}`,
        kind: "status",
        text: `${before.status} → ${t.status}`,
        who: memberName(t.assigneeId),
      });
    }
    if (before.priority !== t.priority) {
      events.push({
        ...base,
        id: `${t.key}-priority-${now}`,
        kind: "priority",
        text: `priority ${before.priority} → ${t.priority}`,
        who: memberName(t.assigneeId),
      });
    }
    if (before.assigneeId !== t.assigneeId) {
      events.push({
        ...base,
        id: `${t.key}-assignee-${now}`,
        kind: "assignee",
        text: `assigned to ${memberName(t.assigneeId) ?? "unassigned"}`,
        who: null,
      });
    }
    if (t.comments.length > before.commentCount) {
      const latest = t.comments[t.comments.length - 1];
      // Prefer the comment's real creation time so it sorts against GitHub
      // events correctly; fall back to poll time if it's missing/unparseable.
      const commentAt = latest ? new Date(latest.createdAt).getTime() : NaN;
      const at = Number.isFinite(commentAt) ? commentAt : now;
      events.push({
        ...base,
        at,
        id: `${t.key}-comment-${at}`,
        kind: "comment",
        text: "new comment",
        who: latest ? memberName(latest.authorId) : null,
        detail: latest ? commentPreview(latest.body) : undefined,
      });
    }
  }

  return events;
}

/**
 * Changelog field (lowercased) that identifies the actor for each diffed
 * event kind. Comments already carry their author from the tickets payload.
 */
const ACTOR_FIELD: Partial<Record<FeedKind, string>> = {
  status: "status",
  priority: "priority",
  assignee: "assignee",
  new: "sprint",
};

/**
 * diffSnapshots can only guess `who` from the ticket's assignee, and stamps
 * events with the poll time because the snapshot diff has no record of when
 * the change actually happened. This pass fetches the changelog for just the
 * changed tickets and stamps the real author AND the real change time onto
 * each event (newest matching entry wins) — the latter is what lets Jira and
 * GitHub events interleave in true chronological order. Falls back to the
 * guess/poll time if the changelog is unavailable or has no matching entry.
 */
export async function resolveEventActors(
  events: FeedEvent[]
): Promise<FeedEvent[]> {
  const keys = [...new Set(events.filter((e) => ACTOR_FIELD[e.kind]).map((e) => e.key))];
  if (keys.length === 0) return events;

  const logs = new Map<string, ChangelogEntry[]>();
  await Promise.all(
    keys.map(async (key) => {
      try {
        const res = await fetch(
          `/api/jira/changelog?key=${encodeURIComponent(key)}`
        );
        if (!res.ok) return;
        const data = await res.json();
        logs.set(key, (data.changelog ?? []) as ChangelogEntry[]);
      } catch {
        // keep the assignee guess for this ticket
      }
    })
  );

  return events.map((e) => {
    const field = ACTOR_FIELD[e.kind];
    if (!field) return e;
    // Entries are newest-first — the first matching one is the change we saw
    const entry = logs
      .get(e.key)
      ?.find((en) => en.changes.some((c) => c.field.toLowerCase() === field));
    if (!entry) return e;
    const entryAt = new Date(entry.created).getTime();
    return {
      ...e,
      who: entry.authorName || e.who,
      at: Number.isFinite(entryAt) ? entryAt : e.at,
    };
  });
}

const SEED_WINDOW_MS = 24 * 60 * 60 * 1000;
const SEED_CHANGELOG_TICKETS = 8;

/**
 * Seeds the feed on first load so the board doesn't start empty: recent
 * comments come free from the tickets payload; status/priority/assignee
 * history comes from /api/jira/changelog for the few most recently active
 * tickets (bounded, so the seed stays cheap).
 */
export async function seedFeed(
  tickets: Ticket[],
  memberName: (id: string) => string | null
): Promise<FeedEvent[]> {
  const cutoff = Date.now() - SEED_WINDOW_MS;
  const events: FeedEvent[] = [];

  for (const t of tickets) {
    for (const c of t.comments) {
      const at = new Date(c.createdAt).getTime();
      if (at < cutoff) continue;
      events.push({
        id: `seed-${t.key}-comment-${c.id}`,
        key: t.key,
        summary: t.summary,
        kind: "comment",
        text: "new comment",
        who: memberName(c.authorId),
        at,
        detail: commentPreview(c.body),
      });
    }
  }

  const recentlyActive = [...tickets]
    .sort(
      (a, b) =>
        new Date(b.lastActivityDate).getTime() -
        new Date(a.lastActivityDate).getTime()
    )
    .slice(0, SEED_CHANGELOG_TICKETS);

  const changelogs = await Promise.all(
    recentlyActive.map(async (t) => {
      try {
        const res = await fetch(
          `/api/jira/changelog?key=${encodeURIComponent(t.key)}`
        );
        if (!res.ok) return { ticket: t, entries: [] as ChangelogEntry[] };
        const data = await res.json();
        return { ticket: t, entries: (data.changelog ?? []) as ChangelogEntry[] };
      } catch {
        return { ticket: t, entries: [] as ChangelogEntry[] };
      }
    })
  );

  for (const { ticket, entries } of changelogs) {
    for (const entry of entries) {
      const at = new Date(entry.created).getTime();
      if (at < cutoff) continue;
      for (const change of entry.changes) {
        const field = change.field.toLowerCase();
        let kind: FeedKind | null = null;
        let text = "";
        if (field === "status") {
          kind = "status";
          text = `${change.from ?? "?"} → ${change.to ?? "?"}`;
        } else if (field === "priority") {
          kind = "priority";
          text = `priority ${change.from ?? "?"} → ${change.to ?? "?"}`;
        } else if (field === "assignee") {
          kind = "assignee";
          text = `assigned to ${change.to ?? "unassigned"}`;
        }
        if (!kind) continue;
        events.push({
          id: `seed-${ticket.key}-${entry.id}-${field}`,
          key: ticket.key,
          summary: ticket.summary,
          kind,
          text,
          who: entry.authorName || null,
          at,
        });
      }
    }
  }

  return events.sort((a, b) => b.at - a.at).slice(0, 40);
}

export function relativeTime(at: number, now: number): string {
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
