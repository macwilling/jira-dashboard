"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import useSWR from "swr";
import { Volume2, VolumeX } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useTicketData } from "@/lib/ticket-data-context";
import { Ticket } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  BoardSnapshot,
  FEED_COLORS,
  FeedEvent,
  buildSnapshot,
  diffSnapshots,
  relativeTime,
  resolveEventActors,
  seedFeed,
} from "./feed";
import { isUnlocked, playDing, unlockOnGesture } from "./sound";
import { SourceIcon } from "./source-icons";
import { Stage, STAGE_COLORS, stageOf } from "./stages";

const ACCENT = "#4493f8";
const TICKETS_REFRESH_MS = 60_000;
const STATS_REFRESH_MS = 300_000;
const TOAST_MS = 12_000;
const SOUND_KEY = "wallboard-sound";

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (body.configured === false) {
      return { tickets: [], teamMembers: [], sprint: null, configured: false };
    }
    throw new Error(body.error || `API error ${res.status}`);
  }
  return res.json();
};

interface GitHubActivityEvent {
  id: string;
  kind:
    | "pr-open"
    | "pr-draft"
    | "pr-approved"
    | "pr-merged"
    | "pr-closed"
    | "deploy-start"
    | "deploy-ok"
    | "deploy-fail";
  repo: string;
  label: string;
  title: string;
  actor: string | null;
  at: string;
}

const GITHUB_EVENT_TEXT: Record<GitHubActivityEvent["kind"], string> = {
  "pr-open": "PR opened",
  "pr-draft": "draft PR opened",
  "pr-approved": "PR approved",
  "pr-merged": "PR merged",
  "pr-closed": "PR closed without merge",
  "deploy-start": "deployment started",
  "deploy-ok": "deployment succeeded",
  "deploy-fail": "deployment failed",
};

interface RepoPRSummary {
  repo: string;
  openCount: number;
  avgOpenAgeDays: number;
  oldestOpenAgeDays: number;
  openedToday: number;
  mergedToday: number;
}

interface GitHubSummary {
  configured: boolean;
  openCount: number;
  avgOpenAgeDays: number;
  oldestOpenAgeDays: number;
  openedToday: number;
  mergedToday: number;
  repos: RepoPRSummary[];
}

interface DatadogSummary {
  configured: boolean;
  activeUsers: number;
  activeUsersSpark: number[];
  pageViews: number;
  pageViewsSpark: number[];
  pageViewsPrev: number;
  rageClicks: number;
  rageClicksSpark: number[];
  rageClicksPrev: number;
  lcpP75Ms: number | null;
  lcpP75PrevMs: number | null;
  errorSessionPct: number;
  errorSessionPctPrev: number;
}

/** Signed %-change vs yesterday; null hides the delta (no baseline). */
function deltaPct(cur: number, prev: number): number | null {
  if (prev <= 0) return null;
  return ((cur - prev) / prev) * 100;
}

function fmtLcp(ms: number | null): string | null {
  if (ms === null) return null;
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

const MOVE_WINDOW_H = 24;
const IDLE_BADGE_H = 48;

interface StoryGroup {
  story: Ticket | null; // null = "Other work" (bugs/tasks with no parent story)
  subs: Ticket[];
}

/**
 * Gently auto-scrolls a container when its content overflows: pause at the
 * top, drift down slowly, pause at the bottom, glide back up, repeat. Does
 * nothing while everything fits. Returns a controller whose `scrollToKey`
 * brings the element with the matching data-wbkey into view and holds the
 * auto-scroll there while a notification is up.
 */
function useAutoScroll(ref: React.RefObject<HTMLDivElement>) {
  const ctrl = useRef<{ scrollToKey: (key: string) => void }>({
    scrollToKey: () => {},
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const DOWN_SPEED = 16; // px/s while reading downward
    const UP_SPEED = 120; // px/s on the return trip
    let dir = 1;
    let pos = 0;
    let raf = 0;
    let last = performance.now();
    let pauseUntil = last + 5_000;

    const tick = (t: number) => {
      const dt = Math.min((t - last) / 1000, 0.1);
      last = t;
      const max = el.scrollHeight - el.clientHeight;
      if (max <= 4) {
        pos = 0;
        el.scrollTop = 0;
      } else if (t >= pauseUntil) {
        pos = Math.min(Math.max(pos, 0), max);
        pos += dir * (dir > 0 ? DOWN_SPEED : UP_SPEED) * dt;
        el.scrollTop = pos;
        if (dir > 0 && pos >= max - 1) {
          dir = -1;
          pauseUntil = t + 3_000;
        } else if (dir < 0 && pos <= 1) {
          dir = 1;
          pauseUntil = t + 5_000;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    ctrl.current.scrollToKey = (key: string) => {
      const target = el.querySelector<HTMLElement>(
        `[data-wbkey="${CSS.escape(key)}"]`
      );
      if (!target) return;
      const max = el.scrollHeight - el.clientHeight;
      if (max <= 4) return;
      // Land the item ~30% from the top of the panel
      const targetTop =
        target.getBoundingClientRect().top -
        el.getBoundingClientRect().top +
        el.scrollTop -
        el.clientHeight * 0.3;
      pos = Math.min(Math.max(targetTop, 0), max);
      el.scrollTo({ top: pos, behavior: "smooth" });
      dir = 1;
      pauseUntil = performance.now() + TOAST_MS + 2_000;
    };

    return () => cancelAnimationFrame(raf);
  }, [ref]);
  return ctrl;
}

function hoursSince(iso: string, nowMs: number): number {
  return (nowMs - new Date(iso).getTime()) / 3_600_000;
}
function hasMoved(t: Ticket, nowMs: number): boolean {
  return hoursSince(t.lastActivityDate, nowMs) <= MOVE_WINDOW_H;
}
function fmtAgo(h: number): string {
  return h < 24 ? `${Math.max(0, Math.floor(h))}h` : `${Math.floor(h / 24)}d`;
}
function movedCount(g: StoryGroup, nowMs: number): number {
  const items = g.subs.length > 0 ? g.subs : g.story ? [g.story] : [];
  return items.filter((t) => hasMoved(t, nowMs)).length;
}
function idleHours(g: StoryGroup, nowMs: number): number {
  const items = [...g.subs, ...(g.story ? [g.story] : [])];
  if (items.length === 0) return 0;
  return Math.min(...items.map((t) => hoursSince(t.lastActivityDate, nowMs)));
}
function groupPct(g: StoryGroup): number {
  if (g.subs.length === 0) {
    return g.story && stageOf(g.story.status) === "Done" ? 100 : 0;
  }
  const done = g.subs.filter((t) => stageOf(t.status) === "Done").length;
  return Math.round((done / g.subs.length) * 100);
}
function isFullyDone(g: StoryGroup): boolean {
  if (!g.story) return false;
  return (
    stageOf(g.story.status) === "Done" &&
    g.subs.every((t) => stageOf(t.status) === "Done")
  );
}

export default function WallboardPage() {
  const { tickets: allTickets, teamMembers, sprint, configured } = useTicketData();

  // The shared JQL returns current-sprint work PLUS sprint-less L2 support
  // tickets. The wallboard covers the sprint board only, so scope to tickets
  // whose sprint field is populated — an L2-labeled ticket that IS in the
  // sprint stays. Falls back to !isL2 when sprint data is unavailable (mocks).
  const tickets = useMemo(
    () => allTickets.filter((t) => t.inSprint ?? !t.isL2),
    [allTickets]
  );

  // Same cache key as TicketDataProvider — this hook just drives a faster
  // (60s) revalidation cadence while the wallboard is on screen.
  useSWR("/api/jira/tickets", fetcher, {
    refreshInterval: TICKETS_REFRESH_MS,
    revalidateOnFocus: false,
  });

  // ---- clock (1s tick; also drives relative times + toast expiry) ----
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const nowMs = now ?? Date.now();

  const dayStartDate = new Date(nowMs);
  dayStartDate.setHours(0, 0, 0, 0);
  const dayStartISO = dayStartDate.toISOString();

  // ---- GitHub + Datadog stats (slower cadence — see docs/polling notes) ----
  const { data: gh } = useSWR<GitHubSummary>(
    `/api/github/prs/summary?since=${encodeURIComponent(dayStartISO)}`,
    fetcher,
    { refreshInterval: STATS_REFRESH_MS, revalidateOnFocus: false }
  );
  const { data: dd } = useSWR<DatadogSummary>(
    `/api/datadog/insights?dayStart=${encodeURIComponent(dayStartISO)}`,
    fetcher,
    { refreshInterval: STATS_REFRESH_MS, revalidateOnFocus: false }
  );

  // ---- team lookup ----
  const memberMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of teamMembers) map.set(m.id, m.name);
    return map;
  }, [teamMembers]);
  const memberName = useCallback(
    (id: string) => memberMap.get(id) ?? null,
    [memberMap]
  );
  const avatarOf = useCallback(
    (id: string) => teamMembers.find((m) => m.id === id),
    [teamMembers]
  );

  // ---- sound ----
  const [soundOn, setSoundOn] = useState(true);
  const [unlocked, setUnlocked] = useState(false);
  const soundOnRef = useRef(soundOn);
  soundOnRef.current = soundOn;
  useEffect(() => {
    setSoundOn(localStorage.getItem(SOUND_KEY) !== "0");
    if (isUnlocked()) {
      setUnlocked(true);
      return;
    }
    return unlockOnGesture(() => setUnlocked(true));
  }, []);
  const toggleSound = () => {
    setSoundOn((s) => {
      localStorage.setItem(SOUND_KEY, s ? "0" : "1");
      return !s;
    });
  };

  // ---- feed: seed once, then diff every poll ----
  const [feed, setFeed] = useState<FeedEvent[]>([]);
  const [toasts, setToasts] = useState<FeedEvent[]>([]);
  const snapRef = useRef<BoardSnapshot | null>(null);
  const seededRef = useRef(false);

  useEffect(() => {
    if (tickets.length === 0) return;

    if (!snapRef.current) {
      // First payload is the baseline — no notifications for existing state.
      snapRef.current = buildSnapshot(tickets);
      if (!seededRef.current) {
        seededRef.current = true;
        seedFeed(tickets, memberName).then((events) =>
          setFeed((f) =>
            [...events, ...f].sort((a, b) => b.at - a.at).slice(0, 60)
          )
        );
      }
      return;
    }

    const events = diffSnapshots(snapRef.current, tickets, memberName);
    snapRef.current = buildSnapshot(tickets);
    if (events.length === 0) return;

    // Swap the assignee guess for the real actor before showing anything
    resolveEventActors(events).then((resolved) => {
      setFeed((f) =>
        [...resolved, ...f].sort((a, b) => b.at - a.at).slice(0, 60)
      );
      const toToast = resolved.slice(0, 4);
      setToasts((t) => [...t, ...toToast].slice(-4));
      if (soundOnRef.current) playDing();
    });
  }, [tickets, memberName]);

  // Expire toasts off the 1s tick
  useEffect(() => {
    setToasts((t) => t.filter((e) => nowMs - e.at < TOAST_MS));
  }, [nowMs]);

  // FLIP: when the stack reflows (new toast pushes others up, or a removal
  // lets them settle down), animate siblings from their old position instead
  // of letting them jump. Skips toasts mid-exit so their slide-out isn't
  // interrupted.
  const toastListRef = useRef<HTMLDivElement>(null);
  const toastRectsRef = useRef<Map<string, number>>(new Map());
  useLayoutEffect(() => {
    const list = toastListRef.current;
    if (!list) return;
    const prevTops = toastRectsRef.current;
    const nextTops = new Map<string, number>();
    // Container rect + layout offset = viewport position without the child's
    // own in-flight entrance transform. The container is bottom-anchored, so
    // the container rect (not offsetTop) is what actually moves on reflow.
    const listTop = list.getBoundingClientRect().top;
    for (const child of Array.from(list.children)) {
      const el = child as HTMLElement;
      const id = el.dataset.toastid;
      if (!id) continue;
      const top = listTop + el.offsetTop;
      nextTops.set(id, top);
      if (el.classList.contains("wallboard-toast-out")) continue;
      const prevTop = prevTops.get(id);
      if (prevTop !== undefined && Math.abs(prevTop - top) > 1) {
        el.animate(
          [
            { transform: `translateY(${prevTop - top}px)` },
            { transform: "translateY(0)" },
          ],
          { duration: 350, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
        );
      }
    }
    toastRectsRef.current = nextTops;
  }, [toasts]);

  // Demo toasts: press "T" to preview toast styles (cycles through kinds)
  const demoIdxRef = useRef(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "t" || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      const samples: Omit<FeedEvent, "id" | "at">[] = [
        {
          key: "IST-5600",
          summary: "Recalculated tickets show water in liters instead of gallons",
          kind: "status",
          text: "In Progress → Code Review",
          who: "Kacper Warda",
        },
        {
          key: "IST-5598",
          summary: "Absorption column showing and moisture blank on tickets",
          kind: "comment",
          text: "new comment",
          who: "Jack Shynkaruk",
          detail:
            "Confirmed on the CBAT tenant — the column renders when the plant has a default mix but comes back blank on reprints. Suspect the PDF template, not the API.",
        },
        {
          key: "IST-5566",
          summary: "[A] Choose whether radios belong to trucks or drivers",
          kind: "priority",
          text: "priority Medium → High",
          who: "Mac Willingham",
        },
        {
          key: "IST-5589",
          summary: "[UI] Add remove-Zello-user action",
          kind: "assignee",
          text: "assigned to Bartek Kowalski",
          who: null,
        },
        {
          key: "web#482",
          summary: "fix: ticket reprint rounding on batch weights",
          kind: "pr-merged",
          text: "PR merged",
          who: "bkowalski",
        },
        {
          key: "api#217",
          summary: "feat: preventative maintenance notification hooks",
          kind: "pr-approved",
          text: "PR approved",
          who: "jshynkaruk",
        },
        {
          key: "api · production",
          summary: "istrada-api deploy of main",
          kind: "deploy-fail",
          text: "deployment failed",
          who: "github-actions",
        },
      ];
      const sample = samples[demoIdxRef.current++ % samples.length];
      const demo: FeedEvent = {
        ...sample,
        id: `demo-${Date.now()}-${demoIdxRef.current}`,
        at: Date.now(),
      };
      setToasts((t) => [...t, demo].slice(-4));
      if (soundOnRef.current) playDing();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Auto-scroll the story board when it overflows the panel
  const boardScrollRef = useRef<HTMLDivElement>(null);
  const scrollCtrl = useAutoScroll(boardScrollRef);

  // Board items with an active toast glow + pulse for the toast's lifetime
  const highlightKeys = useMemo(
    () => new Set(toasts.map((t) => t.key)),
    [toasts]
  );

  // When a new toast arrives, bring its board item into view (no-op for
  // GitHub events and items not on the board)
  const lastScrolledToastRef = useRef<string | null>(null);
  useEffect(() => {
    const latest = toasts[toasts.length - 1];
    if (!latest || lastScrolledToastRef.current === latest.id) return;
    lastScrolledToastRef.current = latest.id;
    scrollCtrl.current.scrollToKey(latest.key);
  }, [toasts, scrollCtrl]);

  // ---- GitHub PR + deployment activity → feed + notifications ----
  const { data: ghActivity } = useSWR<{
    configured: boolean;
    events: GitHubActivityEvent[];
  }>("/api/github/activity", fetcher, {
    refreshInterval: STATS_REFRESH_MS,
    revalidateOnFocus: false,
  });
  const ghSeenRef = useRef<Set<string>>(new Set());
  const ghBaselineRef = useRef(false);
  useEffect(() => {
    const events = ghActivity?.events;
    if (!events) return;
    const fresh = events.filter((e) => !ghSeenRef.current.has(e.id));
    for (const e of fresh) ghSeenRef.current.add(e.id);
    if (fresh.length > 0) {
      const feedEvents: FeedEvent[] = fresh.map((e) => ({
        id: e.id,
        key: e.label,
        summary: e.title,
        kind: e.kind,
        text: GITHUB_EVENT_TEXT[e.kind],
        who: e.actor,
        at: new Date(e.at).getTime(),
      }));
      setFeed((f) =>
        [...feedEvents, ...f].sort((a, b) => b.at - a.at).slice(0, 60)
      );
      // First poll seeds the feed silently; later polls notify
      if (ghBaselineRef.current) {
        const toToast = feedEvents
          .slice(0, 3)
          .map((e) => ({ ...e, at: Date.now() }));
        setToasts((t) => [...t, ...toToast].slice(-4));
        if (soundOnRef.current) playDing();
      }
    }
    ghBaselineRef.current = true;
  }, [ghActivity]);

  // ---- derived board data: group by story via parentKey ----
  const { activeGroups, collapsedGroups } = useMemo(() => {
    const byKey = new Map(tickets.map((t) => [t.key, t]));
    const parentKeys = new Set(
      tickets.map((t) => t.parentKey).filter((k): k is string => !!k && byKey.has(k))
    );
    // A group root is any Story, or any ticket that has subtasks pointing at it
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickets, Math.floor(nowMs / 60_000)]);

  const doneCount = useMemo(
    () => tickets.filter((t) => stageOf(t.status) === "Done").length,
    [tickets]
  );

  // Latest observed status transition per ticket (from the live diff / seed),
  // used to enrich subtask tooltips with "Open → In Progress · 3h ago".
  const lastTransition = useMemo(() => {
    const map = new Map<string, FeedEvent>();
    for (const e of feed) {
      if (e.kind === "status" && !map.has(e.key)) map.set(e.key, e);
    }
    return map;
  }, [feed]);
  const sprintMeta = useMemo(() => {
    if (!sprint) return null;
    const start = new Date(sprint.startDate).getTime();
    const end = new Date(sprint.endDate).getTime();
    const dayMs = 24 * 60 * 60 * 1000;
    const total = Math.max(1, Math.round((end - start) / dayMs));
    const day = Math.min(total, Math.max(1, Math.ceil((nowMs - start) / dayMs)));
    return { day, total };
  }, [sprint, nowMs]);

  return (
    <div
      className="dark fixed inset-0 z-50 flex flex-col gap-[0.7em] overflow-hidden bg-background p-[0.8em] text-foreground"
      style={{ fontSize: "20px" }}
    >
      {/* ---- Header ---- */}
      <header className="flex shrink-0 items-center gap-[0.9em] px-[0.2em]">
        <h1 className="flex items-center gap-[0.45em] text-[1.35em] font-bold tracking-tight">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icon.svg"
            alt="DeliveryGo"
            className="h-[1.15em] w-[1.15em]"
          />
          Mission Control
        </h1>
        {!configured && (
          <span className="text-[0.7em] text-amber-500">
            Jira not configured — showing demo data
          </span>
        )}
        <div className="ml-auto flex items-center gap-[0.6em]">
          {soundOn && !unlocked && (
            <span className="animate-pulse text-[0.6em] text-muted-foreground">
              click anywhere to enable sound
            </span>
          )}
          <button
            onClick={toggleSound}
            className="text-muted-foreground transition-colors hover:text-foreground"
            title={soundOn ? "Mute notifications" : "Unmute notifications"}
            aria-label={soundOn ? "Mute notifications" : "Unmute notifications"}
          >
            {soundOn ? (
              <Volume2 className="h-[1em] w-[1em]" />
            ) : (
              <VolumeX className="h-[1em] w-[1em]" />
            )}
          </button>
          <span className="text-[1.3em] font-semibold tabular-nums">
            {now === null
              ? "--:--"
              : new Date(now).toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                })}
          </span>
        </div>
      </header>

      {/* ---- KPI strip: product health (PR stats live in the rail panel) ---- */}
      <div className="grid shrink-0 grid-cols-5 gap-[0.55em]">
        <StatTile
          label="Active users (1h)"
          value={dd && dd.configured !== false ? dd.activeUsers : null}
          unconfigured={dd?.configured === false}
          spark={dd?.activeUsersSpark}
        />
        <StatTile
          label="Page views today"
          value={dd && dd.configured !== false ? formatK(dd.pageViews) : null}
          unconfigured={dd?.configured === false}
          spark={dd?.pageViewsSpark}
          delta={dd && dd.configured !== false ? deltaPct(dd.pageViews, dd.pageViewsPrev) : null}
          upIsGood
        />
        <StatTile
          label="Rage clicks today"
          value={dd && dd.configured !== false ? dd.rageClicks : null}
          unconfigured={dd?.configured === false}
          spark={dd?.rageClicksSpark}
          delta={dd && dd.configured !== false ? deltaPct(dd.rageClicks, dd.rageClicksPrev) : null}
          bad={!!dd && dd.configured !== false && dd.rageClicks >= 200}
        />
        <StatTile
          label="Page load (LCP p75)"
          value={dd && dd.configured !== false ? fmtLcp(dd.lcpP75Ms) : null}
          unconfigured={dd?.configured === false}
          delta={
            dd && dd.configured !== false && dd.lcpP75Ms !== null && dd.lcpP75PrevMs !== null
              ? deltaPct(dd.lcpP75Ms, dd.lcpP75PrevMs)
              : null
          }
          good={!!dd && dd.configured !== false && dd.lcpP75Ms !== null && dd.lcpP75Ms <= 2500}
          bad={!!dd && dd.configured !== false && dd.lcpP75Ms !== null && dd.lcpP75Ms > 4000}
        />
        <StatTile
          label="Sessions with errors"
          value={dd && dd.configured !== false ? `${dd.errorSessionPct.toFixed(0)}%` : null}
          unconfigured={dd?.configured === false}
          delta={dd && dd.configured !== false ? deltaPct(dd.errorSessionPct, dd.errorSessionPctPrev) : null}
          bad={!!dd && dd.configured !== false && dd.errorSessionPct >= 25}
        />
      </div>

      {/* ---- Main: board + rail ---- */}
      <div className="flex min-h-0 flex-1 gap-[0.7em]">
        <Panel
          title={
            sprint
              ? `${sprint.name}${sprintMeta ? ` · Day ${sprintMeta.day} of ${sprintMeta.total}` : ""} · ${doneCount} of ${tickets.length} tickets done`
              : "Sprint Board — by story"
          }
          className="flex-[2.4]"
        >
          <div
            ref={boardScrollRef}
            className="wallboard-noscrollbar flex min-h-0 flex-1 flex-col gap-[0.45em] overflow-y-auto"
          >
            {activeGroups.map((g) => (
              <StoryCard
                key={g.story?.key ?? "other-work"}
                group={g}
                nowMs={nowMs}
                avatarOf={avatarOf}
                lastTransition={lastTransition}
                highlightKeys={highlightKeys}
              />
            ))}
            {collapsedGroups.map((g) => (
              <div
                key={g.story!.key}
                className="flex shrink-0 items-center gap-[0.5em] px-[0.6em] opacity-50"
              >
                <span
                  className="shrink-0 whitespace-nowrap font-mono text-[0.6em] font-bold"
                  style={{ color: ACCENT }}
                >
                  {g.story!.key}
                </span>
                <StageChip status={g.story!.status} />
                <span className="truncate text-[0.62em] text-muted-foreground">
                  {g.story!.summary} — all {g.subs.length || ""} subtasks done
                </span>
                {g.story!.epicName && (
                  <span
                    className="max-w-[9em] shrink-0 truncate rounded-full border px-[0.55em] py-[0.1em] text-[0.5em] font-semibold uppercase tracking-wide"
                    style={{
                      color: g.story!.epicColor ?? "hsl(var(--muted-foreground))",
                      borderColor: `${g.story!.epicColor ?? "#888"}55`,
                      background: `${g.story!.epicColor ?? "#888"}14`,
                    }}
                  >
                    {g.story!.epicName}
                  </span>
                )}
              </div>
            ))}
          </div>
        </Panel>

        <div className="flex min-w-0 flex-1 flex-col gap-[0.7em]">
          <PullRequestsPanel gh={gh} />

          <Panel title="Recent Changes" className="min-h-0 flex-1" dotColor={ACCENT}>
            <div className="flex min-h-0 flex-1 flex-col gap-[0.5em] overflow-hidden">
              {feed.length === 0 && (
                <span className="text-[0.68em] text-muted-foreground">
                  Watching for changes…
                </span>
              )}
              {feed.slice(0, 16).map((e) => (
                <div key={e.id} className="flex items-start gap-[0.45em] text-[0.68em]">
                  <SourceIcon
                    kind={e.kind}
                    color={FEED_COLORS[e.kind]}
                    className="mt-[0.22em] h-[0.85em] w-[0.85em] shrink-0"
                  />
                  <div className="min-w-0 leading-snug">
                    <div className="truncate">
                      <span className="font-mono font-bold" style={{ color: ACCENT }}>
                        {e.key}
                      </span>{" "}
                      <span className="text-foreground/90">{e.summary}</span>
                    </div>
                    <div className="truncate text-[0.85em] text-muted-foreground">
                      {e.text}
                      {e.who ? ` · ${e.who}` : ""} · {relativeTime(e.at, nowMs)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      {/* ---- Toasts ---- */}
      <div
        ref={toastListRef}
        className="pointer-events-none absolute bottom-[0.9em] right-[0.9em] flex w-[28em] flex-col items-end gap-[0.55em]"
      >
        {toasts.map((e) => {
          // Window must exceed the 1s clock tick, or a toast can skip the
          // exit state entirely and vanish unanimated
          const leaving = nowMs - e.at >= TOAST_MS - 1200;
          return (
            <div
              key={e.id}
              data-toastid={e.id}
              className={cn(
                "wallboard-toast w-full rounded-xl border bg-popover px-[1em] py-[0.75em] shadow-2xl",
                leaving && "wallboard-toast-out"
              )}
              style={{ borderLeft: `0.3em solid ${FEED_COLORS[e.kind]}` }}
            >
              <div className="flex items-center gap-[0.5em] text-[0.85em] leading-snug">
                <SourceIcon
                  kind={e.kind}
                  color={FEED_COLORS[e.kind]}
                  className="h-[1em] w-[1em] shrink-0"
                />
                <span className="shrink-0 font-mono font-bold" style={{ color: ACCENT }}>
                  {e.key}
                </span>
                <span className="min-w-0 truncate font-semibold">{e.text}</span>
                <span className="ml-auto shrink-0 text-[0.75em] text-muted-foreground">
                  {relativeTime(e.at, nowMs)}
                </span>
              </div>
              <div className="mt-[0.25em] line-clamp-2 text-[0.72em] leading-snug text-foreground/85">
                {e.summary}
              </div>
              {e.who && (
                <div className="mt-[0.2em] text-[0.62em] text-muted-foreground">
                  by {e.who}
                </div>
              )}
              {e.detail && (
                <div className="mt-[0.35em] line-clamp-3 border-l-2 border-border pl-[0.6em] text-[0.66em] italic leading-snug text-foreground/75">
                  {e.detail}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <style>{`
        .wallboard-noscrollbar { scrollbar-width: none; }
        .wallboard-noscrollbar::-webkit-scrollbar { display: none; }
        .wallboard-glow {
          animation: wallboard-glow-pulse 1.2s ease-in-out infinite;
          opacity: 1 !important;
        }
        @keyframes wallboard-glow-pulse {
          0%, 100% {
            box-shadow: 0 0 0 1px rgba(68,147,248,0.4), 0 0 10px rgba(68,147,248,0.3);
          }
          50% {
            box-shadow: 0 0 0 2px rgba(68,147,248,0.8), 0 0 22px rgba(68,147,248,0.65);
          }
        }
        .wallboard-toast {
          animation: wallboard-toast-in 0.55s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        @keyframes wallboard-toast-in {
          from { transform: translateX(115%) scale(0.96); opacity: 0; }
          to { transform: translateX(0) scale(1); opacity: 1; }
        }
        .wallboard-toast-out {
          animation: wallboard-toast-out 0.5s cubic-bezier(0.55, 0, 0.85, 0.36) forwards;
        }
        @keyframes wallboard-toast-out {
          from { transform: translateX(0); opacity: 1; }
          to { transform: translateX(120%); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

/* ================= subcomponents ================= */

function Panel({
  title,
  titleRight,
  dotColor,
  className,
  titleClassName,
  children,
}: {
  title: string;
  titleRight?: React.ReactNode;
  dotColor?: string;
  className?: string;
  titleClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-xl border bg-muted/20 p-[0.7em]",
        className
      )}
    >
      <h2
        className={cn(
          "mb-[0.55em] flex items-center gap-[0.4em] text-[0.62em] font-semibold uppercase tracking-widest text-muted-foreground",
          titleClassName
        )}
      >
        {dotColor && (
          <span
            className="h-[0.55em] w-[0.55em] rounded-full"
            style={{ background: dotColor }}
          />
        )}
        {title}
        {titleRight}
      </h2>
      {children}
    </section>
  );
}

/** Per-repo PR pulse: open / opened today / merged today / avg open age. */
function PullRequestsPanel({ gh }: { gh?: GitHubSummary }) {
  return (
    <Panel title="Pull Requests" className="shrink-0" dotColor="#3fb950">
      {!gh ? (
        <span className="text-[0.68em] text-muted-foreground">Loading…</span>
      ) : gh.configured === false ? (
        <span className="text-[0.68em] text-muted-foreground/60">
          not configured
        </span>
      ) : (
        <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-x-[0.95em] gap-y-[0.3em] text-[0.68em] leading-snug">
          <span />
          <ColHead>open</ColHead>
          <ColHead>new</ColHead>
          <ColHead>merged</ColHead>
          <ColHead>avg</ColHead>
          <ColHead>oldest</ColHead>
          {(gh.repos ?? []).map((r) => (
            <PRRow
              key={r.repo}
              label={r.repo}
              open={r.openCount}
              opened={r.openedToday}
              merged={r.mergedToday}
              age={r.avgOpenAgeDays}
              oldest={r.oldestOpenAgeDays}
            />
          ))}
          <div className="col-span-6 my-[0.1em] border-t" />
          <PRRow
            label="total"
            open={gh.openCount}
            opened={gh.openedToday}
            merged={gh.mergedToday}
            age={gh.avgOpenAgeDays}
            oldest={gh.oldestOpenAgeDays}
            bold
          />
        </div>
      )}
    </Panel>
  );
}

function ColHead({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-right text-[0.78em] font-medium uppercase tracking-wider text-muted-foreground/70">
      {children}
    </span>
  );
}

function PRRow({
  label,
  open,
  opened,
  merged,
  age,
  oldest,
  bold,
}: {
  label: string;
  open: number;
  opened: number;
  merged: number;
  age: number;
  oldest: number;
  bold?: boolean;
}) {
  const num = cn("text-right tabular-nums", bold && "font-bold");
  return (
    <>
      <span className={cn("font-mono", bold ? "font-bold" : "text-foreground/85")}>
        {label}
      </span>
      <span className={num}>{open}</span>
      <span className={num}>{opened}</span>
      <span className={cn(num, merged > 0 && "text-green-400")}>{merged}</span>
      <span className={cn(num, "text-muted-foreground")}>
        {open === 0 ? "—" : `${age.toFixed(1)}d`}
      </span>
      <span
        className={cn(
          num,
          open === 0
            ? "text-muted-foreground"
            : oldest >= 90
              ? "text-amber-400"
              : "text-muted-foreground"
        )}
      >
        {open === 0 ? "—" : `${Math.round(oldest)}d`}
      </span>
    </>
  );
}

function StatTile({
  label,
  value,
  spark,
  delta,
  upIsGood,
  unconfigured,
  good,
  bad,
}: {
  label: string;
  value: string | number | null;
  spark?: number[];
  /** Signed %-change vs yesterday; null/undefined hides the delta. */
  delta?: number | null;
  /** Whether an increase in this metric is good news (colors the delta). */
  upIsGood?: boolean;
  unconfigured?: boolean;
  good?: boolean;
  bad?: boolean;
}) {
  const showDelta = typeof delta === "number" && Math.abs(delta) >= 1;
  const improving = showDelta && (delta > 0) === !!upIsGood;
  return (
    <div className="rounded-xl border bg-muted/20 px-[0.6em] py-[0.45em]">
      <div className="flex min-w-0 items-baseline gap-[0.35em]">
        <div
          className={cn(
            "text-[1.35em] font-bold leading-tight",
            good && "text-green-400",
            bad && "text-red-400"
          )}
        >
          {value ?? "—"}
        </div>
        {showDelta && (
          <span
            className={cn(
              "truncate text-[0.55em] font-semibold",
              improving ? "text-green-400" : "text-red-400"
            )}
          >
            {delta > 0 ? "▲" : "▼"}
            {Math.abs(delta).toFixed(0)}%{" "}
            <span className="font-normal text-muted-foreground">
              vs yesterday
            </span>
          </span>
        )}
      </div>
      <div className="truncate text-[0.52em] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      {unconfigured ? (
        <div className="text-[0.5em] text-muted-foreground/60">not configured</div>
      ) : (
        spark && spark.length > 1 && <Sparkline points={spark} />
      )}
    </div>
  );
}

const SPARK_LINE = "#8b949e"; // de-emphasis hue; the accent end-dot marks "now"

function Sparkline({ points }: { points: number[] }) {
  const w = 100;
  const h = 16;
  const max = Math.max(...points, 1);
  const y = (p: number) => h - 2 - (p / max) * (h - 4);
  const path = points
    .map((p, i) => `${((i / (points.length - 1)) * w).toFixed(1)},${y(p).toFixed(1)}`)
    .join(" ");
  const lastTopPct = (y(points[points.length - 1]) / h) * 100;
  return (
    <div className="relative mt-[0.2em] h-[0.8em] w-full">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="h-full w-full"
        preserveAspectRatio="none"
      >
        <polygon
          points={`0,${h} ${path} ${w},${h}`}
          fill={SPARK_LINE}
          opacity="0.12"
        />
        <polyline
          points={path}
          fill="none"
          stroke={SPARK_LINE}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {/* end-dot rides outside the SVG so preserveAspectRatio can't distort it */}
      <span
        className="absolute right-0 h-[5px] w-[5px] translate-x-1/2 rounded-full ring-2 ring-background"
        style={{ top: `calc(${lastTopPct.toFixed(1)}% - 2.5px)`, background: ACCENT }}
      />
    </div>
  );
}

function StageChip({ status }: { status: string }) {
  const stage = stageOf(status);
  const c = STAGE_COLORS[stage];
  return (
    <span
      className="shrink-0 rounded px-[0.4em] py-[0.05em] text-[0.55em] font-semibold whitespace-nowrap"
      style={{ background: `${c}22`, color: c }}
    >
      {stage}
    </span>
  );
}

function MoveBadge({ group, nowMs }: { group: StoryGroup; nowMs: number }) {
  const n = movedCount(group, nowMs);
  if (n > 0) {
    return (
      <span className="shrink-0 rounded bg-green-500/15 px-[0.45em] py-[0.08em] text-[0.52em] font-bold text-green-400 whitespace-nowrap">
        ▲ {n} moved
      </span>
    );
  }
  const idle = idleHours(group, nowMs);
  if (idle >= IDLE_BADGE_H) {
    return (
      <span className="shrink-0 rounded bg-amber-500/15 px-[0.45em] py-[0.08em] text-[0.52em] font-bold text-amber-400 whitespace-nowrap">
        idle {fmtAgo(idle)}
      </span>
    );
  }
  return <span className="shrink-0 text-[0.52em] text-muted-foreground/60">—</span>;
}

function StoryCard({
  group,
  nowMs,
  avatarOf,
  lastTransition,
  highlightKeys,
}: {
  group: StoryGroup;
  nowMs: number;
  avatarOf: (id: string) => { name: string; avatarUrl: string } | undefined;
  lastTransition: Map<string, FeedEvent>;
  highlightKeys: Set<string>;
}) {
  const { story, subs } = group;
  const chips = subs.length > 0 ? subs : story ? [story] : [];
  const storyHighlighted = !!story && highlightKeys.has(story.key) && subs.length > 0;

  return (
    <div
      data-wbkey={story?.key}
      className={cn(
        "shrink-0 rounded-lg border px-[0.6em] py-[0.45em]",
        story ? "bg-white/[0.025]" : "border-dashed bg-transparent",
        storyHighlighted && "wallboard-glow"
      )}
    >
      <div className="flex min-w-0 items-center gap-[0.55em]">
        {story ? (
          <>
            <span
              className="shrink-0 whitespace-nowrap font-mono text-[0.62em] font-bold"
              style={{ color: ACCENT }}
            >
              {story.key}
            </span>
            <StageChip status={story.status} />
            <span className="min-w-0 flex-1 truncate text-[0.65em]">
              {story.summary}
            </span>
            {story.epicName && (
              <span
                className="max-w-[9em] shrink-0 truncate rounded-full border px-[0.55em] py-[0.1em] text-[0.5em] font-semibold uppercase tracking-wide"
                style={{
                  color: story.epicColor ?? "hsl(var(--muted-foreground))",
                  borderColor: `${story.epicColor ?? "#888"}55`,
                  background: `${story.epicColor ?? "#888"}14`,
                }}
                title={story.epicName}
              >
                {story.epicName}
              </span>
            )}
          </>
        ) : (
          <span className="min-w-0 flex-1 truncate text-[0.58em] font-semibold uppercase tracking-widest text-muted-foreground">
            Other work
          </span>
        )}
        <MoveBadge group={group} nowMs={nowMs} />
        <span className="min-w-[2.4em] shrink-0 text-right text-[0.6em] tabular-nums text-muted-foreground">
          {story ? `${groupPct(group)}%` : ""}
        </span>
      </div>

      <div className="mt-[0.35em] flex flex-wrap gap-[0.3em]">
        {chips.map((t) => (
          <SubChip
            key={t.key}
            ticket={t}
            nowMs={nowMs}
            avatarOf={avatarOf}
            transition={lastTransition.get(t.key)}
            highlighted={highlightKeys.has(t.key)}
          />
        ))}
      </div>

      {story && subs.length > 0 && (
        <div className="mt-[0.35em] flex h-[0.28em] overflow-hidden rounded-full bg-white/[0.06]">
          {(["Done", "Testing", "Code Review", "In Progress", "Blocked"] as Stage[]).map(
            (stage) => {
              const n = subs.filter((t) => stageOf(t.status) === stage).length;
              if (n === 0) return null;
              return (
                <div
                  key={stage}
                  style={{
                    width: `${(n / subs.length) * 100}%`,
                    background: STAGE_COLORS[stage],
                  }}
                />
              );
            }
          )}
        </div>
      )}
    </div>
  );
}

function SubChip({
  ticket,
  nowMs,
  avatarOf,
  transition,
  highlighted,
}: {
  ticket: Ticket;
  nowMs: number;
  avatarOf: (id: string) => { name: string; avatarUrl: string } | undefined;
  transition?: FeedEvent;
  highlighted?: boolean;
}) {
  const moved = hasMoved(ticket, nowMs);
  const ago = hoursSince(ticket.lastActivityDate, nowMs);
  const member = avatarOf(ticket.assigneeId);
  const stage = stageOf(ticket.status);
  const tip = transition
    ? `${transition.text} · ${relativeTime(transition.at, nowMs)}`
    : `${stage} · updated ${fmtAgo(ago)} ago`;

  return (
    <div
      data-wbkey={ticket.key}
      className={cn(
        "flex w-[16.5em] shrink-0 flex-col gap-[0.1em] rounded-md px-[0.5em] py-[0.3em] text-[0.62em]",
        moved || highlighted
          ? "bg-[#4493f8]/[0.13] shadow-[inset_0_0_0_1px_rgba(68,147,248,0.25)]"
          : "bg-white/[0.05] opacity-35",
        highlighted && "wallboard-glow"
      )}
      title={tip}
    >
      <div className="flex min-w-0 items-center gap-[0.45em]">
        <span className="shrink-0 font-mono font-bold" style={{ color: ACCENT }}>
          {ticket.key.replace(/^\w+-/, "")}
        </span>
        <span
          className="shrink-0 whitespace-nowrap text-[0.85em] font-bold"
          style={{ color: STAGE_COLORS[stage] }}
        >
          {stage}
        </span>
        {moved && (
          <span className="shrink-0 whitespace-nowrap text-[0.9em] font-bold text-[#4493f8]">
            ↑{fmtAgo(ago)}
          </span>
        )}
        {member && (
          <Avatar className="ml-auto h-[1.4em] w-[1.4em] shrink-0">
            <AvatarImage src={member.avatarUrl} alt={member.name} />
            <AvatarFallback className="text-[0.55em]">
              {member.name.slice(0, 2)}
            </AvatarFallback>
          </Avatar>
        )}
      </div>
      <div className="truncate text-[0.92em] text-foreground/85">
        {ticket.summary}
      </div>
    </div>
  );
}

function formatK(n: number): string {
  if (n >= 10_000) return `${(n / 1000).toFixed(0)}k`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
