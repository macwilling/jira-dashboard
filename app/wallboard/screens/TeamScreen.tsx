"use client";

/**
 * Developer-activity screen for the rotating wallboard — a glanceable "what
 * has the team been up to today". Three bands:
 *
 *   1. Day totals — count-up KPI tiles (merged / approved / opened PRs, Jira
 *      status moves and comments).
 *   2. Momentum list — one row per developer: avatar (pulsing ring when they
 *      were active in the last 20 min), a two-tone Jira/GitHub bar scaled to
 *      the day's leader, and per-kind count chips.
 *   3. Rhythm strip — half-hour bins of when the activity happened, stacked
 *      by source, with a breathing "now" marker.
 *
 * Everything animates in staggered on mount, and the screen remounts on every
 * rotation, so the entrance replays each time it comes around. Color carries
 * source only (Jira blue / GitHub green — a validated pair on this surface);
 * icons + labels carry the activity kind.
 */

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import {
  ArrowRightLeft,
  Check,
  Coffee,
  GitMerge,
  GitPullRequest,
  MessageSquareText,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { DevActivity } from "@/lib/wallboard/team-activity";
import { relativeTimeShort } from "../feed";

const JIRA = "#4493f8";
const GITHUB = "#3bb04d";
const ACTIVE_PULSE_MS = 20 * 60 * 1000; // avatar "active now" ring window
const BIN_MS = 30 * 60 * 1000; // rhythm-strip bucket
const MAX_ROWS = 9;

/**
 * Shared with the wallboard page, which polls this key while the sprint
 * screen is up — the rollup is slow (per-ticket Jira changelog fan-out), so
 * pre-warming the SWR cache is what makes this screen appear instantly when
 * the rotation lands on it.
 */
export const TEAM_ACTIVITY_REFRESH_MS = 300_000; // 5 min
export const teamActivityKey = (dayStartISO: string) =>
  `/api/wallboard/team-activity?dayStart=${encodeURIComponent(dayStartISO)}`;

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface ActivityEvent {
  at: number;
  source: "jira" | "github";
}

interface Resp {
  configured: boolean;
  people: DevActivity[];
  events?: ActivityEvent[];
}

type Kind = "merged" | "approved" | "opened" | "transitioned" | "commented";

const KINDS: {
  kind: Kind;
  label: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  color: string;
  of: (d: DevActivity) => number;
}[] = [
  { kind: "merged", label: "PRs merged", icon: GitMerge, color: GITHUB, of: (d) => d.prMerged },
  { kind: "approved", label: "PRs approved", icon: Check, color: GITHUB, of: (d) => d.prApproved },
  { kind: "opened", label: "PRs opened", icon: GitPullRequest, color: GITHUB, of: (d) => d.prOpened },
  { kind: "transitioned", label: "Status moves", icon: ArrowRightLeft, color: JIRA, of: (d) => d.transitioned },
  { kind: "commented", label: "Comments", icon: MessageSquareText, color: JIRA, of: (d) => d.commented },
];

export default function TeamScreen({ dayStartISO }: { dayStartISO: string }) {
  // revalidateIfStale off: the page-level poll owns freshness; mounting on
  // each rotation must read the warm cache, not kick off a new slow fetch.
  const { data } = useSWR<Resp>(teamActivityKey(dayStartISO), fetcher, {
    refreshInterval: TEAM_ACTIVITY_REFRESH_MS,
    revalidateOnFocus: false,
    revalidateIfStale: false,
  });
  const people = useMemo(() => data?.people ?? [], [data]);
  const events = useMemo(() => data?.events ?? [], [data]);

  // Minute-grained clock — drives "Xm ago" and the active-pulse window without
  // re-rendering every second.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const dayStartMs = new Date(dayStartISO).getTime();
  const maxTotal = people[0]?.total ?? 0;
  const shown = people.slice(0, MAX_ROWS);
  const overflow = people.length - shown.length;

  return (
    // The whole section is the morph target (wb-main): the sprint board /
    // My Day panel grows into this one framed box, and the dev rows +
    // rhythm strip stay contained inside it instead of floating free.
    <section className="wb-vt wb-vt-main flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-muted/20 p-[0.9em]">
      <h2 className="mb-[0.7em] flex shrink-0 items-center gap-[0.5em] text-[0.7em] font-semibold uppercase tracking-widest text-muted-foreground">
        Developer Activity — Today
        <span className="ml-auto flex items-center gap-[1em] text-[0.85em] font-medium normal-case tracking-normal text-muted-foreground/80">
          {people.length > 0 && <span>{people.length} active</span>}
          <LegendDot color={JIRA} label="Jira" />
          <LegendDot color={GITHUB} label="GitHub" />
        </span>
      </h2>

      {!data ? (
        <Centered>Loading…</Centered>
      ) : data.configured === false ? (
        <Centered muted>not configured</Centered>
      ) : people.length === 0 ? (
        <QuietDay />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-[0.8em]">
          {/* ---- band 1 · day totals ---- */}
          <div className="grid shrink-0 grid-cols-5 gap-[0.55em]">
            {KINDS.map((k, i) => (
              <KpiTile
                key={k.kind}
                icon={k.icon}
                label={k.label}
                color={k.color}
                value={people.reduce((n, d) => n + k.of(d), 0)}
                delay={i * 70}
                className={`wb-vt wb-vt-kpi-${i}`}
              />
            ))}
          </div>

          {/* ---- band 2 · per-developer momentum ---- */}
          <div className="flex min-h-0 flex-1 flex-col justify-center gap-[0.4em]">
            {shown.map((dev, i) => (
              <DevRow
                key={dev.key}
                dev={dev}
                maxTotal={maxTotal}
                nowMs={nowMs}
                delay={150 + i * 60}
              />
            ))}
            {overflow > 0 && (
              <span className="pl-[3.4em] text-[0.55em] text-muted-foreground/70">
                +{overflow} more active today
              </span>
            )}
          </div>

          {/* ---- band 3 · rhythm of the day ---- */}
          {events.length > 0 && (
            <RhythmStrip events={events} dayStartMs={dayStartMs} nowMs={nowMs} />
          )}
        </div>
      )}

      {/* dangerouslySetInnerHTML: SSR escapes apostrophes/quotes in <style>
          text children, tripping a hydration text-mismatch in dev. */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
        /* From-only keyframes + backwards fill: hidden through the stagger
           delay, animate toward natural style, then release (see the page's
           wallboard-* set for the rationale). */
        .ts-fade-up {
          animation: ts-fade-up 0.6s cubic-bezier(0.22, 1, 0.36, 1) backwards;
        }
        @keyframes ts-fade-up {
          from { opacity: 0; transform: translateY(0.6em); }
        }
        .ts-grow-x {
          transform-origin: left center;
          animation: ts-grow-x 0.9s cubic-bezier(0.22, 1, 0.36, 1) backwards;
        }
        @keyframes ts-grow-x {
          from { transform: scaleX(0); }
        }
        .ts-sweep {
          animation: ts-sweep 1.1s cubic-bezier(0.22, 1, 0.36, 1) backwards;
        }
        @keyframes ts-sweep {
          from { clip-path: inset(0 100% 0 0); }
          to { clip-path: inset(0 0 0 0); }
        }
        .ts-active-ring {
          animation: ts-active-ring 2.4s cubic-bezier(0, 0, 0.2, 1) infinite;
        }
        @keyframes ts-active-ring {
          0% { transform: scale(1); opacity: 0.7; }
          70%, 100% { transform: scale(1.8); opacity: 0; }
        }
        .ts-breathe {
          animation: ts-breathe 2.2s ease-in-out infinite;
        }
        @keyframes ts-breathe {
          0%, 100% { opacity: 0.55; }
          50% { opacity: 1; }
        }
      `,
        }}
      />
    </section>
  );
}

/* ================= band 1 · KPI tiles ================= */

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

function KpiTile({
  icon: Icon,
  label,
  color,
  value,
  delay,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  color: string;
  value: number;
  delay: number;
  className?: string;
}) {
  const shown = useCountUp(value);
  return (
    <div
      className={cn(
        "ts-fade-up flex items-center gap-[0.6em] rounded-xl border bg-white/[0.03] px-[0.75em] py-[0.55em]",
        className
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      <span
        className="flex h-[2em] w-[2em] shrink-0 items-center justify-center rounded-lg"
        style={{ background: `${color}1f`, color }}
      >
        <Icon className="h-[1.15em] w-[1.15em]" />
      </span>
      <div className="min-w-0">
        <div
          className={cn(
            "text-[1.5em] font-bold leading-none tabular-nums",
            value === 0 && "text-muted-foreground/40"
          )}
        >
          {shown}
        </div>
        <div className="mt-[0.35em] truncate text-[0.5em] font-semibold uppercase tracking-widest text-muted-foreground">
          {label}
        </div>
      </div>
    </div>
  );
}

/* ================= band 2 · developer rows ================= */

function DevRow({
  dev,
  maxTotal,
  nowMs,
  delay,
}: {
  dev: DevActivity;
  maxTotal: number;
  nowMs: number;
  delay: number;
}) {
  const jira = dev.commented + dev.transitioned;
  const github = dev.prOpened + dev.prApproved + dev.prMerged;
  const widthPct = maxTotal > 0 ? (dev.total / maxTotal) * 100 : 0;
  const activeNow = dev.lastAt !== null && nowMs - dev.lastAt < ACTIVE_PULSE_MS;

  return (
    <div
      className="ts-fade-up grid shrink-0 items-center gap-x-[0.8em] rounded-lg bg-white/[0.025] px-[0.7em] py-[0.42em]"
      style={{
        gridTemplateColumns: "2.2em 10.5em minmax(0,1fr) 13em 2.8em",
        animationDelay: `${delay}ms`,
      }}
    >
      {/* avatar, ringed while recently active */}
      <span className="relative inline-flex h-[2em] w-[2em]">
        {activeNow && (
          <span
            className="ts-active-ring absolute inset-0 rounded-full"
            style={{ boxShadow: `0 0 0 2px ${github >= jira ? GITHUB : JIRA}` }}
          />
        )}
        <Avatar className="h-[2em] w-[2em]">
          <AvatarImage src={dev.avatarUrl ?? undefined} alt={dev.name} />
          <AvatarFallback className="text-[0.65em]">
            {dev.name.slice(0, 2)}
          </AvatarFallback>
        </Avatar>
      </span>

      {/* name + recency */}
      <div className="min-w-0 leading-tight">
        <div className="truncate text-[0.8em] font-semibold">{dev.name}</div>
        {dev.lastAt !== null && (
          <div
            className={cn(
              "text-[0.52em]",
              activeNow ? "font-semibold text-green-400/90" : "text-muted-foreground/70"
            )}
          >
            {activeNow
              ? "active now"
              : `last active ${relativeTimeShort(dev.lastAt, nowMs)} ago`}
          </div>
        )}
      </div>

      {/* two-tone momentum bar, scaled to the day's leader */}
      <div className="h-[0.62em] overflow-hidden rounded-full bg-white/[0.045]">
        <div
          className="ts-grow-x flex h-full gap-[2px]"
          style={{ width: `${widthPct}%`, animationDelay: `${delay + 120}ms` }}
        >
          {jira > 0 && (
            <span
              className="h-full rounded-[3px]"
              style={{ flexGrow: jira, background: JIRA }}
            />
          )}
          {github > 0 && (
            <span
              className="h-full rounded-[3px]"
              style={{ flexGrow: github, background: GITHUB }}
            />
          )}
        </div>
      </div>

      {/* per-kind counts (icons carry the kind; color carries the source) */}
      <div className="flex items-center justify-end gap-[0.7em]">
        {KINDS.map((k) => {
          const n = k.of(dev);
          if (n === 0) return null;
          return (
            <span
              key={k.kind}
              className="flex items-center gap-[0.22em] text-[0.62em] tabular-nums text-foreground/80"
              title={`${n} ${k.label.toLowerCase()}`}
            >
              <k.icon className="h-[0.95em] w-[0.95em]" style={{ color: k.color }} />
              {n}
            </span>
          );
        })}
      </div>

      <span className="text-right text-[0.95em] font-bold tabular-nums">
        {dev.total}
      </span>
    </div>
  );
}

/* ================= band 3 · rhythm strip ================= */

interface Bin {
  start: number;
  jira: number;
  github: number;
}

/**
 * Half-hour buckets from the earlier of (first event, 8am) through now.
 * Trailing empty bins up to "now" stay — a quiet afternoon should look quiet.
 */
function buildBins(
  events: ActivityEvent[],
  dayStartMs: number,
  nowMs: number
): Bin[] {
  const eightAm = dayStartMs + 8 * 60 * 60 * 1000;
  const firstAt = events.length > 0 ? events[0].at : nowMs;
  const start = Math.floor(Math.min(firstAt, eightAm, nowMs) / BIN_MS) * BIN_MS;
  const count = Math.min(48, Math.max(1, Math.ceil((nowMs - start) / BIN_MS)));
  const bins: Bin[] = Array.from({ length: count }, (_, i) => ({
    start: start + i * BIN_MS,
    jira: 0,
    github: 0,
  }));
  for (const e of events) {
    const idx = Math.floor((e.at - start) / BIN_MS);
    if (idx < 0 || idx >= count) continue;
    bins[idx][e.source]++;
  }
  return bins;
}

function fmtHour(ms: number): string {
  return new Date(ms)
    .toLocaleTimeString([], { hour: "numeric" })
    .toLowerCase()
    .replace(/\s/g, "");
}

/** Chart-internal coordinate space; the SVG stretches to fill its box. */
const CHART_W = 1000;
const CHART_H = 100;

/**
 * Catmull-Rom-smoothed cubic path through the points (GitHub
 * code-frequency-style curve). Control-point ys are clamped so overshoot on
 * spiky data never dips below the baseline or above the top.
 */
function smoothLine(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return "";
  const cy = (v: number) => Math.min(CHART_H, Math.max(2, v)).toFixed(1);
  let d = `M ${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    d +=
      ` C ${(p1.x + (p2.x - p0.x) / 6).toFixed(1)},${cy(p1.y + (p2.y - p0.y) / 6)}` +
      ` ${(p2.x - (p3.x - p1.x) / 6).toFixed(1)},${cy(p2.y - (p3.y - p1.y) / 6)}` +
      ` ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

function RhythmStrip({
  events,
  dayStartMs,
  nowMs,
}: {
  events: ActivityEvent[];
  dayStartMs: number;
  nowMs: number;
}) {
  const bins = useMemo(
    () => buildBins(events, dayStartMs, nowMs),
    [events, dayStartMs, nowMs]
  );
  const hourMs = 60 * 60 * 1000;

  // Layered (not stacked) area curves, one per source, sharing one y-scale.
  const max = Math.max(1, ...bins.map((b) => Math.max(b.jira, b.github)));
  const x = (i: number) => (i / (bins.length - 1)) * CHART_W;
  const y = (v: number) => CHART_H - 3 - (v / max) * (CHART_H - 12);
  const series = [
    { color: JIRA, pts: bins.map((b, i) => ({ x: x(i), y: y(b.jira) })) },
    { color: GITHUB, pts: bins.map((b, i) => ({ x: x(i), y: y(b.github) })) },
  ];

  if (bins.length < 2) return null;

  return (
    <div className="ts-fade-up shrink-0" style={{ animationDelay: "500ms" }}>
      <div className="mb-[0.35em] text-[0.5em] font-semibold uppercase tracking-widest text-muted-foreground/70">
        When it happened
      </div>
      <div className="relative h-[4.4em] pb-[1em]">
        {/* sweep reveal: the day draws in left-to-right */}
        <div
          className="ts-sweep h-full w-full border-b border-white/[0.06]"
          style={{ animationDelay: "650ms" }}
        >
          <svg
            viewBox={`0 0 ${CHART_W} ${CHART_H}`}
            className="h-full w-full"
            preserveAspectRatio="none"
          >
            {series.map((s) => (
              <path
                key={`${s.color}-fill`}
                d={`${smoothLine(s.pts)} L ${CHART_W},${CHART_H} L 0,${CHART_H} Z`}
                fill={s.color}
                opacity="0.16"
              />
            ))}
            {series.map((s) => (
              <path
                key={`${s.color}-line`}
                d={smoothLine(s.pts)}
                fill="none"
                stroke={s.color}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
        </div>

        {/* breathing "now" dots ride each curve's right end, outside the
            stretched SVG so they stay round. Container is 4.4em with a 1em
            label gutter, so chart-space % scales by 3.4/4.4. */}
        {series.map((s) => (
          <span
            key={`${s.color}-dot`}
            className="ts-fade-up absolute right-0 z-10"
            style={{
              top: `${((s.pts[s.pts.length - 1].y / CHART_H) * 100 * (3.4 / 4.4)).toFixed(1)}%`,
              animationDelay: "1500ms",
            }}
          >
            <span
              className="ts-breathe block h-[0.38em] w-[0.38em] -translate-y-1/2 translate-x-1/2 rounded-full ring-2 ring-background"
              style={{ background: s.color, boxShadow: `0 0 8px ${s.color}88` }}
            />
          </span>
        ))}

        {/* hour ticks under the baseline, every even hour */}
        {bins.map((b, i) => {
          const onEvenHour =
            b.start % hourMs === 0 && new Date(b.start).getHours() % 2 === 0;
          if (!onEvenHour) return null;
          return (
            <span
              key={b.start}
              className="absolute bottom-0 -translate-x-1/2 whitespace-nowrap text-[0.45em] tabular-nums text-muted-foreground/60"
              style={{ left: `${((i / (bins.length - 1)) * 100).toFixed(2)}%` }}
            >
              {fmtHour(b.start)}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/* ================= misc ================= */

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-[0.3em]">
      <span
        className="h-[0.55em] w-[0.55em] rounded-[2px]"
        style={{ background: color }}
      />
      {label}
    </span>
  );
}

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
        "flex flex-1 items-center justify-center text-[0.7em]",
        muted ? "text-muted-foreground/60" : "text-muted-foreground"
      )}
    >
      {children}
    </div>
  );
}

function QuietDay() {
  return (
    <div className="ts-fade-up flex flex-1 flex-col items-center justify-center gap-[0.6em] text-muted-foreground">
      <Coffee className="h-[2.6em] w-[2.6em] opacity-50" />
      <span className="text-[0.8em] font-medium">All quiet so far</span>
      <span className="text-[0.55em] text-muted-foreground/70">
        No developer activity recorded yet today
      </span>
    </div>
  );
}
