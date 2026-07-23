"use client";

/**
 * "My Day" screen for the rotating wallboard — the facilitator's own day.
 *
 * Mirrors the sprint screen's architecture (main panel + rail of Panels):
 *
 *   Main panel — "Day timeline" strip (the workday as one groove: meeting
 *   capsules flush inside it, double-bookings split into two lanes, elapsed
 *   time shaded, upcoming free gaps labeled, breathing red cursor at now,
 *   legend on the eyebrow) above a spined agenda: finished meetings dim out
 *   behind pop-in green checks, an in-progress one glows with a live elapsed
 *   bar, upcoming ones count down, and a sheened banner lands when the day
 *   is clear.
 *
 *   Rail — icon-chip day stats (time in meetings / when you're clear / tasks
 *   due), a next-workday pre-read panel (weekends and empty weekdays skipped;
 *   see pickPreviewDay), and a Google Tasks due-today panel.
 *
 * Everything animates in staggered on mount, and the screen remounts on
 * every rotation, so the choreography replays each time it comes around.
 */

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import {
  CalendarCheck,
  CalendarDays,
  Check,
  CircleDashed,
  Clock,
  ListTodo,
  MapPin,
  Sunrise,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DayEvent,
  DueTask,
  localDateStr,
  pickPreviewDay,
} from "../myday";

export type { DayEvent };

const ACCENT = "#4493f8";
const DONE_GREEN = "#3fb950";
const NOW_RED = "#f87171";
const AMBER = "#e3b341";
const PREVIEW_MAX_ROWS = 5;
const TASKS_MAX_ROWS = 8;

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

interface AgendaEvent extends DayEvent {
  status: EvStatus;
  startMs: number;
  endMs: number;
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
      return { ...e, status, startMs, endMs };
    };
    return {
      timed: events.filter((e) => !e.allDay).map(enrich),
      allDay: events.filter((e) => e.allDay),
    };
  }, [data, nowMs]);

  const doneCount = timed.filter((e) => e.status === "past").length;
  const allDone = timed.length > 0 && doneCount === timed.length;
  const inProgress = timed.some((e) => e.status === "now");
  const nextIdx = timed.findIndex((e) => e.status === "future");
  // The red "now" rule sits before the first future event — but only between
  // meetings; an in-progress event's own badge already marks the moment.
  const nowMarkerIdx = inProgress ? -1 : nextIdx === -1 ? timed.length : nextIdx;

  // Day stats for the rail tiles.
  const meetingMs = timed.reduce((n, e) => n + (e.endMs - e.startMs), 0);
  const lastEndMs = timed.reduce((n, e) => Math.max(n, e.endMs), 0);
  const clearNow = timed.length === 0 || lastEndMs <= nowMs;
  const clearFrom = clearNow ? "Now" : fmtTime(new Date(lastEndMs).toISOString());

  // ---- tasks due today / overdue ----
  const { data: tasksData } = useSWR<TasksResp>(tasksKey(dateStr), fetcher, {
    refreshInterval: TASKS_REFRESH_MS,
    revalidateOnFocus: false,
  });
  const tasks = tasksData?.tasks ?? [];
  const overdueCount = tasks.filter((t) => t.due < dateStr).length;

  // ---- next-workday pre-read (only fetched once today's calendar is clear,
  // so the extra poll doesn't run all day; empty weekdays count as clear) ----
  const dayClear = !!data && data.connected !== false && (allDone || timed.length === 0);
  const tomorrowISO = useMemo(() => {
    const d = new Date(dayStartISO);
    d.setDate(d.getDate() + 1); // setDate keeps local midnight across DST
    return d.toISOString();
  }, [dayStartISO]);
  const { data: weekData } = useSWR<Resp>(
    dayClear ? myWeekKey(tomorrowISO) : null,
    fetcher,
    { refreshInterval: 300_000, revalidateOnFocus: false }
  );
  const preview = useMemo(
    () =>
      weekData?.events
        ? pickPreviewDay(weekData.events, new Date(tomorrowISO))
        : null,
    [weekData, tomorrowISO]
  );

  const dateLabel = new Date(nowMs).toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="flex min-h-0 flex-1 gap-[0.7em]">
      {/* ---- main panel: timeline + agenda ---- */}
      <Panel
        className="wallboard-fade-up wb-vt wb-vt-main flex-[2.4] [animation-delay:80ms]"
        title={
          <>
            My Day — {dateLabel}
            {allDay.map((e) => (
              <span
                key={e.id}
                className="flex items-center gap-[0.35em] rounded-full border border-white/10 bg-white/[0.05] px-[0.65em] py-[0.12em] font-medium normal-case tracking-normal text-foreground/75"
              >
                <CalendarDays className="h-[1em] w-[1em] shrink-0 text-muted-foreground" />
                {e.summary}
              </span>
            ))}
          </>
        }
        titleRight={
          timed.length > 0 ? (
            <span className="ml-auto flex items-center gap-[0.45em] font-medium normal-case tracking-normal">
              <DoneRing done={doneCount} total={timed.length} />
              <span className={allDone ? "text-green-400" : "text-muted-foreground/80"}>
                {doneCount} of {timed.length} done
              </span>
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
              No meetings today — clear runway
            </span>
          </div>
        ) : (
          <>
            <FlightPath events={timed} dayStartMs={dayStartMs} nowMs={nowMs} />

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
              {allDone && (
                <div className="md-fade-up md-sheen mt-[0.3em] flex shrink-0 items-center justify-center gap-[0.5em] rounded-lg border border-green-500/40 bg-green-500/10 px-[0.9em] py-[0.6em] text-[0.8em] font-semibold text-green-300 [animation-delay:450ms]">
                  <CalendarCheck className="h-[1.1em] w-[1.1em] shrink-0" />
                  All meetings for the day complete
                </div>
              )}
            </div>
          </>
        )}
      </Panel>

      {/* ---- rail: stats · tomorrow · tasks ---- */}
      <div className="flex min-w-0 flex-1 flex-col gap-[0.7em]">
        <div className="grid shrink-0 grid-cols-3 gap-[0.55em]">
          <RailTile
            icon={Clock}
            color={ACCENT}
            label="In meetings"
            value={meetingMs > 0 ? fmtSpan(meetingMs) : "—"}
            countMinutes={Math.round(meetingMs / 60_000)}
            delay={160}
            className="wb-vt wb-vt-kpi-0"
          />
          <RailTile
            icon={CalendarCheck}
            color={DONE_GREEN}
            label="Clear from"
            value={clearFrom}
            valueClass={clearNow ? "text-green-400" : undefined}
            delay={230}
            className="wb-vt wb-vt-kpi-1"
          />
          <RailTile
            icon={ListTodo}
            color={overdueCount > 0 ? AMBER : ACCENT}
            label="Tasks due"
            value={tasksData ? String(tasks.length) : "—"}
            countTo={tasksData ? tasks.length : undefined}
            valueClass={overdueCount > 0 ? "text-amber-400" : undefined}
            delay={300}
            className="wb-vt wb-vt-kpi-2"
          />
        </div>

        {dayClear && preview && (
          <TomorrowPanel preview={preview} tomorrowMs={new Date(tomorrowISO).getTime()} />
        )}

        <TasksPanel
          tasksData={tasksData}
          dateStr={dateStr}
          overdueCount={overdueCount}
        />
      </div>

      {/* dangerouslySetInnerHTML: SSR escapes apostrophes/quotes in <style>
          text children, tripping a hydration text-mismatch in dev. */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
        /* From-only keyframes + backwards fill, same curves as the page's
           wallboard-* and Team screen's ts-* sets. */
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
        /* Overshoot pop for checkmarks + timeline capsules. */
        .md-pop {
          animation: md-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) backwards;
        }
        @keyframes md-pop {
          from { opacity: 0; transform: scale(0.2); }
        }
        /* Expanding ring on the in-progress node. */
        .md-ring {
          animation: md-ring 2.4s cubic-bezier(0, 0, 0.2, 1) infinite;
        }
        @keyframes md-ring {
          0% { transform: scale(1); opacity: 0.7; }
          70%, 100% { transform: scale(2); opacity: 0; }
        }
        .md-breathe {
          animation: md-breathe 2.2s ease-in-out infinite;
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
        /* Glow pulse on the in-progress timeline capsule. */
        .md-live {
          animation: md-live 1.8s ease-in-out infinite;
        }
        @keyframes md-live {
          0%, 100% { box-shadow: 0 0 0 1px rgba(68,147,248,0.45), 0 0 8px rgba(68,147,248,0.35); }
          50% { box-shadow: 0 0 0 2px rgba(68,147,248,0.85), 0 0 18px rgba(68,147,248,0.7); }
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
        className
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

/* ================= day timeline ================= */

/** Legend square, same shape language as the Team screen's LegendDot. */
function LegendDot({
  color,
  outline,
  label,
}: {
  color?: string;
  outline?: boolean;
  label: string;
}) {
  return (
    <span className="flex items-center gap-[0.3em]">
      <span
        className="h-[0.55em] w-[0.55em] rounded-[2px]"
        style={
          outline
            ? { boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.45)" }
            : { background: color }
        }
      />
      {label}
    </span>
  );
}

/**
 * The workday as one horizontal groove: from min(first meeting, 9am) to
 * max(last meeting, 5pm), snapped to whole hours. Meeting capsules sit flush
 * inside the groove (double-bookings split into two thin lanes), elapsed
 * time is shaded, upcoming free gaps big enough to matter get an explicit
 * "1h 20m free" label, and a breathing red cursor rides at "now" above an
 * hour ruler. The eyebrow carries a legend so the encoding reads at a glance.
 *
 * Positioned children keep the parent font size (em offsets on a
 * text-[0.5em] element shrink with it); tiny type lives on inner spans only.
 */
function FlightPath({
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

  // Two-lane layout for double-bookings: an event that starts while the
  // previous one is still running drops to a thin second lane.
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
    if (widthPct < 8) continue;
    gaps.push({ leftPct, widthPct, label: `${fmtSpan(to - from)} free` });
  }

  const nowPct = pct(nowMs);
  const nowOnPath = nowMs >= start && nowMs <= end;

  return (
    <div className="mb-[0.55em] shrink-0">
      {/* eyebrow + legend, mirroring the Team screen's rhythm strip */}
      <div className="mb-[0.4em] flex items-center text-[0.5em] font-semibold uppercase tracking-widest text-muted-foreground/70">
        Day timeline
        <span className="ml-auto flex items-center gap-[1em] font-medium normal-case tracking-normal text-muted-foreground/80">
          <LegendDot color={DONE_GREEN} label="Done" />
          <LegendDot color={ACCENT} label="In progress" />
          <LegendDot outline label="Ahead" />
          <span className="text-muted-foreground/60">empty = free time</span>
        </span>
      </div>

      <div className="relative mx-[0.5em] h-[2.75em]">
        {/* groove — the day itself; empty stretches are free time */}
        <div
          className="md-grow-x absolute left-0 right-0 top-[0.5em] h-[1em] overflow-hidden rounded-full bg-white/[0.045] shadow-[inset_0_1px_3px_rgba(0,0,0,0.45)]"
          style={{ animationDelay: "100ms" }}
        >
          {/* elapsed shading — time already flown */}
          <div
            className="absolute inset-y-0 left-0 bg-white/[0.04]"
            style={{ width: `${nowPct.toFixed(2)}%` }}
          />
        </div>
        {/* free-gap labels, centered in their stretch of groove */}
        {gaps.map((g) => (
          <div
            key={g.leftPct}
            className="md-fade-up absolute top-[0.5em] flex h-[1em] items-center justify-center overflow-hidden"
            style={{
              left: `${g.leftPct.toFixed(2)}%`,
              width: `${g.widthPct.toFixed(2)}%`,
              animationDelay: "950ms",
            }}
          >
            <span className="whitespace-nowrap text-[0.52em] font-medium tracking-wide text-muted-foreground/75">
              {g.label}
            </span>
          </div>
        ))}
        {/* meeting capsules, flush inside the groove */}
        {events.map((e, i) => {
          const left = pct(e.startMs);
          const width = Math.max(0.7, pct(e.endMs) - left);
          const lane = lanes[i];
          return (
            <span
              key={e.id}
              title={`${e.summary} · ${fmtTime(e.startISO)}`}
              className={cn(
                "md-pop absolute rounded-full",
                e.status === "now" && "md-live"
              )}
              style={{
                left: `${left.toFixed(2)}%`,
                width: `${width.toFixed(2)}%`,
                top: !twoLanes ? "0.5em" : lane === 0 ? "0.52em" : "1.04em",
                height: !twoLanes ? "1em" : "0.44em",
                animationDelay: `${320 + i * 55}ms`,
                ...(e.status === "past"
                  ? { background: DONE_GREEN, opacity: 0.8 }
                  : e.status === "now"
                    ? { background: ACCENT }
                    : {
                        background: "rgba(255,255,255,0.1)",
                        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.4)",
                      }),
              }}
            />
          );
        })}
        {/* hour ruler under the groove */}
        {hours.map((t, i) => (
          <div
            key={t}
            className="md-fade-up absolute -translate-x-1/2"
            style={{
              left: `${pct(t).toFixed(2)}%`,
              top: "1.62em",
              animationDelay: `${250 + i * 25}ms`,
            }}
          >
            <span className="mx-auto block h-[0.24em] w-px bg-white/15" />
            <span className="block text-center text-[0.5em] tabular-nums leading-[1.6] text-muted-foreground/60">
              {fmtHour(t)}
            </span>
          </div>
        ))}
        {/* now cursor */}
        {nowOnPath && (
          <span
            className="md-fade-up absolute top-[0.12em] z-10 h-[1.75em] w-[2px] -translate-x-1/2 rounded"
            style={{
              left: `${nowPct.toFixed(2)}%`,
              background: NOW_RED,
              boxShadow: `0 0 6px ${NOW_RED}66`,
              animationDelay: "850ms",
            }}
          >
            <span
              className="md-breathe absolute left-1/2 top-0 h-[0.42em] w-[0.42em] -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{ background: NOW_RED, boxShadow: `0 0 8px ${NOW_RED}` }}
            />
          </span>
        )}
      </div>
    </div>
  );
}

/* ================= agenda ================= */

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
  const elapsedPct =
    st === "now"
      ? Math.min(100, ((nowMs - e.startMs) / (e.endMs - e.startMs)) * 100)
      : 0;

  return (
    <div
      className="md-fade-up grid shrink-0 grid-cols-[1.9em_minmax(0,1fr)] items-center"
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* spine node */}
      <div className="relative z-10 flex items-center justify-center">
        {st === "past" ? (
          <span
            className="md-pop flex h-[1.1em] w-[1.1em] items-center justify-center rounded-full ring-4 ring-background"
            style={{
              background: "rgba(63,185,80,0.18)",
              boxShadow: `inset 0 0 0 1.5px ${DONE_GREEN}`,
              animationDelay: `${delay + 220}ms`,
            }}
          >
            <Check className="h-[0.7em] w-[0.7em]" style={{ color: DONE_GREEN }} />
          </span>
        ) : st === "now" ? (
          <span className="relative flex h-[1.1em] w-[1.1em] items-center justify-center">
            <span
              className="md-ring absolute inset-0 rounded-full"
              style={{ boxShadow: `0 0 0 2px ${ACCENT}` }}
            />
            <span
              className="h-[0.85em] w-[0.85em] rounded-full ring-4 ring-background"
              style={{ background: ACCENT, boxShadow: `0 0 10px ${ACCENT}` }}
            />
          </span>
        ) : (
          <span className="h-[0.6em] w-[0.6em] rounded-full bg-background ring-4 ring-background"
            style={{ boxShadow: `inset 0 0 0 1.5px rgba(255,255,255,0.3)` }}
          />
        )}
      </div>

      {/* card */}
      <div
        className={cn(
          "relative flex items-center gap-[0.8em] overflow-hidden rounded-lg border bg-muted/20 px-[0.85em] py-[0.5em]",
          st === "past" && "opacity-45",
          st === "now" && "wallboard-glow"
        )}
        style={st === "now" ? { borderColor: "rgba(68,147,248,0.5)" } : undefined}
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
          <div
            className={cn(
              "truncate text-[0.82em] font-semibold",
              e.response === "tentative" && "italic text-foreground/75"
            )}
          >
            {e.summary}
            {e.response === "tentative" && (
              <span className="ml-[0.5em] text-[0.75em] font-normal text-muted-foreground">
                maybe
              </span>
            )}
          </div>
          {e.location && (
            <div className="flex items-center gap-[0.3em] truncate text-[0.6em] text-muted-foreground">
              <MapPin className="h-[1em] w-[1em] shrink-0" />
              <span className="truncate">{e.location}</span>
            </div>
          )}
        </div>
        {st === "now" ? (
          <span
            className="shrink-0 rounded-full px-[0.6em] py-[0.15em] text-[0.62em] font-semibold"
            style={{ background: "rgba(68,147,248,0.15)", color: ACCENT }}
          >
            Now · ends in {fmtSpan(e.endMs - nowMs)}
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
                background: ACCENT,
                boxShadow: `0 0 8px ${ACCENT}`,
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
          className="md-breathe h-[0.5em] w-[0.5em] rounded-full ring-4 ring-background"
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

/** Icon-chip stat tile, same anatomy as the Team screen's KpiTile. */
function RailTile({
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
        "md-fade-up flex items-center gap-[0.5em] rounded-xl border bg-white/[0.03] px-[0.55em] py-[0.5em]",
        className
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      <span
        className="flex h-[1.8em] w-[1.8em] shrink-0 items-center justify-center rounded-lg"
        style={{ background: `${color}1f`, color }}
      >
        <Icon className="h-[1em] w-[1em]" />
      </span>
      <div className="min-w-0">
        <div
          className={cn(
            "truncate text-[1.05em] font-bold leading-none tabular-nums",
            valueClass
          )}
        >
          {shown}
        </div>
        <div className="mt-[0.35em] truncate text-[0.46em] font-semibold uppercase tracking-widest text-muted-foreground">
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
          {preview.events.length} meeting{preview.events.length === 1 ? "" : "s"}
        </span>
      }
    >
      <div className="flex flex-col gap-[0.35em]">
        {shown.map((e, i) => (
          <div
            key={e.id}
            className="md-fade-up flex items-center gap-[0.6em] rounded-md bg-white/[0.025] px-[0.6em] py-[0.35em]"
            style={{ animationDelay: `${460 + i * 55}ms` }}
          >
            <span className="w-[4.6em] shrink-0 text-right text-[0.66em] font-semibold tabular-nums text-foreground/85">
              {fmtTime(e.startISO)}
            </span>
            <span
              className={cn(
                "min-w-0 truncate text-[0.66em] text-foreground/75",
                e.response === "tentative" && "italic text-foreground/55"
              )}
            >
              {e.summary}
            </span>
          </div>
        ))}
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
  dateStr,
  overdueCount,
}: {
  tasksData?: TasksResp;
  dateStr: string;
  overdueCount: number;
}) {
  const tasks = tasksData?.tasks ?? [];
  const shown = tasks.slice(0, TASKS_MAX_ROWS);
  const overflow = tasks.length - shown.length;

  /** Whole days a date-only due stamp is behind today. */
  const overdueDays = (due: string) =>
    Math.round(
      (new Date(`${dateStr}T00:00:00`).getTime() -
        new Date(`${due}T00:00:00`).getTime()) /
        (24 * 60 * 60 * 1000)
    );

  return (
    <Panel
      className="wallboard-fade-up wb-vt wb-vt-rail min-h-0 flex-1 [animation-delay:460ms]"
      dotColor={ACCENT}
      title="Tasks due today"
      titleRight={
        overdueCount > 0 ? (
          <span className="ml-auto font-semibold normal-case tracking-normal text-amber-400">
            {overdueCount} overdue
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
          Nothing due — task list clear
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
                    days > 0 ? "text-amber-400/80" : "text-muted-foreground/60"
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
        muted && "text-muted-foreground/60"
      )}
    >
      {children}
    </div>
  );
}
