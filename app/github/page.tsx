"use client";

import { useState, useCallback } from "react";
import useSWR from "swr";
import { RefreshCw, GitMerge } from "lucide-react";
import { AppShell } from "@/components/app-shell/AppShell";
import { HeatmapView } from "@/components/github/HeatmapView";
import { ByContributorView } from "@/components/github/ByContributorView";
import { OverTimeView } from "@/components/github/OverTimeView";
import { PRStats } from "@/lib/github/types";
import { cn } from "@/lib/utils";

type View = "heatmap" | "contributor" | "time";

const VIEWS: { id: View; label: string }[] = [
  { id: "contributor", label: "by contributor" },
  { id: "time", label: "over time" },
  { id: "heatmap", label: "heatmap" },
];

const DAY_OPTIONS = [7, 14, 30, 60, 90] as const;

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `API error ${res.status}`);
  }
  return res.json();
};

export default function GitHubPage() {
  const [view, setView] = useState<View>("heatmap");
  const [days, setDays] = useState<number>(30);
  const [refreshing, setRefreshing] = useState(false);

  const { data, error, isLoading, mutate } = useSWR<PRStats>(
    `/api/github/prs?days=${days}`,
    fetcher,
    { revalidateOnFocus: false, errorRetryCount: 1 }
  );

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
      <RefreshCw className={cn("h-3.5 w-3.5", (refreshing || isLoading) && "animate-spin")} />
      Refresh
    </button>
  );

  return (
    <AppShell title="GitHub" actions={actions}>
      <div className="p-6 space-y-6 max-w-full">

        {/* Stats */}
        {data && (
          <div className="flex gap-3">
            <StatCard label="total PRs" value={data.totalPRs} />
            <StatCard label="contributors" value={data.contributors.length} />
            <StatCard label="active days" value={data.activeDays} />
          </div>
        )}

        {/* Controls */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2.5">
            <span className="text-[11px] text-muted-foreground/50 font-mono shrink-0">View:</span>
            <div className="flex items-center p-[3px] rounded-lg bg-muted/30 border border-border/50 gap-px">
              {VIEWS.map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => setView(id)}
                  className={cn(
                    "h-6 px-3 rounded-md text-xs font-medium transition-all",
                    view === id
                      ? "bg-background text-foreground shadow-sm border border-border/60"
                      : "text-muted-foreground/60 hover:text-muted-foreground"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-px p-[3px] rounded-lg bg-muted/30 border border-border/50">
            {DAY_OPTIONS.map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={cn(
                  "h-6 min-w-[34px] px-2 rounded-md text-[11px] font-mono transition-all",
                  days === d
                    ? "bg-background text-foreground shadow-sm border border-border/60"
                    : "text-muted-foreground/50 hover:text-muted-foreground"
                )}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>

        {/* States */}
        {isLoading && (
          <div className="flex items-center gap-2.5 py-20 justify-center">
            <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground/30" />
            <span className="text-[11px] font-mono text-muted-foreground/30 tracking-wide">
              fetching pull requests
            </span>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-border bg-muted/10 p-4 max-w-md">
            <p className="text-xs font-medium text-foreground/80 mb-1">Failed to load</p>
            <p className="text-[11px] font-mono text-muted-foreground">{error.message}</p>
            {error.message.includes("GITHUB_TOKEN") && (
              <p className="text-[11px] text-muted-foreground/60 mt-2">
                Add{" "}
                <code className="font-mono bg-muted/50 px-1 py-0.5 rounded text-[10px]">
                  GITHUB_TOKEN
                </code>{" "}
                to your{" "}
                <code className="font-mono bg-muted/50 px-1 py-0.5 rounded text-[10px]">
                  .env.local
                </code>
              </p>
            )}
          </div>
        )}

        {!isLoading && !error && data?.totalPRs === 0 && (
          <div className="flex flex-col items-center gap-3 py-24 text-muted-foreground/30">
            <GitMerge className="h-7 w-7" />
            <p className="text-[11px] font-mono">no merged PRs in the last {days} days</p>
          </div>
        )}

        {!isLoading && !error && data && data.totalPRs > 0 && (
          <div>
            {view === "heatmap" && (
              <HeatmapView
                prs={data.prs}
                contributors={data.contributors}
                dateRange={data.dateRange}
              />
            )}
            {view === "contributor" && (
              <ByContributorView prs={data.prs} contributors={data.contributors} />
            )}
            {view === "time" && (
              <OverTimeView prs={data.prs} dateRange={data.dateRange} />
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 px-4 py-3 min-w-[130px]">
      <p className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-widest mb-2">
        {label}
      </p>
      <p className="text-[2rem] font-mono font-semibold leading-none tracking-tight text-foreground">
        {value}
      </p>
    </div>
  );
}
