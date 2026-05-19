"use client";

import { useState, useCallback } from "react";
import useSWR from "swr";
import { RefreshCw, GitPullRequest } from "lucide-react";
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
      <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
      Refresh
    </button>
  );

  return (
    <AppShell title="GitHub" actions={actions}>
      <div className="p-6 max-w-full">
        {/* Stats header */}
        {data && (
          <div className="flex gap-6 mb-6">
            <StatCard label="total PRs" value={data.totalPRs} />
            <StatCard label="contributors" value={data.contributors.length} />
            <StatCard label="active days" value={data.activeDays} />
          </div>
        )}

        {/* Controls */}
        <div className="flex items-center justify-between gap-4 mb-5 flex-wrap">
          {/* View toggle */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground mr-1">View:</span>
            {VIEWS.map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setView(id)}
                className={cn(
                  "h-7 px-3 rounded-full text-xs font-medium border transition-colors",
                  view === id
                    ? "bg-foreground text-background border-foreground"
                    : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Day range selector */}
          <div className="flex items-center gap-1">
            {DAY_OPTIONS.map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={cn(
                  "h-7 px-2.5 rounded-md text-xs font-medium transition-colors",
                  days === d
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                )}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center">
            <RefreshCw className="h-4 w-4 animate-spin" />
            Loading PR data…
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive max-w-lg">
            <p className="font-medium mb-1">Failed to load GitHub data</p>
            <p className="text-xs opacity-80">{error.message}</p>
            {error.message.includes("GITHUB_TOKEN") && (
              <p className="text-xs mt-2 opacity-70">
                Add <code className="font-mono">GITHUB_TOKEN</code> to your{" "}
                <code className="font-mono">.env.local</code> file.
              </p>
            )}
          </div>
        )}

        {!isLoading && !error && data && data.totalPRs === 0 && (
          <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
            <GitPullRequest className="h-8 w-8 opacity-30" />
            <p className="text-sm">No merged PRs found in the last {days} days.</p>
          </div>
        )}

        {!isLoading && !error && data && data.totalPRs > 0 && (
          <>
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
          </>
        )}
      </div>
    </AppShell>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border bg-card px-5 py-4 min-w-[140px]">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="text-3xl font-bold tabular-nums tracking-tight">{value}</p>
    </div>
  );
}
