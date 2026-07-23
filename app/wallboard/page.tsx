"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import useSWR from "swr";
import { CalendarCheck, CalendarClock, Pause, Volume2, VolumeX } from "lucide-react";
import { useTicketData } from "@/lib/ticket-data-context";
import { cn } from "@/lib/utils";
import {
  BoardSnapshot,
  FEED_COLORS,
  FeedEvent,
  buildSnapshot,
  diffSnapshots,
  relativeTime,
  relativeTimeShort,
  resolveEventActors,
  seedFeed,
} from "./feed";
import ScrollingStoryBoard, {
  ScrollingStoryBoardHandle,
} from "./boards/ScrollingStoryBoard";
import StoryCompletionBoard from "./boards/StoryCompletionBoard";
import TeamScreen, {
  TEAM_ACTIVITY_REFRESH_MS,
  teamActivityKey,
} from "./screens/TeamScreen";
import MyDayScreen, {
  DayEvent,
  MY_DAY_REFRESH_MS,
  myDayKey,
  TASKS_REFRESH_MS,
  tasksKey,
} from "./screens/MyDayScreen";
import { localDateStr } from "./myday";
import {
  isUnlocked,
  playAlarm,
  playCountdownBeep,
  playDeployAlert,
  playDing,
  playLaunch,
  playStartNow,
  unlockOnGesture,
} from "./sound";
import { SourceIcon } from "./source-icons";
import StatusBar, { SourceStatus } from "./StatusBar";
import { stageOf } from "./stages";

const ACCENT = "#4493f8";
const TICKETS_REFRESH_MS = 60_000;
const STATS_REFRESH_MS = 300_000;
const TOAST_MS = 12_000;
const VERSION_POLL_MS = 120_000; // check for a new deploy every 2 min
const SOUND_KEY = "wallboard-sound";

// Full-screen views the wallboard rotates through (below the top toolbar).
const SCREENS = ["sprint", "team", "myday"] as const;
type Screen = (typeof SCREENS)[number];
const ROTATE_MS = 25_000; // dwell per screen before rotating

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
  jiraKey: string | null;
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

/**
 * Which sprint-board layout to render in the main panel. Swap to "scrolling"
 * to restore the original auto-scrolling, story-grouped board (kept as
 * <ScrollingStoryBoard> for the planned multi-page wallboard).
 */
const BOARD: "completion" | "scrolling" = "completion";

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

  // Per-source last-successful-poll stamps, feeding the footer StatusBar. A
  // source's dot blinks each time its stamp advances (see StatusBar).
  const [srcUpdated, setSrcUpdated] = useState<Record<string, number>>({});
  const stamp = useCallback(
    (k: string) => setSrcUpdated((u) => ({ ...u, [k]: Date.now() })),
    []
  );

  // Same cache key as TicketDataProvider — this hook just drives a faster
  // (60s) revalidation cadence while the wallboard is on screen.
  const { error: jiraError } = useSWR("/api/jira/tickets", fetcher, {
    refreshInterval: TICKETS_REFRESH_MS,
    revalidateOnFocus: false,
    onSuccess: () => stamp("jira"),
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
  const { data: gh, error: ghError } = useSWR<GitHubSummary>(
    `/api/github/prs/summary?since=${encodeURIComponent(dayStartISO)}`,
    fetcher,
    {
      refreshInterval: STATS_REFRESH_MS,
      revalidateOnFocus: false,
      onSuccess: () => stamp("github"),
    }
  );
  const { data: dd, error: ddError } = useSWR<DatadogSummary>(
    `/api/datadog/insights?dayStart=${encodeURIComponent(dayStartISO)}`,
    fetcher,
    {
      refreshInterval: STATS_REFRESH_MS,
      revalidateOnFocus: false,
      onSuccess: () => stamp("datadog"),
    }
  );
  // Keep the Team screen's slow rollup warm while any screen is up: same SWR
  // key as TeamScreen's hook, so by the time the rotation lands on it the
  // data renders instantly instead of showing "Loading…" for most of the
  // dwell. Raw json fetcher on purpose — the page's shaped `fetcher` would
  // poison this cache entry with a ticket-shaped fallback.
  useSWR(teamActivityKey(dayStartISO), (url: string) => fetch(url).then((r) => r.json()), {
    refreshInterval: TEAM_ACTIVITY_REFRESH_MS,
    revalidateOnFocus: false,
  });
  // Same idea for the My Day screen's tasks rail (its calendar key is already
  // kept warm by MeetingCountdown below).
  useSWR(tasksKey(localDateStr(dayStartDate)), (url: string) => fetch(url).then((r) => r.json()), {
    refreshInterval: TASKS_REFRESH_MS,
    revalidateOnFocus: false,
  });

  // Status-only mirror of the calendar poll (dedupes with MeetingCountdown's
  // hook — same key, so no extra request), surfaced here for the StatusBar.
  const { data: cal, error: calError } = useSWR<{ connected?: boolean }>(
    "/api/google/calendar/next",
    fetcher,
    {
      refreshInterval: 60_000,
      revalidateOnFocus: false,
      onSuccess: () => stamp("calendar"),
    }
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
  // Separate from the feed toasts — a meeting "starting now" alert, shown atop
  // the stack with its own styling.
  const [meetingToast, setMeetingToast] = useState<{
    id: string;
    summary: string;
    at: number;
  } | null>(null);
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
      // Feed keeps each event's real change time; toasts must carry the moment
      // they're SHOWN, or the expiry filter (nowMs - at < TOAST_MS) drops them
      // instantly — a change surfaced by the 60s poll is already older than the
      // toast lifetime. Same stamp the GitHub path applies.
      const shownAt = Date.now();
      const toToast = resolved.slice(0, 4).map((e) => ({ ...e, at: shownAt }));
      setToasts((t) => [...t, ...toToast].slice(-4));
      if (soundOnRef.current) playDing();
    });
  }, [tickets, memberName]);

  // Expire toasts off the 1s tick. Keep the same array reference when nothing
  // expired — a fresh array every tick would churn identity and retrigger any
  // effect that depends on `toasts` (e.g. the idle-gated reload below) every
  // second.
  useEffect(() => {
    setToasts((t) => {
      const next = t.filter((e) => nowMs - e.at < TOAST_MS);
      return next.length === t.length ? t : next;
    });
    setMeetingToast((m) => (m && nowMs - m.at < TOAST_MS ? m : null));
  }, [nowMs]);

  // ---- auto-reload on new deploy (idle-gated) ----
  // A TV tab keeps running the JS bundle it first loaded, so a Vercel deploy
  // won't reach it. Poll the serving deployment's id, baseline it on load, and
  // when it changes flag an update — then reload only once nothing is on
  // screen (see the idle gate below) so we never interrupt standup mid-toast.
  const deployVersionRef = useRef<string | null>(null);
  const [updatePending, setUpdatePending] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [versionOk, setVersionOk] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) {
          if (!cancelled) setVersionOk(false);
          return;
        }
        const { version } = (await res.json()) as { version?: string };
        if (!version || cancelled) return;
        setVersionOk(true);
        stamp("vercel");
        if (deployVersionRef.current === null) {
          deployVersionRef.current = version; // baseline = version at load
        } else if (version !== deployVersionRef.current) {
          setUpdatePending(true);
        }
      } catch {
        /* transient network error — try again next tick */
        if (!cancelled) setVersionOk(false);
      }
    }
    check();
    const id = setInterval(check, VERSION_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [stamp]);

  // Idle gate: kick off the dramatic reload sequence only when no toast/meeting
  // alert is showing, so we never cover the board mid-standup. Once it starts
  // it commits (DeployCountdown handles the countdown + reload).
  useEffect(() => {
    if (!updatePending || reloading) return;
    if (toasts.length > 0 || meetingToast) return;
    setReloading(true);
  }, [updatePending, reloading, toasts, meetingToast]);

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

  // ---- screen rotation: Sprint → Team activity → My Day ----
  // Auto-rotates on a timer; press 1/2/3 to pin a screen, 0 to resume. Never
  // rotates away while a toast/meeting alert is up, so an update is never
  // hidden mid-standup.
  const [screenIdx, setScreenIdx] = useState(0);
  const [pinnedScreen, setPinnedScreen] = useState<Screen | null>(null);
  const [paused, setPaused] = useState(false);
  const rotateGateRef = useRef({ busy: false });
  rotateGateRef.current.busy = toasts.length > 0 || meetingToast !== null;
  useEffect(() => {
    if (pinnedScreen || paused) return;
    const id = setInterval(() => {
      if (rotateGateRef.current.busy) return;
      setScreenIdx((i) => (i + 1) % SCREENS.length);
    }, ROTATE_MS);
    return () => clearInterval(id);
  }, [pinnedScreen, paused]);
  // Manually step to another screen. Clears any pin and lands on the target
  // relative to whatever is currently shown; leaves the paused state alone so
  // you can pause and then step through by hand.
  const advance = useCallback(
    (dir: 1 | -1) => {
      setPinnedScreen((pin) => {
        setScreenIdx((i) => {
          const shown = pin ? SCREENS.indexOf(pin) : i;
          return (shown + dir + SCREENS.length) % SCREENS.length;
        });
        return null;
      });
    },
    [],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tgt = e.target as HTMLElement;
      if (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA") return;
      if (e.key === "1") setPinnedScreen("sprint");
      else if (e.key === "2") setPinnedScreen("team");
      else if (e.key === "3") setPinnedScreen("myday");
      else if (e.key === "0") {
        setPinnedScreen(null);
        setPaused(false);
      } else if (e.key === "ArrowRight" || e.key.toLowerCase() === "n") {
        e.preventDefault();
        advance(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        advance(-1);
      } else if (e.key === " " || e.key.toLowerCase() === "p") {
        e.preventDefault();
        setPaused((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advance]);
  const targetScreen: Screen = pinnedScreen ?? SCREENS[screenIdx];

  // Screen swap. Preferred path: a View Transition — the browser snapshots
  // the outgoing screen, the incoming one is committed synchronously, and
  // boxes sharing a view-transition-name (wb-main, wb-rail, wb-kpi-N…) morph
  // between their old and new geometry while everything else cross-fades.
  // Calling startViewTransition again mid-flight auto-skips the previous one,
  // so rapid pinning (1/2/3) needs no queueing. Fallback (no support, or
  // reduced motion): the original two-phase fade/slide-out → keyed remount.
  const [screen, setScreen] = useState<Screen>(targetScreen);
  const [screenLeaving, setScreenLeaving] = useState(false);
  // True once a morph swap has happened; suppresses the wrapper's own
  // screen-in animation and the named boxes' fade-ups (the morph replaces
  // them), while the very first mount keeps its full entrance choreography.
  const [morphed, setMorphed] = useState(false);
  useEffect(() => {
    if (targetScreen === screen) return;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    if (document.startViewTransition && !reduceMotion) {
      document.startViewTransition(() => {
        // flushSync so the new screen is in the DOM before the browser
        // captures the "new" snapshots (the standard React 18 pattern).
        flushSync(() => {
          setScreen(targetScreen);
          setMorphed(true);
        });
      });
      return;
    }
    setScreenLeaving(true);
    const id = setTimeout(() => {
      setScreen(targetScreen);
      setScreenLeaving(false);
    }, 300); // matches wallboard-screen-out
    return () => clearTimeout(id);
  }, [targetScreen, screen]);

  // Auto-scroll the story board when it overflows the panel
  const scrollBoardRef = useRef<ScrollingStoryBoardHandle>(null);

  // Board items with an active toast glow + pulse for the toast's lifetime
  const highlightKeys = useMemo(
    () => new Set(toasts.map((t) => t.key)),
    [toasts]
  );

  // When a new toast arrives, bring its board item into view (no-op for
  // GitHub events, items not on the board, and the static completion board)
  const lastScrolledToastRef = useRef<string | null>(null);
  useEffect(() => {
    const latest = toasts[toasts.length - 1];
    if (!latest || lastScrolledToastRef.current === latest.id) return;
    lastScrolledToastRef.current = latest.id;
    scrollBoardRef.current?.scrollToKey(latest.key);
  }, [toasts]);

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
        jiraKey: e.jiraKey,
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

  // Connection health for the footer StatusBar, derived from the same poll
  // state the board already renders from. Precedence: unconfigured → error →
  // (never polled yet) loading → ok.
  const sources = useMemo<SourceStatus[]>(() => {
    const make = (
      label: string,
      key: string,
      unconfigured: boolean,
      error: unknown
    ): SourceStatus => {
      const updatedAt = srcUpdated[key] ?? null;
      const state = unconfigured
        ? "unconfigured"
        : error
          ? "error"
          : updatedAt === null
            ? "loading"
            : "ok";
      return { label, state, updatedAt };
    };
    return [
      make("Jira", "jira", configured === false, jiraError),
      make("GitHub", "github", gh?.configured === false, ghError),
      make("Datadog", "datadog", dd?.configured === false, ddError),
      make("Calendar", "calendar", cal?.connected === false, calError),
      {
        label: "Vercel",
        state:
          versionOk === false ? "error" : versionOk === null ? "loading" : "ok",
        updatedAt: srcUpdated["vercel"] ?? null,
      },
    ];
  }, [
    srcUpdated,
    configured,
    jiraError,
    gh,
    ghError,
    dd,
    ddError,
    cal,
    calError,
    versionOk,
  ]);

  return (
    <div
      className="dark fixed inset-0 z-50 flex flex-col gap-[0.7em] overflow-hidden bg-background p-[0.8em] text-foreground"
      style={{ fontSize: "20px" }}
    >
      {/* ---- Header ---- */}
      <header className="wb-vt-header flex shrink-0 items-center gap-[0.9em] px-[0.2em]">
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
          {paused && (
            <span
              className="flex items-center gap-[0.3em] rounded-full bg-amber-500/15 px-[0.6em] py-[0.2em] text-[0.55em] font-semibold uppercase tracking-wide text-amber-400"
              title="Auto-rotation paused — press Space or P to resume"
            >
              <Pause className="h-[1em] w-[1em]" />
              Paused
            </span>
          )}
          {soundOn && !unlocked && (
            <span className="animate-pulse text-[0.6em] text-muted-foreground">
              click anywhere to enable sound
            </span>
          )}
          {updatePending && (
            <span
              className="animate-pulse text-[0.55em] text-muted-foreground"
              title="A new version is deployed — reloading when idle"
            >
              update ready · reloading soon
            </span>
          )}
          <MeetingCountdown
            nowMs={nowMs}
            dayStartISO={dayStartISO}
            soundOn={soundOn}
            onStartingNow={(id, summary) =>
              setMeetingToast({ id, summary, at: Date.now() })
            }
          />
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

      <div
        key={screen}
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-[0.7em]",
          morphed && "wallboard-morph",
          screenLeaving
            ? "wallboard-screen-out"
            : !morphed && "wallboard-screen-in"
        )}
      >
      {screen === "team" ? (
        <TeamScreen dayStartISO={dayStartISO} />
      ) : screen === "myday" ? (
        <MyDayScreen dayStartISO={dayStartISO} nowMs={nowMs} />
      ) : (
        <>
      {/* ---- KPI strip: product health (PR stats live in the rail panel) ---- */}
      <div className="grid shrink-0 grid-cols-5 gap-[0.55em]">
        <StatTile
          label="Active users (1h)"
          value={dd && dd.configured !== false ? dd.activeUsers : null}
          unconfigured={dd?.configured === false}
          spark={dd?.activeUsersSpark}
          delay={0}
          className="wb-vt wb-vt-kpi-0"
        />
        <StatTile
          label="Page views today"
          value={dd && dd.configured !== false ? formatK(dd.pageViews) : null}
          unconfigured={dd?.configured === false}
          spark={dd?.pageViewsSpark}
          delta={dd && dd.configured !== false ? deltaPct(dd.pageViews, dd.pageViewsPrev) : null}
          upIsGood
          delay={70}
          className="wb-vt wb-vt-kpi-1"
        />
        <StatTile
          label="Rage clicks today"
          value={dd && dd.configured !== false ? dd.rageClicks : null}
          unconfigured={dd?.configured === false}
          spark={dd?.rageClicksSpark}
          delta={dd && dd.configured !== false ? deltaPct(dd.rageClicks, dd.rageClicksPrev) : null}
          bad={!!dd && dd.configured !== false && dd.rageClicks >= 200}
          delay={140}
          className="wb-vt wb-vt-kpi-2"
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
          delay={210}
          className="wb-vt wb-vt-kpi-3"
        />
        <StatTile
          label="Sessions with errors"
          value={dd && dd.configured !== false ? `${dd.errorSessionPct.toFixed(0)}%` : null}
          unconfigured={dd?.configured === false}
          delta={dd && dd.configured !== false ? deltaPct(dd.errorSessionPct, dd.errorSessionPctPrev) : null}
          bad={!!dd && dd.configured !== false && dd.errorSessionPct >= 25}
          delay={280}
          className="wb-vt wb-vt-kpi-4"
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
          className="wallboard-fade-up wb-vt wb-vt-main flex-[2.4] [animation-delay:120ms]"
        >
          {BOARD === "scrolling" ? (
            <ScrollingStoryBoard
              ref={scrollBoardRef}
              tickets={tickets}
              nowMs={nowMs}
              avatarOf={avatarOf}
              lastTransition={lastTransition}
              highlightKeys={highlightKeys}
            />
          ) : (
            <StoryCompletionBoard
              tickets={tickets}
              nowMs={nowMs}
              avatarOf={avatarOf}
              highlightKeys={highlightKeys}
            />
          )}
        </Panel>

        <div className="flex min-w-0 flex-1 flex-col gap-[0.7em]">
          <PullRequestsPanel gh={gh} />

          <Panel
            title="Activity Feed"
            className="wallboard-fade-up wb-vt wb-vt-rail min-h-0 flex-1 [animation-delay:280ms]"
            dotColor={ACCENT}
          >
            <div className="flex min-h-0 flex-1 flex-col gap-[0.5em] overflow-hidden">
              {feed.length === 0 && (
                <span className="text-[0.68em] text-muted-foreground">
                  Watching for changes…
                </span>
              )}
              {feed.slice(0, 16).map((e, i) => (
                // One row per activity, newest first. The per-kind icon marks
                // the activity type (git PR state, deploy, Jira change); the
                // change text is the emphasized line, with who + title below.
                // Rows are keyed, so the stagger only replays on screen mount;
                // a mid-view arrival fades in at delay ~0.
                <div
                  key={e.id}
                  className="wallboard-fade-up flex items-start gap-[0.55em] text-[0.68em]"
                  style={{ animationDelay: `${300 + Math.min(i, 12) * 45}ms` }}
                >
                  <SourceIcon
                    kind={e.kind}
                    color={FEED_COLORS[e.kind]}
                    className="mt-[0.15em] h-[0.95em] w-[0.95em] shrink-0"
                  />
                  <div className="min-w-0 flex-1 leading-snug">
                    {/* line 1: which item · WHAT CHANGED · when */}
                    <div className="flex items-baseline gap-[0.4em]">
                      <span
                        className="shrink-0 font-mono font-bold"
                        style={{ color: ACCENT }}
                      >
                        {e.jiraKey ?? e.key}
                      </span>
                      {e.jiraKey && (
                        <span className="shrink-0 font-mono text-[0.9em] text-muted-foreground">
                          {e.key}
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate font-semibold text-foreground">
                        {e.text}
                      </span>
                      <span className="shrink-0 tabular-nums text-[0.85em] text-muted-foreground">
                        {relativeTimeShort(e.at, nowMs)}
                      </span>
                    </div>
                    {/* line 2: who + ticket/PR title */}
                    <div className="truncate text-[0.85em] text-muted-foreground">
                      {e.who && (
                        <span className="text-foreground/70">{e.who}</span>
                      )}
                      {e.who ? " · " : ""}
                      {e.summary}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
        </>
      )}
      </div>

      {/* ---- Footer: upstream connection health ---- */}
      <StatusBar sources={sources} nowMs={nowMs} />

      {/* ---- Toasts ---- */}
      <div
        ref={toastListRef}
        className="pointer-events-none absolute bottom-[0.9em] right-[0.9em] flex w-[28em] flex-col items-end gap-[0.55em]"
      >
        {meetingToast && (
          <div
            key={meetingToast.id}
            className={cn(
              "wallboard-toast w-full rounded-xl border border-red-500/40 bg-popover px-[1em] py-[0.85em] shadow-2xl",
              nowMs - meetingToast.at >= TOAST_MS - 1200 && "wallboard-toast-out"
            )}
            style={{ borderLeft: "0.3em solid rgb(239,68,68)" }}
          >
            <div className="flex items-center gap-[0.5em] text-[0.95em] leading-snug">
              <CalendarClock className="h-[1.1em] w-[1.1em] shrink-0 text-red-400" />
              <span className="font-semibold text-red-300">
                Meeting starting now
              </span>
            </div>
            <div className="mt-[0.25em] truncate text-[0.8em] font-medium text-foreground/90">
              {meetingToast.summary}
            </div>
          </div>
        )}
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
                  {e.jiraKey ?? e.key}
                </span>
                {e.jiraKey && (
                  <span className="shrink-0 font-mono text-[0.85em] text-muted-foreground">
                    {e.key}
                  </span>
                )}
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

      {reloading && (
        <DeployCountdown
          soundOn={soundOn}
          onComplete={() => window.location.reload()}
        />
      )}

      {/* dangerouslySetInnerHTML: SSR escapes apostrophes/quotes in <style>
          text children, tripping a hydration text-mismatch in dev. */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
        /* Screen-rotation transition: outgoing view lifts away, incoming view
           settles in (the incoming wrapper is keyed, so children's own
           entrance staggers replay with it). */
        .wallboard-screen-in {
          animation: wallboard-screen-in 0.5s cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        @keyframes wallboard-screen-in {
          from { opacity: 0; transform: translateY(0.9em) scale(0.992); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .wallboard-screen-out {
          animation: wallboard-screen-out 0.3s ease-in forwards;
        }
        @keyframes wallboard-screen-out {
          from { opacity: 1; transform: translateY(0) scale(1); }
          to { opacity: 0; transform: translateY(-0.7em) scale(0.996); }
        }
        /* ---- Morph transitions (View Transitions API) ----
           Boxes that play the same role on different screens share a
           view-transition-name, so on a screen swap the browser animates one
           box's frame into the other's (KPI tiles tile-to-tile, the big main
           panel, the rail). Defined here (not per screen) since the page's
           style block is mounted for every screen. */
        .wb-vt-header { view-transition-name: wb-header; }
        .wb-vt-main { view-transition-name: wb-main; }
        .wb-vt-rail { view-transition-name: wb-rail; }
        .wb-vt-rail-top { view-transition-name: wb-rail-top; }
        .wb-vt-kpi-0 { view-transition-name: wb-kpi-0; }
        .wb-vt-kpi-1 { view-transition-name: wb-kpi-1; }
        .wb-vt-kpi-2 { view-transition-name: wb-kpi-2; }
        .wb-vt-kpi-3 { view-transition-name: wb-kpi-3; }
        .wb-vt-kpi-4 { view-transition-name: wb-kpi-4; }
        /* Once swaps are morph-driven, a named box must not ALSO play its own
           fade-up (the morph owns the container; children keep their
           staggers). First mount has no .wallboard-morph, so the full
           entrance choreography still plays there. */
        .wallboard-morph .wb-vt { animation: none; }
        ::view-transition-group(*) {
          animation-duration: 0.55s;
          animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
        }
        ::view-transition-old(root),
        ::view-transition-new(root) {
          animation-duration: 0.45s;
        }
        /* Snapshots fill the morphing frame and crop instead of stretching,
           so panel text never squashes mid-flight. */
        ::view-transition-old(*),
        ::view-transition-new(*) {
          height: 100%;
          width: 100%;
          object-fit: cover;
        }
        /* Shared entrance stagger (tiles, panels, rows) + bar-grow, same
           curves as the Team screen's ts-* set. From-only keyframes with a
           backwards fill: hidden through the stagger delay, animate toward the
           element's natural style, then fully release — so they never fight
           the board's FLIP inline transforms or an element's own opacity. */
        .wallboard-fade-up {
          animation: wallboard-fade-up 0.6s cubic-bezier(0.22, 1, 0.36, 1) backwards;
        }
        @keyframes wallboard-fade-up {
          from { opacity: 0; transform: translateY(0.6em); }
        }
        .wallboard-grow-x {
          transform-origin: left center;
          animation: wallboard-grow-x 0.9s cubic-bezier(0.22, 1, 0.36, 1) backwards;
        }
        @keyframes wallboard-grow-x {
          from { transform: scaleX(0); }
        }
        .wallboard-noscrollbar { scrollbar-width: none; }
        .wallboard-noscrollbar::-webkit-scrollbar { display: none; }
        /* Status-dot blink: one expanding ring on each successful poll. The dot
           element is keyed on updatedAt, so a fresh poll remounts it and the
           non-looping animation replays — a visible "heartbeat" of liveness. */
        .wallboard-status-ping {
          animation: wallboard-status-ping 1.6s cubic-bezier(0, 0, 0.2, 1);
        }
        @keyframes wallboard-status-ping {
          0% { transform: scale(1); opacity: 0.75; }
          80%, 100% { transform: scale(2.6); opacity: 0; }
        }
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
        .wallboard-cd-pulse {
          animation: wallboard-cd-pulse 1.6s ease-in-out infinite;
        }
        .wallboard-cd-pulse-fast {
          animation: wallboard-cd-pulse 0.7s ease-in-out infinite;
        }
        /* Glow ring, not scale — keeps the pill footprint fixed so it never
           grows into the volume icon beside it. red-500 = 239,68,68. */
        @keyframes wallboard-cd-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0); opacity: 0.92; }
          50% { box-shadow: 0 0 0 2px rgba(239,68,68,0.45), 0 0 11px rgba(239,68,68,0.4); opacity: 1; }
        }
        /* Countdown pill entrance: drops in from the header when the next
           meeting first comes into range. */
        .wallboard-cd-in {
          animation: wallboard-cd-in 0.6s cubic-bezier(0.22, 1, 0.36, 1) backwards;
        }
        @keyframes wallboard-cd-in {
          from { opacity: 0; transform: translateY(-0.55em) scale(0.92); }
        }
        /* Alarm-bell wiggle on the calendar icon in the red tiers: a short
           ring, then still for the rest of the cycle so it stays glanceable
           rather than frantic. */
        .wallboard-cd-bell {
          transform-origin: 50% 20%;
          animation: wallboard-cd-bell 1.6s ease-in-out infinite;
        }
        @keyframes wallboard-cd-bell {
          0%, 55%, 100% { transform: rotate(0); }
          62% { transform: rotate(13deg); }
          70% { transform: rotate(-11deg); }
          78% { transform: rotate(7deg); }
          86% { transform: rotate(-4deg); }
          93% { transform: rotate(2deg); }
        }
        /* Final-minute tick: each second lands with a quick settle pop (the
           span is re-keyed per second so this replays). */
        .wallboard-cd-tick {
          display: inline-block;
          animation: wallboard-cd-tick 0.35s cubic-bezier(0.22, 1, 0.36, 1);
        }
        @keyframes wallboard-cd-tick {
          from { transform: scale(1.22); opacity: 0.55; }
          to { transform: scale(1); opacity: 1; }
        }
        /* Deploy rocket-launch overlay */
        .wallboard-deploy-overlay {
          animation: wallboard-deploy-in 0.35s ease-out,
                     wallboard-deploy-vignette 1s ease-in-out infinite;
        }
        @keyframes wallboard-deploy-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes wallboard-deploy-vignette {
          0%, 100% { box-shadow: inset 0 0 160px 30px rgba(68,147,248,0.12); }
          50% { box-shadow: inset 0 0 240px 70px rgba(68,147,248,0.4); }
        }
        /* Each countdown number zooms in and settles (re-keyed per tick) */
        .wallboard-deploy-pop {
          animation: wallboard-deploy-pop 0.55s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        @keyframes wallboard-deploy-pop {
          0% { transform: scale(2.4); opacity: 0; filter: blur(6px); }
          55% { transform: scale(0.9); opacity: 1; filter: blur(0); }
          100% { transform: scale(1); opacity: 1; }
        }
      `,
        }}
      />
    </div>
  );
}

/* ================= subcomponents ================= */

/**
 * Full-screen "rocket launch" overlay shown when a new deploy is detected and
 * the board is idle. Counts 5→GO with escalating blips + a klaxon intro and a
 * blastoff at zero, then reloads the tab. Purely for fun — it only appears on
 * an actual deploy, which is rare.
 */
function DeployCountdown({
  soundOn,
  onComplete,
}: {
  soundOn: boolean;
  onComplete: () => void;
}) {
  const START = 5;
  const [count, setCount] = useState(START);
  const done = useRef(false);

  useEffect(() => {
    if (soundOn) playDeployAlert();
    let n = START;
    const id = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(id);
        setCount(0);
        if (soundOn) playLaunch();
        if (!done.current) {
          done.current = true;
          setTimeout(onComplete, 750); // let "GO" + blastoff land
        }
        return;
      }
      setCount(n);
      if (soundOn) playCountdownBeep(n);
    }, 1000);
    return () => clearInterval(id);
    // Run once — the sequence owns its own lifecycle from here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const go = count === 0;
  const hue = go ? "#22c55e" : ACCENT;

  return (
    <div
      className="wallboard-deploy-overlay fixed inset-0 z-[60] flex flex-col items-center justify-center gap-[0.35em] bg-black/85 backdrop-blur-sm"
      style={{ fontSize: "20px" }}
    >
      <div
        className="text-[1.5em] font-black uppercase tracking-[0.35em]"
        style={{ color: ACCENT, textShadow: `0 0 34px ${ACCENT}` }}
      >
        🚀 New Version Deployed
      </div>
      <div
        key={count}
        className="wallboard-deploy-pop font-black leading-none tabular-nums"
        style={{
          fontSize: "11em",
          color: hue,
          textShadow: `0 0 70px ${hue}, 0 0 24px ${hue}`,
        }}
      >
        {go ? "GO" : count}
      </div>
      <div className="text-[0.95em] uppercase tracking-[0.4em] text-muted-foreground">
        Reloading Mission Control
      </div>
    </div>
  );
}

// Press "c" on the wallboard to cycle the countdown through these simulated
// variants (then back to live data) — lets you eyeball every escalation tier
// and hear the 1-minute alarm without waiting for a real meeting. Each entry
// is an offset (seconds until start) that lands squarely in one tier; the
// clock then ticks it down naturally, so you'll watch it cross into the next
// tier too.
const SIM_TIERS: { name: string; offset: number }[] = [
  { name: ">10 min", offset: 15 * 60 },
  { name: "≤10 min", offset: 8 * 60 },
  { name: "≤5 min", offset: 4 * 60 },
  { name: "≤2 min", offset: 110 },
  { name: "≤1 min", offset: 45 },
  { name: "starting now", offset: -5 },
];
// One extra sim position past the tiers: preview the green "all meetings for
// the day complete" pill without waiting for the calendar to actually clear.
const SIM_DONE_POS = SIM_TIERS.length + 1;

/**
 * Header meeting countdown, fed by the primary Google calendar. Stays hidden
 * until the next meeting is within 10 minutes, then counts down mm:ss and
 * escalates in prominence: amber ≤5m, red + gentle pulse ≤2m, red + fast pulse
 * ≤1m (with a one-time alarm chime), "starting now" at 0. Clears ~2m after
 * start. Once every timed meeting on today's calendar has ended, the pill
 * turns green: "All meetings for the day complete" (re-arms at midnight when
 * dayStartISO rolls over). Shares the page's 1s `now` tick so the seconds
 * tick without extra timers, and polls the API once a minute. Press "c" to
 * simulate the tiers (see SIM_TIERS; the last position previews the green
 * all-done pill).
 */
function MeetingCountdown({
  nowMs,
  dayStartISO,
  soundOn,
  onStartingNow,
}: {
  nowMs: number;
  dayStartISO: string;
  soundOn: boolean;
  onStartingNow: (id: string, summary: string) => void;
}) {
  const { data } = useSWR<{
    meeting: { summary: string; startISO: string } | null;
  }>("/api/google/calendar/next", fetcher, {
    refreshInterval: 60_000,
    revalidateOnFocus: false,
  });
  const realMeeting = data?.meeting ?? null;

  // Today's full calendar — same SWR key as the My Day screen, so this poll
  // both feeds the all-done pill and keeps that screen's cache warm.
  const { data: dayData } = useSWR<{ events: DayEvent[] }>(
    myDayKey(dayStartISO),
    fetcher,
    { refreshInterval: MY_DAY_REFRESH_MS, revalidateOnFocus: false }
  );

  // Simulation state: `pos` 0 = live data, 1..N = SIM_TIERS[pos-1],
  // N+1 = simulated all-done. `startMs` is captured at key press so the
  // countdown ticks down from there.
  const [sim, setSim] = useState<{ pos: number; startMs: number } | null>(null);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== "c" || e.metaKey || e.ctrlKey || e.altKey)
        return;
      const tgt = e.target as HTMLElement | null;
      if (
        tgt &&
        (tgt.tagName === "INPUT" ||
          tgt.tagName === "TEXTAREA" ||
          tgt.isContentEditable)
      )
        return;
      setSim((cur) => {
        const nextPos = ((cur?.pos ?? 0) + 1) % (SIM_TIERS.length + 2);
        if (nextPos === 0) return null; // back to live
        if (nextPos === SIM_DONE_POS) return { pos: nextPos, startMs: 0 };
        return {
          pos: nextPos,
          startMs: Date.now() + SIM_TIERS[nextPos - 1].offset * 1000,
        };
      });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const simDone = sim?.pos === SIM_DONE_POS;

  const meeting = useMemo(
    () =>
      sim && !simDone
        ? {
            summary: `${SIM_TIERS[sim.pos - 1].name} — simulated meeting`,
            startISO: new Date(sim.startMs).toISOString(),
          }
        : simDone
          ? null
          : realMeeting,
    [sim, simDone, realMeeting]
  );

  // Day-complete check: at least one timed meeting today, every one ended.
  // All-day events don't count — they never "finish". Takes priority over the
  // countdown (which would otherwise show tomorrow's first meeting).
  const timedToday = useMemo(
    () => (dayData?.events ?? []).filter((e) => !e.allDay),
    [dayData]
  );
  const allDone =
    simDone ||
    (!sim &&
      timedToday.length > 0 &&
      timedToday.every((e) => new Date(e.endISO).getTime() <= nowMs));

  const startMs = meeting ? new Date(meeting.startISO).getTime() : null;
  const secsUntil =
    startMs !== null ? Math.floor((startMs - nowMs) / 1000) : null;

  // Fire the 1-minute alarm once per meeting; re-arms when a new meeting
  // (different start) becomes the next one.
  const alarmedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!meeting || secsUntil === null) return;
    if (
      secsUntil <= 60 &&
      secsUntil > 0 &&
      alarmedFor.current !== meeting.startISO
    ) {
      alarmedFor.current = meeting.startISO;
      if (soundOn) playAlarm();
    }
  }, [meeting, secsUntil, soundOn]);

  // At start (T-0): once per meeting, play the distinct "starting now" chime
  // and raise the toast.
  const startedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!meeting || secsUntil === null) return;
    if (secsUntil <= 0 && startedFor.current !== meeting.startISO) {
      startedFor.current = meeting.startISO;
      if (soundOn) playStartNow();
      onStartingNow(meeting.startISO, meeting.summary);
    }
  }, [meeting, secsUntil, soundOn, onStartingNow]);

  // Calendar cleared for the day — green pill instead of a countdown (which
  // would otherwise already be pointing at tomorrow's first meeting).
  if (allDone) {
    return (
      <span
        className="wallboard-cd-in flex items-center gap-[0.4em] whitespace-nowrap rounded-full border border-green-500/45 bg-green-500/10 px-[0.6em] py-[0.22em] text-[0.78em] font-medium text-green-300"
        title="No more meetings today"
      >
        <CalendarCheck className="h-[1.05em] w-[1.05em] shrink-0" />
        <span>All meetings for the day complete</span>
      </span>
    );
  }

  if (!meeting || startMs === null || secsUntil === null) return null;
  // Clear a couple minutes after start — the next poll surfaces what's next.
  if (secsUntil < -120) return null;

  const far = secsUntil > 600;
  const clock = new Date(startMs).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  const mm = Math.max(0, Math.floor(secsUntil / 60));
  const ss = Math.max(0, secsUntil % 60);
  const countdown = `${mm}:${ss.toString().padStart(2, "0")}`;

  // Escalation ladder — a pill whose tone intensifies as the meeting nears.
  // The red tiers add a glow pulse (footprint stays fixed; see keyframes).
  let tone = "border-white/10 bg-white/[0.06] text-foreground/80"; // ≤10m
  let sizeClass = "text-[0.8em]";
  let animClass = "";
  if (far) {
    tone = "border-white/10 bg-white/[0.035] text-foreground";
    sizeClass = "text-[0.78em]";
  } else if (secsUntil <= 60) {
    tone = "border-red-500/70 bg-red-500/15 text-red-200";
    sizeClass = "text-[0.88em] font-semibold";
    animClass = "wallboard-cd-pulse-fast";
  } else if (secsUntil <= 120) {
    tone = "border-red-500/50 bg-red-500/10 text-red-300";
    sizeClass = "text-[0.84em] font-semibold";
    animClass = "wallboard-cd-pulse";
  } else if (secsUntil <= 300) {
    tone = "border-amber-500/40 bg-amber-500/10 text-amber-300";
    sizeClass = "text-[0.82em] font-medium";
  }

  // Red tiers: ring the icon like an alarm bell; final minute: pop each
  // second (the countdown span is re-keyed per tick so the animation replays).
  const urgent = secsUntil <= 120;
  const finalMinute = secsUntil <= 60 && secsUntil > 0;

  return (
    <span
      className={cn(
        // transition-all so tier changes morph (font-size/padding included)
        // instead of snapping at the 5m/2m/1m boundaries.
        "wallboard-cd-in flex items-center gap-[0.4em] whitespace-nowrap rounded-full border px-[0.6em] py-[0.22em] tabular-nums transition-all duration-500",
        tone,
        sizeClass,
        animClass
      )}
      title={meeting.summary}
    >
      <CalendarClock
        className={cn(
          "h-[1.05em] w-[1.05em] shrink-0",
          urgent && "wallboard-cd-bell"
        )}
      />
      <span className="font-sans">{meeting.summary}</span>
      {far ? (
        <span>{clock}</span>
      ) : secsUntil <= 0 ? (
        <span>starting now</span>
      ) : finalMinute ? (
        <span key={secsUntil} className="wallboard-cd-tick">
          in {countdown}
        </span>
      ) : (
        <span>in {countdown}</span>
      )}
    </span>
  );
}

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
    <Panel
      title="Pull Requests"
      className="wallboard-fade-up wb-vt wb-vt-rail-top shrink-0 [animation-delay:200ms]"
      dotColor="#3fb950"
    >
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
  delay,
  className,
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
  /** Entrance-stagger offset (ms); replays whenever the screen mounts. */
  delay?: number;
  className?: string;
}) {
  const showDelta = typeof delta === "number" && Math.abs(delta) >= 1;
  const improving = showDelta && (delta > 0) === !!upIsGood;
  return (
    <div
      className={cn(
        "wallboard-fade-up rounded-xl border bg-muted/20 px-[0.6em] py-[0.45em]",
        className
      )}
      style={{ animationDelay: `${delay ?? 0}ms` }}
    >
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

function formatK(n: number): string {
  if (n >= 10_000) return `${(n / 1000).toFixed(0)}k`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
