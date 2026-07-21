"use client";

import { useState, useCallback, useMemo } from "react";
import useSWR from "swr";
import { RefreshCw, Bug } from "lucide-react";
import { AppShell } from "@/components/app-shell/AppShell";
import { cn } from "@/lib/utils";

interface BugMetrics {
  range: { start: string; end: string };
  currentOpen: number;
  backlogStart: number;
  backlogEnd: number;
  opened: number;
  closedReal: number;
  closedTotal: number;
  cleanupExcluded: number;
  netChange: number;
  netReductionPct: number;
  expandedCleanupLabels: string[];
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `API error ${res.status}`);
  }
  return res.json();
};

/** Format a Date as local YYYY-MM-DD (avoids the UTC off-by-one of toISOString). */
function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

type PresetId = "30d" | "90d" | "quarter" | "lastQuarter" | "ytd";

function presetRange(id: PresetId): { start: string; end: string } {
  const now = new Date();
  const today = toISO(now);
  const q = Math.floor(now.getMonth() / 3);
  switch (id) {
    case "30d": {
      const s = new Date(now);
      s.setDate(s.getDate() - 30);
      return { start: toISO(s), end: today };
    }
    case "90d": {
      const s = new Date(now);
      s.setDate(s.getDate() - 90);
      return { start: toISO(s), end: today };
    }
    case "quarter":
      return { start: toISO(new Date(now.getFullYear(), q * 3, 1)), end: today };
    case "lastQuarter": {
      const start = new Date(now.getFullYear(), (q - 1) * 3, 1);
      const end = new Date(now.getFullYear(), q * 3, 0); // last day of prev quarter
      return { start: toISO(start), end: toISO(end) };
    }
    case "ytd":
      return { start: toISO(new Date(now.getFullYear(), 0, 1)), end: today };
  }
}

const PRESETS: { id: PresetId; label: string }[] = [
  { id: "30d", label: "30d" },
  { id: "90d", label: "90d" },
  { id: "quarter", label: "This Q" },
  { id: "lastQuarter", label: "Last Q" },
  { id: "ytd", label: "YTD" },
];

export default function BugBacklogPage() {
  const initial = useMemo(() => presetRange("quarter"), []);
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [refreshing, setRefreshing] = useState(false);

  const validRange = start && end && end >= start;

  const { data, error, isLoading, mutate } = useSWR<BugMetrics>(
    validRange ? `/api/jira/bug-metrics?start=${start}&end=${end}` : null,
    fetcher,
    { revalidateOnFocus: false, errorRetryCount: 1 }
  );

  const applyPreset = useCallback((id: PresetId) => {
    const r = presetRange(id);
    setStart(r.start);
    setEnd(r.end);
  }, []);

  const handleRefresh = useCallback(() => {
    if (refreshing) return;
    setRefreshing(true);
    const minSpin = new Promise((r) => setTimeout(r, 600));
    Promise.all([minSpin, mutate()]).finally(() => setRefreshing(false));
  }, [refreshing, mutate]);

  const actions = (
    <button
      onClick={handleRefresh}
      disabled={isLoading || refreshing}
      className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-40"
    >
      <RefreshCw
        className={cn("h-3.5 w-3.5", (refreshing || isLoading) && "animate-spin")}
      />
      Refresh
    </button>
  );

  // Reconciliation: stock change should track flow (backlogEnd ≈ start + opened − closedTotal).
  const recon = data
    ? data.backlogEnd - (data.backlogStart + data.opened - data.closedTotal)
    : 0;

  return (
    <AppShell title="Bug Backlog" actions={actions}>
      <div className="p-6 space-y-6 max-w-full">
        {/* Controls */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2.5">
            <span className="text-[11px] text-muted-foreground/50 font-mono shrink-0">
              Range:
            </span>
            <input
              type="date"
              value={start}
              max={end || undefined}
              onChange={(e) => setStart(e.target.value)}
              className="h-7 px-2 rounded-md bg-muted/30 border border-border/50 text-xs font-mono text-foreground"
            />
            <span className="text-muted-foreground/40 text-xs">→</span>
            <input
              type="date"
              value={end}
              min={start || undefined}
              onChange={(e) => setEnd(e.target.value)}
              className="h-7 px-2 rounded-md bg-muted/30 border border-border/50 text-xs font-mono text-foreground"
            />
          </div>

          <div className="flex items-center gap-px p-[3px] rounded-lg bg-muted/30 border border-border/50">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => applyPreset(p.id)}
                className="h-6 min-w-[42px] px-2 rounded-md text-[11px] font-mono text-muted-foreground/60 hover:text-foreground hover:bg-background/60 transition-all"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {!validRange && (
          <p className="text-[11px] font-mono text-amber-600 dark:text-amber-400">
            End date must be on or after the start date.
          </p>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center gap-2.5 py-20 justify-center">
            <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground/30" />
            <span className="text-[11px] font-mono text-muted-foreground/30 tracking-wide">
              counting bugs across the range
            </span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-lg border border-border bg-muted/10 p-4 max-w-md">
            <p className="text-xs font-medium text-foreground/80 mb-1">
              Failed to load
            </p>
            <p className="text-[11px] font-mono text-muted-foreground">
              {error.message}
            </p>
          </div>
        )}

        {/* Metrics */}
        {!isLoading && !error && data && (
          <div className="space-y-6">
            <div className="flex flex-wrap gap-3">
              <StatCard label="backlog @ start" value={data.backlogStart} />
              <StatCard label="backlog @ end" value={data.backlogEnd} />
              <StatCard label="opened in range" value={data.opened} />
              <StatCard
                label="closed (real fix)"
                value={data.closedReal}
                hint={
                  data.cleanupExcluded > 0
                    ? `+${data.cleanupExcluded} cleanup excluded`
                    : undefined
                }
              />
              <StatCard
                label="net change"
                value={signed(data.netChange)}
                tone={data.netChange < 0 ? "good" : data.netChange > 0 ? "bad" : "neutral"}
              />
              <StatCard
                label="net reduction"
                value={`${data.netReductionPct.toFixed(1)}%`}
                tone={
                  data.netReductionPct > 0
                    ? "good"
                    : data.netReductionPct < 0
                    ? "bad"
                    : "neutral"
                }
              />
            </div>

            {/* Data-quality / reconciliation panel */}
            <div className="rounded-lg border border-border/50 bg-muted/10 p-4 space-y-3 max-w-2xl">
              <p className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-widest">
                Data quality
              </p>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                <Row label="Current open (live)" value={String(data.currentOpen)} />
                <Row
                  label="Closed incl. cleanup"
                  value={String(data.closedTotal)}
                />
                <Row
                  label="Cleanup closes excluded"
                  value={String(data.cleanupExcluded)}
                />
                <Row
                  label="Stock vs flow residual"
                  value={signed(recon)}
                  muted={recon === 0}
                />
              </dl>
              <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
                Metrics come from the immutable status timeline, not the corrupted
                resolved-date. &quot;Closed (real fix)&quot; excludes{" "}
                {data.expandedCleanupLabels.length > 0 ? (
                  <>
                    {data.expandedCleanupLabels.length} cleanup label
                    {data.expandedCleanupLabels.length !== 1 ? "s" : ""}:{" "}
                    <span className="font-mono text-[10px]">
                      {data.expandedCleanupLabels.join(", ")}
                    </span>
                  </>
                ) : (
                  <>no cleanup labels (none matched the configured prefixes)</>
                )}
                . The residual (backlog end − [start + opened − closed]) reflects
                reopens, deletes, and status moves within the open set.
              </p>
            </div>
          </div>
        )}

        {!isLoading && !error && !data && validRange && (
          <div className="flex flex-col items-center gap-3 py-24 text-muted-foreground/30">
            <Bug className="h-7 w-7" />
            <p className="text-[11px] font-mono">no data</p>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

function StatCard({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: number | string;
  hint?: string;
  tone?: "neutral" | "good" | "bad";
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 px-4 py-3 min-w-[140px]">
      <p className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-widest mb-2">
        {label}
      </p>
      <p
        className={cn(
          "text-[2rem] font-mono font-semibold leading-none tracking-tight",
          tone === "good" && "text-green-600 dark:text-green-400",
          tone === "bad" && "text-red-600 dark:text-red-400",
          tone === "neutral" && "text-foreground"
        )}
      >
        {value}
      </p>
      {hint && (
        <p className="text-[10px] font-mono text-muted-foreground/50 mt-1.5">
          {hint}
        </p>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <>
      <dt className="text-muted-foreground/70">{label}</dt>
      <dd
        className={cn(
          "font-mono text-right tabular-nums",
          muted ? "text-muted-foreground/40" : "text-foreground"
        )}
      >
        {value}
      </dd>
    </>
  );
}
