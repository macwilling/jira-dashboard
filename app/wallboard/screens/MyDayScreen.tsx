"use client";

/**
 * "My Day" screen for the rotating wallboard — the facilitator's own day,
 * read at a glance from across the room.
 *
 * Every timed calendar item is classified into a *kind* (meeting · focus ·
 * out-of-office · task · block) and that kind drives its colour and glyph
 * everywhere, so the shape of the day is legible instantly: a wall of blue
 * meetings, a purple focus block, a green task. Scheduled Google Tasks (which
 * Google files as focusTime events — see ../myday and lib/google/client) are
 * detected via their tasks.google.com link and carry live completion: a done
 * task goes green with a check, one whose time slid by while still open turns
 * amber "left open". Due to-dos that are *not* yet time-blocked live in the
 * rail, so nothing is shown twice.
 *
 * Layout, top to bottom:
 *
 *   Hero timeline — the whole workday as one full-width band. Blocks are tall
 *   enough to carry their own titles, coloured by kind, dimming as they pass;
 *   free gaps are labelled; a red cursor rides at "now" over an hour ruler.
 *
 *   Below, split: the agenda (spined list — past items dim, the live one
 *   carries a steady glow and elapsed bar, the next counts down, tasks show
 *   their state) and a rail of four big KPI tiles (meeting load · focus time ·
 *   free at · tasks), the next-workday pre-read, and unscheduled to-dos due.
 *
 * Animation policy: entrance choreography replays on every rotation (the
 * screen remounts), but only ONE element is allowed to pulse continuously —
 * the now-cursor dot on the hero timeline. Everything else that's "live"
 * holds a steady glow instead, so the board reads calm from across the room.
 */

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import {
  CalendarCheck,
  Check,
  CircleDashed,
  Focus,
  ListTodo,
  Lock,
  MapPin,
  Plane,
  Square,
  SquareCheckBig,
  Sunrise,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DayEvent,
  DueTask,
  EventKind,
  classifyKind,
  decodeTaskSlug,
  localDateStr,
  pickPreviewDay,
  unionMs,
} from "../myday";

export type { DayEvent };

const ACCENT = "#4493f8";
const DONE_GREEN = "#3fb950";
const NOW_RED = "#f87171";
const AMBER = "#e3b341";
const FOCUS_PURPLE = "#a371f7";
const OOO_ORANGE = "#db8f4a";
const SLATE = "#8b949e";
const PREVIEW_MAX_ROWS = 5;
const TASKS_MAX_ROWS = 8;

type IconCmp = React.ComponentType<{ className?: string; style?: React.CSSProperties }>;

/** Per-kind glyph + colour + short label — the screen's visual vocabulary. */
const KIND_META: Record<EventKind, { label: string; color: string; Icon: IconCmp }> = {
  meeting: { label: "Meeting", color: ACCENT, Icon: Users },
  focus: { label: "Focus", color: FOCUS_PURPLE, Icon: Focus },
  ooo: { label: "Out of office", color: OOO_ORANGE, Icon: Plane },
  task: { label: "Task", color: DONE_GREEN, Icon: SquareCheckBig },
  block: { label: "Block", color: SLATE, Icon: Lock },
};

/**
 * Shared with the wallboard page header (MeetingCountdown polls the calendar
 * key for the all-meetings-done pill; the page pre-warms the tasks key), so
 * the rotation lands on warm SWR caches and this screen renders instantly.
 */
export const MY_DAY_REFRESH_MS = 60_000;
export const myDayKey = (dayStartISO: string) =>
  `/api/google/calendar/today?dayStart=${encodeURIComponent(dayStartISO)}`;
/** 7-day window starting tomorrow — feeds the next-workday pre-read. */
const myWeekKey = (tomorrowISO: string) =>
  `/api/google/calendar/today?dayStart=${encodeURIComponent(tomorrowISO)}&days=7`;
export const TASKS_REFRESH_MS = 300_000;
export const tasksKey = (date: string) => `/api/google/tasks/today?date=${date}`;

interface Resp {
  connected: boolean;
  events: DayEvent[];
}

interface TasksResp {
  connected: boolean;
  tasks: DueTask[];
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** "4:45p" — compact for the stat tiles. */
const fmtTimeCompact = (ms: number) =>
  new Date(ms)
    .toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    .replace(/\s?([AP])M/i, (_, m: string) => m.toLowerCase());

const fmtHour = (ms: number) =>
  new Date(ms)
    .toLocaleTimeString([], { hour: "numeric" })
    .toLowerCase()
    .replace(/\s/g, "");

/** "42m" / "1h 10m" — for the countdown badges and the meeting-time tile. */
function fmtSpan(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h}h` : `${h}h ${rest}m`;
}

/** Eases 0 → target over ~0.9s; restarts on remount, i.e. every rotation. */
function useCountUp(target: number, ms = 900): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let raf: number;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      setValue(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return value;
}

type EvStatus = "past" | "now" | "future";
type TaskState = "done" | "open" | "missed";

interface AgendaEvent extends DayEvent {
  kind: EventKind;
  status: EvStatus;
  startMs: number;
  endMs: number;
}

/** done = finished; open = still ahead; missed = time slid by, never ticked. */
function taskState(e: AgendaEvent): TaskState {
  if (e.taskCompleted) return "done";
  return e.status === "past" ? "missed" : "open";
}

/** A meeting/focus/block is "done" once it ends; a task only once completed. */
function isDone(e: AgendaEvent): boolean {
  return e.kind === "task" ? !!e.taskCompleted : e.status === "past";
}

export default function MyDayScreen({
  dayStartISO,
  nowMs,
}: {
  dayStartISO: string;
  nowMs: number;
}) {
  const { data } = useSWR<Resp>(myDayKey(dayStartISO), fetcher, {
    refreshInterval: MY_DAY_REFRESH_MS,
    revalidateOnFocus: false,
  });

  const dayStartMs = new Date(dayStartISO).getTime();
  const dateStr = localDateStr(new Date(dayStartMs));

  const { timed, allDay } = useMemo(() => {
    const events = data?.events ?? [];
    const enrich = (e: DayEvent): AgendaEvent => {
      const startMs = new Date(e.startISO).getTime();
      const endMs = new Date(e.endISO).getTime();
      const status: EvStatus =
        endMs <= nowMs ? "past" : startMs <= nowMs ? "now" : "future";
      return { ...e, kind: classifyKind(e), status, startMs, endMs };
    };
    return {
      timed: events.filter((e) => !e.allDay).map(enrich),
      allDay: events.filter((e) => e.allDay),
    };
  }, [data, nowMs]);

  // Meetings drive the header ring + "all clear" banner; tasks track separately.
  const meetings = timed.filter((e) => e.kind === "meeting");
  const meetingsDone = meetings.filter((e) => e.status === "past").length;
  const allMeetingsDone = meetings.length > 0 && meetingsDone === meetings.length;
  const inProgress = timed.some((e) => e.status === "now");
  const nextIdx = timed.findIndex((e) => e.status === "future");
  // The red "now" rule sits before the first future event — but only between
  // items; an in-progress one's own badge already marks the moment.
  const nowMarkerIdx = inProgress ? -1 : nextIdx === -1 ? timed.length : nextIdx;

  // Scheduled tasks today + their completion.
  const tasksToday = timed.filter((e) => e.kind === "task");
  const tasksDone = tasksToday.filter((e) => e.taskCompleted).length;
  const tasksMissed = tasksToday.filter((e) => taskState(e) === "missed").length;
  const scheduledSlugs = useMemo(
    () => new Set(tasksToday.map((e) => e.taskSlug).filter(Boolean) as string[]),
    [tasksToday],
  );

  // Day stats for the KPI tiles. "Focus time" = the solo time you own: focus
  // blocks, scheduled tasks, and plain holds. Both totals union overlapping
  // items so a task nested in a focus block (or a double-booked meeting) counts
  // as wall-clock time once, not twice.
  const meetingMs = unionMs(meetings);
  const ownMs = unionMs(
    timed.filter((e) => e.kind === "focus" || e.kind === "task" || e.kind === "block"),
  );
  const lastEndMs = timed.reduce((n, e) => Math.max(n, e.endMs), 0);
  const clearNow = timed.length === 0 || lastEndMs <= nowMs;
  const clearFrom = clearNow ? "Now" : fmtTimeCompact(lastEndMs);

  // ---- tasks due today / overdue (rail) ----
  const { data: tasksData } = useSWR<TasksResp>(tasksKey(dateStr), fetcher, {
    refreshInterval: TASKS_REFRESH_MS,
    revalidateOnFocus: false,
  });
  // Drop to-dos already time-blocked on the calendar — those show on the
  // timeline with their own completion, so the rail only carries the floaters.
  const railTasks = useMemo(() => {
    const all = tasksData?.tasks ?? [];
    if (scheduledSlugs.size === 0) return all;
    return all.filter((t) => {
      const slug = decodeTaskSlug(t.id);
      return !slug || !scheduledSlugs.has(slug);
    });
  }, [tasksData, scheduledSlugs]);
  const overdueCount = railTasks.filter((t) => t.due < dateStr).length;

  // ---- next-workday pre-read (only fetched once today's meetings are clear,
  // so the extra poll doesn't run all day; a meeting-free day counts as clear) ----
  const dayClear =
    !!data && data.connected !== false && (allMeetingsDone || meetings.length === 0);
  const tomorrowISO = useMemo(() => {
    const d = new Date(dayStartISO);
    d.setDate(d.getDate() + 1); // setDate keeps local midnight across DST
    return d.toISOString();
  }, [dayStartISO]);
  const { data: weekData } = useSWR<Resp>(
    dayClear ? myWeekKey(tomorrowISO) : null,
    fetcher,
    { refreshInterval: 300_000, revalidateOnFocus: false },
  );
  const preview = useMemo(
    () =>
      weekData?.events
        ? pickPreviewDay(weekData.events, new Date(tomorrowISO))
        : null,
    [weekData, tomorrowISO],
  );

  const dateLabel = new Date(nowMs).toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const connected = !!data && data.connected !== false;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[0.7em]">
      {/* ---- hero: the day as one band ---- */}
      {connected && timed.length > 0 && (
        <HeroTimeline events={timed} dayStartMs={dayStartMs} nowMs={nowMs} />
      )}

      <div className="flex min-h-0 flex-1 gap-[0.7em]">
        {/* ---- agenda ---- */}
        <Panel
          className="wallboard-fade-up wb-vt wb-vt-main flex-[2.4] [animation-delay:80ms]"
          title={
            <>
              My Day — {dateLabel}
              {allDay.map((e) => {
                const meta = KIND_META[classifyKind(e)];
                return (
                  <span
                    key={e.id}
                    className="flex items-center gap-[0.35em] rounded-full border px-[0.65em] py-[0.12em] font-medium normal-case tracking-normal"
                    style={{
                      borderColor: `${meta.color}44`,
                      background: `${meta.color}14`,
                      color: meta.color,
                    }}
                  >
                    <meta.Icon className="h-[1em] w-[1em] shrink-0" />
                    {e.summary}
                  </span>
                );
              })}
            </>
          }
          titleRight={
            meetings.length > 0 ? (
              <span className="ml-auto flex items-center gap-[0.45em] font-medium normal-case tracking-normal">
                <DoneRing done={meetingsDone} total={meetings.length} />
                <span
                  className={
                    allMeetingsDone ? "text-green-400" : "text-muted-foreground/80"
                  }
                >
                  {meetingsDone} of {meetings.length} meetings
                </span>
              </span>
            ) : tasksToday.length > 0 ? (
              <span className="ml-auto flex items-center gap-[0.4em] font-medium normal-case tracking-normal text-muted-foreground/80">
                <ListTodo className="h-[1.1em] w-[1.1em]" style={{ color: DONE_GREEN }} />
                {tasksDone} of {tasksToday.length} tasks done
              </span>
            ) : undefined
          }
        >
          {!data ? (
            <Centered>Loading…</Centered>
          ) : data.connected === false ? (
            <Centered muted>Google Calendar not connected</Centered>
          ) : timed.length === 0 ? (
            <div className="md-fade-up flex flex-1 flex-col items-center justify-center gap-[0.6em] text-green-400">
              <Sunrise className="h-[2.6em] w-[2.6em] opacity-70" />
              <span className="text-[0.85em] font-medium">
                Nothing scheduled today — clear runway
              </span>
            </div>
          ) : (
            <div className="wallboard-noscrollbar flex min-h-0 flex-1 flex-col gap-[0.45em] overflow-y-auto pr-[0.2em]">
              {/* rows wrapper hugs content so the spine ends at the last
                  node instead of running to the panel bottom */}
              <div className="relative flex shrink-0 flex-col gap-[0.45em]">
                <div
                  className="md-draw-y absolute bottom-[1em] left-[0.9em] top-[1em] w-[2px] rounded bg-white/[0.07]"
                  style={{ animationDelay: "250ms" }}
                />
                {timed.map((e, i) => (
                  <div key={e.id} className="contents">
                    {i === nowMarkerIdx && <NowMarker nowMs={nowMs} />}
                    <AgendaRow
                      e={e}
                      nowMs={nowMs}
                      isNext={i === nextIdx}
                      delay={200 + Math.min(i, 10) * 70}
                    />
                  </div>
                ))}
                {nowMarkerIdx === timed.length && <NowMarker nowMs={nowMs} />}
              </div>
              {allMeetingsDone && (
                <div className="md-fade-up md-sheen mt-[0.3em] flex shrink-0 items-center justify-center gap-[0.5em] rounded-lg border border-green-500/40 bg-green-500/10 px-[0.9em] py-[0.6em] text-[0.8em] font-semibold text-green-300 [animation-delay:450ms]">
                  <CalendarCheck className="h-[1.1em] w-[1.1em] shrink-0" />
                  {tasksMissed > 0
                    ? `All meetings done · ${tasksMissed} task${tasksMissed === 1 ? "" : "s"} still open`
                    : "All meetings for the day complete"}
                </div>
              )}
            </div>
          )}
        </Panel>

        {/* ---- rail: KPIs · tomorrow · to-dos ---- */}
        <div className="flex min-w-0 flex-1 flex-col gap-[0.7em]">
          <div className="grid shrink-0 grid-cols-2 gap-[0.55em]">
            <KpiTile
              icon={Users}
              color={ACCENT}
              label="In meetings"
              value={meetingMs > 0 ? fmtSpan(meetingMs) : "—"}
              countMinutes={Math.round(meetingMs / 60_000)}
              delay={160}
              className="wb-vt wb-vt-kpi-0"
            />
            <KpiTile
              icon={Focus}
              color={FOCUS_PURPLE}
              label="Focus time"
              value={ownMs > 0 ? fmtSpan(ownMs) : "—"}
              countMinutes={Math.round(ownMs / 60_000)}
              delay={230}
              className="wb-vt wb-vt-kpi-1"
            />
            <KpiTile
              icon={CalendarCheck}
              color={DONE_GREEN}
              label="Free at"
              value={clearFrom}
              valueClass={clearNow ? "text-green-400" : undefined}
              delay={300}
              className="wb-vt wb-vt-kpi-2"
            />
            {tasksToday.length > 0 ? (
              <KpiTile
                icon={tasksMissed > 0 ? Square : SquareCheckBig}
                color={
                  tasksMissed > 0
                    ? AMBER
                    : tasksDone === tasksToday.length
                      ? DONE_GREEN
                      : ACCENT
                }
                label="Tasks done"
                value={`${tasksDone}/${tasksToday.length}`}
                valueClass={
                  tasksMissed > 0
                    ? "text-amber-400"
                    : tasksDone === tasksToday.length
                      ? "text-green-400"
                      : undefined
                }
                delay={370}
              />
            ) : (
              <KpiTile
                icon={ListTodo}
                color={overdueCount > 0 ? AMBER : ACCENT}
                label="To-dos due"
                value={tasksData ? String(railTasks.length) : "—"}
                countTo={tasksData ? railTasks.length : undefined}
                valueClass={overdueCount > 0 ? "text-amber-400" : undefined}
                delay={370}
              />
            )}
          </div>

          {dayClear && preview && (
            <TomorrowPanel
              preview={preview}
              tomorrowMs={new Date(tomorrowISO).getTime()}
            />
          )}

          <TasksPanel
            tasksData={tasksData}
            tasks={railTasks}
            dateStr={dateStr}
            overdueCount={overdueCount}
            scheduledCount={scheduledSlugs.size}
          />
        </div>
      </div>

      {/* dangerouslySetInnerHTML: SSR escapes apostrophes/quotes in <style>
          text children, tripping a hydration text-mismatch in dev. */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
        /* From-only keyframes + backwards fill, same curves as the page's
           wallboard-* and Team screen's ts-* sets. Continuous animation is
           rationed: md-breathe appears exactly once (hero now-dot). */
        .md-fade-up {
          animation: md-fade-up 0.6s cubic-bezier(0.22, 1, 0.36, 1) backwards;
        }
        @keyframes md-fade-up {
          from { opacity: 0; transform: translateY(0.6em); }
        }
        .md-grow-x {
          transform-origin: left center;
          animation: md-grow-x 0.9s cubic-bezier(0.22, 1, 0.36, 1) backwards;
        }
        @keyframes md-grow-x {
          from { transform: scaleX(0); }
        }
        .md-draw-y {
          transform-origin: center top;
          animation: md-draw-y 0.9s cubic-bezier(0.22, 1, 0.36, 1) backwards;
        }
        @keyframes md-draw-y {
          from { transform: scaleY(0); }
        }
        /* Overshoot pop for checkmarks + timeline blocks. */
        .md-pop {
          animation: md-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) backwards;
        }
        @keyframes md-pop {
          from { opacity: 0; transform: scale(0.2); }
        }
        .md-breathe {
          animation: md-breathe 2.6s ease-in-out infinite;
        }
        @keyframes md-breathe {
          0%, 100% { opacity: 0.55; }
          50% { opacity: 1; }
        }
        /* Celebration sheen sweeping across the all-done banner once. */
        .md-sheen { position: relative; overflow: hidden; }
        .md-sheen::after {
          content: "";
          position: absolute;
          top: 0; bottom: 0; left: -60%;
          width: 55%;
          transform: skewX(-20deg) translateX(-40%);
          background: linear-gradient(90deg, transparent, rgba(134, 239, 172, 0.22), transparent);
          animation: md-sheen 1.4s ease-in-out 1s both;
        }
        @keyframes md-sheen {
          to { transform: skewX(-20deg) translateX(340%); }
        }
      `,
        }}
      />
    </div>
  );
}

/* ================= panel scaffolding (matches page.tsx Panel) ================= */

function Panel({
  title,
  titleRight,
  dotColor,
  className,
  children,
}: {
  title: React.ReactNode;
  titleRight?: React.ReactNode;
  dotColor?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-xl border bg-muted/20 p-[0.7em]",
        className,
      )}
    >
      <h2 className="mb-[0.55em] flex shrink-0 items-center gap-[0.4em] text-[0.62em] font-semibold uppercase tracking-widest text-muted-foreground">
        {dotColor && (
          <span
            className="h-[0.55em] w-[0.55em] shrink-0 rounded-full"
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

/* ================= hero timeline ================= */

/** Legend square, same shape language as the Team screen's LegendDot. */
function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-[0.3em]">
      <span className="h-[0.55em] w-[0.55em] rounded-[2px]" style={{ background: color }} />
      {label}
    </span>
  );
}

/** Fill + text colour for a hero block: hue by kind, brightness by status;
 *  tasks encode their own state (green done, amber missed, outlined open). */
function blockStyle(e: AgendaEvent): {
  css: React.CSSProperties;
  text: string;
} {
  const white = "rgba(255,255,255,0.93)";
  if (e.kind === "task") {
    const s = taskState(e);
    if (s === "done")
      return { css: { background: `${DONE_GREEN}d0` }, text: white };
    if (s === "missed")
      return { css: { background: AMBER }, text: "rgba(20,14,0,0.85)" };
    return {
      css: {
        background: `${DONE_GREEN}14`,
        boxShadow: `inset 0 0 0 1.5px ${DONE_GREEN}`,
      },
      text: DONE_GREEN,
    };
  }
  const color = KIND_META[e.kind].color;
  if (e.status === "past")
    return { css: { background: color, opacity: 0.32 }, text: white };
  if (e.status === "now")
    return {
      css: { background: color, boxShadow: `0 0 14px ${color}88` },
      text: white,
    };
  return { css: { background: `${color}e6` }, text: white };
}

/**
 * The day as one full-width band: from min(first item, 9am) to max(last item,
 * 5pm), snapped to whole hours. Blocks are tall enough to carry their own
 * titles (narrow ones fall back to a bare glyph), coloured by kind, dimming
 * once past; overlaps split into two lanes; upcoming free gaps big enough to
 * matter are labelled; a red cursor rides at "now" over an hour ruler. The
 * eyebrow carries a kind legend so the encoding reads at a glance.
 */
function HeroTimeline({
  events,
  dayStartMs,
  nowMs,
}: {
  events: AgendaEvent[];
  dayStartMs: number;
  nowMs: number;
}) {
  const HOUR = 60 * 60 * 1000;
  const firstStart = Math.min(...events.map((e) => e.startMs));
  const lastEnd = Math.max(...events.map((e) => e.endMs));
  const start =
    Math.floor(Math.min(firstStart, dayStartMs + 9 * HOUR) / HOUR) * HOUR;
  const end = Math.ceil(Math.max(lastEnd, dayStartMs + 17 * HOUR) / HOUR) * HOUR;
  const span = Math.max(HOUR, end - start);
  const pct = (t: number) => Math.min(100, Math.max(0, ((t - start) / span) * 100));

  const hourStep = span > 11 * HOUR ? 2 * HOUR : HOUR;
  const hours: number[] = [];
  for (let t = start; t <= end; t += hourStep) hours.push(t);

  // Two-lane layout for overlaps: an item that starts while the previous one
  // is still running drops to a thin second lane.
  let l0End = -Infinity;
  const lanes = events.map((e) => {
    if (e.startMs >= l0End) {
      l0End = e.endMs;
      return 0;
    }
    return 1;
  });
  const twoLanes = lanes.includes(1);

  // Free time still ahead: merge busy intervals, then label gaps that are
  // ≥45 min and wide enough for the text to fit.
  const busy: { s: number; e: number }[] = [];
  for (const ev of events) {
    const last = busy[busy.length - 1];
    if (last && ev.startMs <= last.e) last.e = Math.max(last.e, ev.endMs);
    else busy.push({ s: ev.startMs, e: ev.endMs });
  }
  const gaps: { leftPct: number; widthPct: number; label: string }[] = [];
  for (let i = 0; i < busy.length - 1; i++) {
    const from = Math.max(busy[i].e, nowMs);
    const to = busy[i + 1].s;
    if (to <= nowMs || to - from < 45 * 60_000) continue;
    const leftPct = pct(from);
    const widthPct = pct(to) - leftPct;
    if (widthPct < 6) continue;
    gaps.push({ leftPct, widthPct, label: `${fmtSpan(to - from)} free` });
  }

  const nowPct = pct(nowMs);
  const nowOnPath = nowMs >= start && nowMs <= end;

  // Only legend the kinds actually present, so the eyebrow stays honest.
  const present = new Set(events.map((e) => e.kind));
  const legend = (Object.keys(KIND_META) as EventKind[])
    .filter((k) => present.has(k))
    .map((k) => ({ color: KIND_META[k].color, label: KIND_META[k].label }));

  return (
    <section className="wallboard-fade-up shrink-0 rounded-xl border bg-muted/20 px-[0.7em] pb-[0.45em] pt-[0.55em]">
      <div className="mb-[0.45em] flex items-center text-[0.55em] font-semibold uppercase tracking-widest text-muted-foreground">
        Day timeline
        <span className="ml-auto flex items-center gap-[1em] font-medium normal-case tracking-normal text-muted-foreground/80">
          {legend.map((l) => (
            <LegendDot key={l.label} color={l.color} label={l.label} />
          ))}
          <span className="text-muted-foreground/60">empty = free</span>
        </span>
      </div>

      <div className="relative mx-[0.3em] h-[4.35em]">
        {/* groove — the day itself; empty stretches are free time */}
        <div
          className="md-grow-x absolute left-0 right-0 top-0 h-[2.7em] overflow-hidden rounded-lg bg-white/[0.04] shadow-[inset_0_1px_3px_rgba(0,0,0,0.4)]"
          style={{ animationDelay: "100ms" }}
        >
          {/* elapsed shading — time already flown */}
          <div
            className="absolute inset-y-0 left-0 bg-white/[0.035]"
            style={{ width: `${nowPct.toFixed(2)}%` }}
          />
        </div>
        {/* free-gap labels, centered in their stretch of groove */}
        {gaps.map((g) => (
          <div
            key={g.leftPct}
            className="md-fade-up absolute top-0 flex h-[2.7em] items-center justify-center overflow-hidden"
            style={{
              left: `${g.leftPct.toFixed(2)}%`,
              width: `${g.widthPct.toFixed(2)}%`,
              animationDelay: "950ms",
            }}
          >
            <span className="whitespace-nowrap text-[0.55em] font-medium tracking-wide text-muted-foreground/70">
              {g.label}
            </span>
          </div>
        ))}
        {/* blocks — labelled when there's room, bare glyph when not */}
        {events.map((e, i) => {
          const left = pct(e.startMs);
          const width = Math.max(0.7, pct(e.endMs) - left);
          const lane = lanes[i];
          const meta = KIND_META[e.kind];
          const { css, text } = blockStyle(e);
          const showLabel = width >= 7 && (!twoLanes || lane === 0 || width >= 10);
          const showIcon = width >= 2.4;
          return (
            <span
              key={e.id}
              title={`${meta.label} · ${e.summary} · ${fmtTime(e.startISO)}–${fmtTime(e.endISO)}`}
              className="md-pop absolute flex items-center overflow-hidden rounded-md px-[0.4em]"
              style={{
                left: `${left.toFixed(2)}%`,
                width: `${width.toFixed(2)}%`,
                top: !twoLanes ? "0.28em" : lane === 0 ? "0.28em" : "1.5em",
                height: !twoLanes ? "2.14em" : "1.06em",
                animationDelay: `${300 + i * 50}ms`,
                ...css,
              }}
            >
              {showIcon && (
                <span
                  className="flex min-w-0 items-center gap-[0.35em]"
                  style={{ color: text }}
                >
                  <meta.Icon className="h-[0.72em] w-[0.72em] shrink-0" />
                  {showLabel && (
                    <span className="truncate text-[0.58em] font-semibold leading-none">
                      {e.summary}
                    </span>
                  )}
                </span>
              )}
            </span>
          );
        })}
        {/* hour ruler under the groove */}
        {hours.map((t, i) => (
          <div
            key={t}
            className="md-fade-up absolute -translate-x-1/2"
            style={{
              left: `${pct(t).toFixed(2)}%`,
              top: "2.95em",
              animationDelay: `${250 + i * 25}ms`,
            }}
          >
            <span className="mx-auto block h-[0.26em] w-px bg-white/15" />
            <span className="block text-center text-[0.52em] tabular-nums leading-[1.6] text-muted-foreground/60">
              {fmtHour(t)}
            </span>
          </div>
        ))}
        {/* now cursor — home of the screen's single continuous pulse */}
        {nowOnPath && (
          <span
            className="md-fade-up absolute top-[-0.28em] z-10 h-[3.3em] w-[2px] -translate-x-1/2 rounded"
            style={{
              left: `${nowPct.toFixed(2)}%`,
              background: NOW_RED,
              boxShadow: `0 0 6px ${NOW_RED}66`,
              animationDelay: "850ms",
            }}
          >
            <span
              className="md-breathe absolute left-1/2 top-0 h-[0.46em] w-[0.46em] -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{ background: NOW_RED, boxShadow: `0 0 8px ${NOW_RED}` }}
            />
          </span>
        )}
      </div>
    </section>
  );
}

/* ================= agenda ================= */

/** Spine node: a kind-coloured disc. Meetings/focus/blocks dim as they pass
 *  and hold a steady glow while live; tasks show their completion (green
 *  check / open box / amber missed) regardless of the clock. */
function SpineNode({ e }: { e: AgendaEvent }) {
  const ring = "ring-4 ring-background";
  const base = "flex h-[1.4em] w-[1.4em] items-center justify-center rounded-full";

  if (e.kind === "task") {
    const s = taskState(e);
    if (s === "done") {
      return (
        <span
          className={cn("md-pop", base, ring)}
          style={{
            background: `${DONE_GREEN}2e`,
            boxShadow: `inset 0 0 0 1.5px ${DONE_GREEN}`,
          }}
        >
          <Check className="h-[0.85em] w-[0.85em]" style={{ color: DONE_GREEN }} />
        </span>
      );
    }
    const c = s === "missed" ? AMBER : ACCENT;
    return (
      <span className={cn(base, ring)} style={{ boxShadow: `inset 0 0 0 1.5px ${c}` }}>
        <Square className="h-[0.8em] w-[0.8em]" style={{ color: c }} />
      </span>
    );
  }

  const { color, Icon } = KIND_META[e.kind];
  if (e.status === "now") {
    return (
      <span
        className={cn(base, ring)}
        style={{ background: color, boxShadow: `0 0 12px ${color}aa` }}
      >
        <Icon className="h-[0.8em] w-[0.8em] text-white" />
      </span>
    );
  }
  const dim = e.status === "past";
  return (
    <span
      className={cn("md-pop", base, ring, dim && "opacity-55")}
      style={{
        background: `${color}26`,
        boxShadow: `inset 0 0 0 1.5px ${color}${dim ? "66" : ""}`,
      }}
    >
      <Icon className="h-[0.8em] w-[0.8em]" style={{ color }} />
    </span>
  );
}

/** Small kind pill next to the title. */
function KindChip({ label, color, Icon }: { label: string; color: string; Icon: IconCmp }) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-[0.3em] rounded-[0.4em] px-[0.45em] py-[0.1em] text-[0.5em] font-semibold uppercase tracking-wider"
      style={{ background: `${color}1f`, color }}
    >
      <Icon className="h-[1.15em] w-[1.15em]" />
      {label}
    </span>
  );
}

function AgendaRow({
  e,
  nowMs,
  isNext,
  delay,
}: {
  e: AgendaEvent;
  nowMs: number;
  isNext: boolean;
  delay: number;
}) {
  const st = e.status;
  const done = isDone(e);
  const elapsedPct =
    st === "now"
      ? Math.min(100, ((nowMs - e.startMs) / (e.endMs - e.startMs)) * 100)
      : 0;

  const meta = KIND_META[e.kind];
  const ts = e.kind === "task" ? taskState(e) : null;
  const chipColor = ts === "missed" ? AMBER : ts === "done" ? DONE_GREEN : meta.color;

  // Sub-line: meeting size and/or location. (No 1:1 guess — group aliases
  // surface as a single attendee, so a count is the honest signal.)
  const subParts: React.ReactNode[] = [];
  if (e.kind === "meeting" && (e.attendeeCount ?? 0) > 1) {
    subParts.push(`${e.attendeeCount} people`);
  }
  if (e.location) {
    subParts.push(
      <span key="loc" className="flex items-center gap-[0.25em]">
        <MapPin className="h-[1em] w-[1em] shrink-0" />
        <span className="truncate">{e.location}</span>
      </span>,
    );
  }

  return (
    <div
      className="md-fade-up grid shrink-0 grid-cols-[1.9em_minmax(0,1fr)] items-center"
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* spine node */}
      <div className="relative z-10 flex items-center justify-center">
        <SpineNode e={e} />
      </div>

      {/* card — the live one holds a steady glow (no pulse) */}
      <div
        className={cn(
          "relative flex items-center gap-[0.8em] overflow-hidden rounded-lg border bg-muted/20 px-[0.85em] py-[0.5em]",
          done && "opacity-45",
        )}
        style={
          st === "now"
            ? {
                borderColor: `${meta.color}80`,
                boxShadow: `0 0 0 1px ${meta.color}55, 0 0 16px ${meta.color}44`,
              }
            : undefined
        }
      >
        <div className="w-[6.2em] shrink-0 text-right leading-tight">
          <div className="text-[0.78em] font-semibold tabular-nums">
            {fmtTime(e.startISO)}
          </div>
          <div className="text-[0.6em] tabular-nums text-muted-foreground">
            {fmtTime(e.endISO)}
          </div>
        </div>
        <div className="min-w-0 flex-1 leading-snug">
          <div className="flex items-center gap-[0.5em]">
            <KindChip label={meta.label} color={chipColor} Icon={meta.Icon} />
            <span
              className={cn(
                "truncate text-[0.82em] font-semibold",
                ts === "done" && "text-muted-foreground line-through",
                e.response === "tentative" && "italic text-foreground/75",
              )}
            >
              {e.summary}
            </span>
            {e.response === "tentative" && (
              <span className="shrink-0 text-[0.6em] font-normal text-muted-foreground">
                maybe
              </span>
            )}
          </div>
          {subParts.length > 0 && (
            <div className="mt-[0.15em] flex items-center gap-[0.55em] truncate text-[0.6em] text-muted-foreground">
              {subParts.map((p, i) => (
                <span key={i} className="flex items-center gap-[0.25em] truncate">
                  {p}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* right-edge status */}
        {st === "now" ? (
          <span
            className="shrink-0 rounded-full px-[0.6em] py-[0.15em] text-[0.62em] font-semibold"
            style={{ background: `${meta.color}26`, color: meta.color }}
          >
            Now · ends in {fmtSpan(e.endMs - nowMs)}
          </span>
        ) : ts === "done" ? (
          <span className="shrink-0 text-[0.62em] font-semibold text-green-400">Done</span>
        ) : ts === "missed" ? (
          <span className="shrink-0 rounded-full bg-amber-400/10 px-[0.55em] py-[0.12em] text-[0.58em] font-semibold text-amber-400">
            Left open
          </span>
        ) : isNext ? (
          <span className="shrink-0 text-[0.62em] font-medium tabular-nums text-muted-foreground">
            in {fmtSpan(e.startMs - nowMs)}
          </span>
        ) : null}

        {/* live elapsed bar along the card's bottom edge */}
        {st === "now" && (
          <>
            <span className="absolute inset-x-0 bottom-0 h-[3px] bg-white/[0.05]" />
            <span
              className="absolute bottom-0 left-0 h-[3px] rounded-r-full transition-[width] duration-1000 ease-linear"
              style={{
                width: `${elapsedPct.toFixed(2)}%`,
                background: meta.color,
                boxShadow: `0 0 8px ${meta.color}`,
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}

/** Classic calendar "current time" rule, red like Google Calendar's. */
function NowMarker({ nowMs }: { nowMs: number }) {
  return (
    <div className="md-fade-up grid shrink-0 grid-cols-[1.9em_minmax(0,1fr)] items-center py-[0.05em]">
      <div className="relative z-10 flex items-center justify-center">
        <span
          className="h-[0.5em] w-[0.5em] rounded-full ring-4 ring-background"
          style={{ background: NOW_RED, boxShadow: `0 0 8px ${NOW_RED}` }}
        />
      </div>
      <div className="flex items-center gap-[0.6em]">
        <span className="md-grow-x h-[2px] flex-1 rounded bg-red-400/60" />
        <span className="text-[0.58em] font-semibold uppercase tracking-wider text-red-400">
          now ·{" "}
          {new Date(nowMs).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          })}
        </span>
      </div>
    </div>
  );
}

/* ================= rail ================= */

/** Header progress ring — sweeps to the done fraction on mount. */
function DoneRing({ done, total }: { done: number; total: number }) {
  const frac = total > 0 ? done / total : 0;
  const [drawn, setDrawn] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setDrawn(frac));
    return () => cancelAnimationFrame(id);
  }, [frac]);
  const R = 8;
  const C = 2 * Math.PI * R;
  const color = frac >= 1 ? DONE_GREEN : ACCENT;
  return (
    <svg viewBox="0 0 20 20" className="h-[1.5em] w-[1.5em] -rotate-90">
      <circle cx="10" cy="10" r={R} fill="none" strokeWidth="3" className="stroke-white/10" />
      <circle
        cx="10"
        cy="10"
        r={R}
        fill="none"
        strokeWidth="3"
        strokeLinecap="round"
        stroke={color}
        strokeDasharray={C}
        strokeDashoffset={C * (1 - drawn)}
        style={{ transition: "stroke-dashoffset 1.1s cubic-bezier(0.22, 1, 0.36, 1)" }}
      />
    </svg>
  );
}

/** Big glanceable stat tile — 2×2 in the rail, roomier than the Team screen's
 *  KpiTile so the numbers carry from across the room. */
function KpiTile({
  icon: Icon,
  color,
  label,
  value,
  countTo,
  countMinutes,
  valueClass,
  delay,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  label: string;
  value: string;
  /** Count-up integer display (overrides `value` while animating). */
  countTo?: number;
  /** Count-up minutes, formatted as h/m (overrides `value` while animating). */
  countMinutes?: number;
  valueClass?: string;
  delay: number;
  className?: string;
}) {
  const counted = useCountUp(countMinutes ?? countTo ?? 0);
  const shown =
    countMinutes !== undefined && countMinutes > 0
      ? fmtSpan(counted * 60_000)
      : countTo !== undefined
        ? String(counted)
        : value;
  return (
    <div
      className={cn(
        "md-fade-up flex items-center gap-[0.6em] rounded-xl border bg-white/[0.03] px-[0.7em] py-[0.65em]",
        className,
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      <span
        className="flex h-[2.1em] w-[2.1em] shrink-0 items-center justify-center rounded-lg"
        style={{ background: `${color}1f`, color }}
      >
        <Icon className="h-[1.15em] w-[1.15em]" />
      </span>
      <div className="min-w-0">
        <div
          className={cn(
            "truncate text-[1.3em] font-bold leading-none tabular-nums",
            valueClass,
          )}
        >
          {shown}
        </div>
        <div className="mt-[0.4em] truncate text-[0.52em] font-semibold uppercase tracking-widest text-muted-foreground">
          {label}
        </div>
      </div>
    </div>
  );
}

/** Next-workday pre-read; "Tomorrow" or the weekday name when Friday. */
function TomorrowPanel({
  preview,
  tomorrowMs,
}: {
  preview: NonNullable<ReturnType<typeof pickPreviewDay>>;
  tomorrowMs: number;
}) {
  const day = new Date(preview.dayStartMs);
  const label =
    preview.dayStartMs === tomorrowMs
      ? "Tomorrow"
      : day.toLocaleDateString([], { weekday: "long" });
  const shown = preview.events.slice(0, PREVIEW_MAX_ROWS);
  const overflow = preview.events.length - shown.length;

  return (
    <Panel
      className="wallboard-fade-up wb-vt wb-vt-rail-top shrink-0 [animation-delay:380ms]"
      dotColor={AMBER}
      title={
        <>
          Up next · {label} —{" "}
          {day.toLocaleDateString([], { month: "long", day: "numeric" })}
        </>
      }
      titleRight={
        <span className="ml-auto font-medium normal-case tracking-normal text-muted-foreground/80">
          {preview.events.length} item{preview.events.length === 1 ? "" : "s"}
        </span>
      }
    >
      <div className="flex flex-col gap-[0.35em]">
        {shown.map((e, i) => {
          const meta = KIND_META[classifyKind(e)];
          return (
            <div
              key={e.id}
              className="md-fade-up flex items-center gap-[0.55em] rounded-md bg-white/[0.025] px-[0.6em] py-[0.35em]"
              style={{ animationDelay: `${460 + i * 55}ms` }}
            >
              <span className="w-[4.6em] shrink-0 text-right text-[0.66em] font-semibold tabular-nums text-foreground/85">
                {fmtTime(e.startISO)}
              </span>
              <meta.Icon
                className="h-[0.72em] w-[0.72em] shrink-0"
                style={{ color: meta.color }}
              />
              <span
                className={cn(
                  "min-w-0 truncate text-[0.66em] text-foreground/75",
                  e.response === "tentative" && "italic text-foreground/55",
                )}
              >
                {e.summary}
              </span>
            </div>
          );
        })}
        {overflow > 0 && (
          <span className="pl-[0.6em] text-[0.55em] text-muted-foreground/70">
            +{overflow} more
          </span>
        )}
      </div>
    </Panel>
  );
}

function TasksPanel({
  tasksData,
  tasks,
  dateStr,
  overdueCount,
  scheduledCount,
}: {
  tasksData?: TasksResp;
  tasks: DueTask[];
  dateStr: string;
  overdueCount: number;
  scheduledCount: number;
}) {
  const shown = tasks.slice(0, TASKS_MAX_ROWS);
  const overflow = tasks.length - shown.length;

  /** Whole days a date-only due stamp is behind today. */
  const overdueDays = (due: string) =>
    Math.round(
      (new Date(`${dateStr}T00:00:00`).getTime() -
        new Date(`${due}T00:00:00`).getTime()) /
        (24 * 60 * 60 * 1000),
    );

  return (
    <Panel
      className="wallboard-fade-up wb-vt wb-vt-rail min-h-0 flex-1 [animation-delay:460ms]"
      dotColor={ACCENT}
      title="To-dos due"
      titleRight={
        overdueCount > 0 ? (
          <span className="ml-auto font-semibold normal-case tracking-normal text-amber-400">
            {overdueCount} overdue
          </span>
        ) : scheduledCount > 0 ? (
          <span className="ml-auto font-medium normal-case tracking-normal text-muted-foreground/70">
            {scheduledCount} on calendar
          </span>
        ) : undefined
      }
    >
      {!tasksData ? (
        <span className="text-[0.6em] text-muted-foreground">Loading…</span>
      ) : tasksData.connected === false ? (
        <span className="text-[0.6em] text-muted-foreground/60">
          Google Tasks not connected
        </span>
      ) : tasks.length === 0 ? (
        <span className="flex items-center gap-[0.4em] text-[0.62em] text-green-400/90">
          <Check className="h-[1em] w-[1em]" />
          {scheduledCount > 0
            ? "All due to-dos are on your calendar"
            : "Nothing due — task list clear"}
        </span>
      ) : (
        <div className="wallboard-noscrollbar flex min-h-0 flex-col gap-[0.35em] overflow-y-auto">
          {shown.map((t, i) => {
            const days = overdueDays(t.due);
            return (
              <div
                key={t.id}
                className="md-fade-up flex items-center gap-[0.55em] rounded-md bg-white/[0.025] px-[0.6em] py-[0.38em]"
                style={{ animationDelay: `${540 + i * 50}ms` }}
              >
                <CircleDashed
                  className={cn(
                    "h-[0.8em] w-[0.8em] shrink-0",
                    days > 0 ? "text-amber-400/80" : "text-muted-foreground/60",
                  )}
                />
                <span className="min-w-0 flex-1 truncate text-[0.66em] text-foreground/85">
                  {t.title}
                </span>
                {days > 0 ? (
                  <span className="shrink-0 rounded-full bg-amber-400/10 px-[0.5em] py-[0.1em] text-[0.52em] font-semibold text-amber-400">
                    {days}d overdue
                  </span>
                ) : (
                  <span className="shrink-0 text-[0.52em] text-muted-foreground/60">
                    {t.listTitle}
                  </span>
                )}
              </div>
            );
          })}
          {overflow > 0 && (
            <span className="pl-[0.6em] text-[0.55em] text-muted-foreground/70">
              +{overflow} more
            </span>
          )}
        </div>
      )}
    </Panel>
  );
}

/* ================= misc ================= */

function Centered({
  children,
  muted,
}: {
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-1 items-center justify-center text-[0.85em]",
        muted && "text-muted-foreground/60",
      )}
    >
      {children}
    </div>
  );
}
