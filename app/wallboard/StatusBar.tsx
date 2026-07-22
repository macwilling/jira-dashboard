"use client";

/**
 * Footer connection strip for the wallboard. One pill per upstream data source
 * (Jira / GitHub / Datadog / Google Calendar / Vercel) with a colored dot and a
 * "freshness" age. Its job is to prove the board is *live* even when nothing on
 * it has changed: each pill's dot blinks on every successful poll (the blink is
 * re-triggered by keying the dot on `updatedAt`), and the age counts up every
 * second so a stalled feed — green but "8m" old — is obvious at a glance.
 *
 * Purely presentational: page.tsx owns the SWR hooks and derives each
 * SourceStatus from the same poll state the rest of the board renders from.
 */

export type SourceState = "ok" | "loading" | "error" | "unconfigured";

export interface SourceStatus {
  label: string;
  state: SourceState;
  /** epoch ms of the last successful poll; null until the first one lands. */
  updatedAt: number | null;
}

const DOT: Record<SourceState, string> = {
  ok: "#3fb950", // green — last poll succeeded
  loading: "#d29922", // amber — configured, first poll in flight
  error: "#f85149", // red — last poll errored
  unconfigured: "#6e7681", // gray — not wired up
};

/** Compact freshness age; seconds for the first minute so it visibly ticks. */
function ageLabel(updatedAt: number | null, nowMs: number): string {
  if (updatedAt === null) return "";
  const s = Math.max(0, Math.floor((nowMs - updatedAt) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

export default function StatusBar({
  sources,
  nowMs,
}: {
  sources: SourceStatus[];
  nowMs: number;
}) {
  return (
    <footer className="flex shrink-0 items-center justify-center gap-[1.4em] px-[0.4em] text-[0.6em] text-muted-foreground">
      {sources.map((s) => {
        const color = DOT[s.state];
        // "stale": green but the age has drifted well past its poll cadence —
        // dim it toward amber so it reads as a soft warning, not a hard fault.
        return (
          <span
            key={s.label}
            className="flex items-center gap-[0.5em] whitespace-nowrap tabular-nums"
            title={
              s.state === "unconfigured"
                ? `${s.label}: not configured`
                : s.state === "error"
                  ? `${s.label}: last poll failed`
                  : `${s.label}: connected`
            }
          >
            {/* keyed on updatedAt so a new successful poll retriggers the blink */}
            <span
              key={s.updatedAt ?? "init"}
              className="relative h-[0.7em] w-[0.7em]"
            >
              <span
                className="absolute inset-0 rounded-full"
                style={{ background: color }}
              />
              {s.state === "ok" && (
                <span
                  className="wallboard-status-ping absolute inset-0 rounded-full"
                  style={{ background: color }}
                />
              )}
            </span>
            <span className="font-medium uppercase tracking-wider">
              {s.label}
            </span>
            {s.state === "ok" && s.updatedAt !== null && (
              <span className="text-muted-foreground/60">
                {ageLabel(s.updatedAt, nowMs)}
              </span>
            )}
            {s.state === "error" && (
              <span className="text-[#f85149]/80">error</span>
            )}
            {s.state === "unconfigured" && (
              <span className="text-muted-foreground/50">off</span>
            )}
          </span>
        );
      })}
    </footer>
  );
}
