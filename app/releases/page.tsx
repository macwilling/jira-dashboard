"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Loader2,
  Package,
  Archive,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Trash2,
  XCircle,
  Ghost,
} from "lucide-react";
import { AppShell } from "@/components/app-shell/AppShell";
import { cn } from "@/lib/utils";
import type { Release } from "@/lib/releases/types";
import type { SyncSummary } from "@/lib/releases/sync-state";
import { parseReleaseName } from "@/lib/releases/matcher";

interface ReleaseWithMeta extends Release {
  matchedTemplate: { id: string; name: string } | null;
  syncSummary: SyncSummary;
}

type ScopeFilter = "all" | "upcoming" | "released" | "archived" | "deleted";
type TemplateFilter = "all" | "has" | "none";

type SortKey = "date" | "name" | "sync" | "status";
type SortDir = "asc" | "desc";

const SCOPE_LABEL: Record<ScopeFilter, string> = {
  all: "All",
  upcoming: "Upcoming",
  released: "Released",
  archived: "Archived",
  deleted: "Deleted",
};

const TEMPLATE_LABEL: Record<TemplateFilter, string> = {
  all: "All templates",
  has: "Has template",
  none: "No template",
};

/** Reduces any ISO date or timestamp ("2026-04-13", "2026-04-13T00:00:00.0+0000") to YYYY-MM-DD. */
function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

function daysBetween(iso: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${dateOnly(iso)}T00:00:00`);
  if (isNaN(target.getTime())) return 0;
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

/** Format a date as "Apr 13, 2026" (locale short). */
function formatDate(iso: string): string {
  const d = new Date(`${dateOnly(iso)}T00:00:00`);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function relativeDate(iso: string | null, released: boolean): {
  label: string;
  subLabel: string;
  tone: "overdue" | "soon" | "today" | "future" | "released" | "none";
} {
  if (!iso) return { label: "No date", subLabel: "", tone: "none" };
  const label = formatDate(iso);
  const days = daysBetween(iso);
  if (released) return { label, subLabel: "shipped", tone: "released" };
  if (days < 0) return { label, subLabel: `${Math.abs(days)}d overdue`, tone: "overdue" };
  if (days === 0) return { label, subLabel: "today", tone: "today" };
  if (days <= 7) return { label, subLabel: `in ${days}d`, tone: "soon" };
  return { label, subLabel: `in ${days}d`, tone: "future" };
}

/** How urgent a sync row appears, for sorting. Higher = needs more attention. */
function syncUrgency(s: SyncSummary): number {
  return s.missing * 100 + s.failed * 50 + s.drifted * 10 + s.pending;
}

export default function ReleasesPage() {
  const [releases, setReleases] = useState<ReleaseWithMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [purgingId, setPurgingId] = useState<string | null>(null);

  const [scope, setScope] = useState<ScopeFilter>("upcoming");
  const [templateFilter, setTemplateFilter] = useState<TemplateFilter>("all");
  const [platform, setPlatform] = useState<string>("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  useEffect(() => {
    fetch("/api/releases")
      .then((r) => r.json())
      .then((data) => setReleases(data.releases ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const platformOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of releases) {
      const { platform: p } = parseReleaseName(r.name);
      if (p) set.add(p);
    }
    return [...set].sort();
  }, [releases]);

  const filtered = useMemo(() => {
    return releases.filter((r) => {
      // Soft-deleted releases only appear under the Deleted scope.
      if (scope === "deleted") {
        if (!r.deletedAt) return false;
      } else if (r.deletedAt) {
        return false;
      }
      if (scope === "upcoming" && (r.released || r.archived)) return false;
      if (scope === "released" && !r.released) return false;
      if (scope === "released" && r.archived) return false;
      if (scope === "archived" && !r.archived) return false;
      if (templateFilter === "has" && !r.matchedTemplate) return false;
      if (templateFilter === "none" && r.matchedTemplate) return false;
      if (platform) {
        const { platform: p } = parseReleaseName(r.name);
        if (p !== platform) return false;
      }
      return true;
    });
  }, [releases, scope, templateFilter, platform]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "sync":
          cmp = syncUrgency(a.syncSummary) - syncUrgency(b.syncSummary);
          break;
        case "status":
          cmp = Number(a.released) - Number(b.released);
          break;
        case "date":
        default: {
          const da = a.releaseDate ?? "9999-12-31";
          const db = b.releaseDate ?? "9999-12-31";
          cmp = da.localeCompare(db);
          break;
        }
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const counts = useMemo(() => {
    const c = { all: 0, upcoming: 0, released: 0, archived: 0, deleted: 0 };
    for (const r of releases) {
      if (r.deletedAt) {
        c.deleted++;
        continue;
      }
      c.all++;
      if (r.archived) c.archived++;
      else if (r.released) c.released++;
      else c.upcoming++;
    }
    return c;
  }, [releases]);

  const handlePurge = async (release: ReleaseWithMeta) => {
    const msg =
      `Purge "${release.name}"? This deletes the release and its task history from this app, ` +
      `and attempts to delete any Google Tasks / Calendar events the app created for it.`;
    if (!confirm(msg)) return;
    setPurgingId(release.id);
    try {
      const res = await fetch(`/api/releases/${release.id}/purge`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || "Purge failed");
        return;
      }
      setReleases((prev) => prev.filter((r) => r.id !== release.id));
      if (data.errors && data.errors.length > 0) {
        const lines = data.errors
          .map((e: { label: string; error: string }) => `• ${e.label}: ${e.error}`)
          .join("\n");
        alert(
          `Release purged. Some Google cleanup failed — delete these by hand:\n\n${lines}`,
        );
      }
    } finally {
      setPurgingId(null);
    }
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "date" || key === "name" ? "asc" : "desc");
    }
  };

  return (
    <AppShell title="Releases">
      <div className="flex flex-col">
        {/* Filter bar — scope tabs on the left, secondary filters on the right */}
        <div className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur px-4 py-2.5">
          <div className="max-w-7xl mx-auto flex items-center gap-3 flex-wrap">
            {/* Scope — primary pill tabs, no label, counts in muted small type */}
            <div className="inline-flex rounded-lg bg-muted p-0.5 gap-0.5">
              {(Object.keys(SCOPE_LABEL) as ScopeFilter[]).map((s) => {
                const active = scope === s;
                const count = counts[s];
                return (
                  <button
                    key={s}
                    onClick={() => setScope(s)}
                    className={cn(
                      "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs transition-all",
                      active
                        ? "bg-background text-foreground font-medium shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {SCOPE_LABEL[s]}
                    <span
                      className={cn(
                        "text-[10px] tabular-nums",
                        active ? "text-muted-foreground" : "text-muted-foreground/60",
                      )}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Secondary filters — right-aligned, compact, only shown when meaningful */}
            <div className="ml-auto flex items-center gap-2">
              {platformOptions.length > 1 && (
                <select
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value)}
                  className="text-xs h-7 rounded-md border bg-background px-2 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  title="Filter by platform"
                >
                  <option value="">All platforms</option>
                  {platformOptions.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              )}
              <select
                value={templateFilter}
                onChange={(e) => setTemplateFilter(e.target.value as TemplateFilter)}
                className="text-xs h-7 rounded-md border bg-background px-2 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                title="Filter by template match"
              >
                {(Object.keys(TEMPLATE_LABEL) as TemplateFilter[]).map((t) => (
                  <option key={t} value={t}>{TEMPLATE_LABEL[t]}</option>
                ))}
              </select>
              <span className="text-xs text-muted-foreground tabular-nums pl-1">
                {sorted.length === releases.length
                  ? `${releases.length}`
                  : `${sorted.length} of ${releases.length}`}
              </span>
            </div>
          </div>
        </div>

        <main className="px-4 py-4">
          <div className="max-w-7xl mx-auto">
            {loading && (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}

            {error && (
              <p className="text-sm text-destructive py-8 text-center">{error}</p>
            )}

            {!loading && !error && releases.length === 0 && (
              <div className="rounded-lg border border-dashed py-16 text-center text-muted-foreground">
                <Package className="h-8 w-8 mx-auto mb-3 opacity-40" />
                <p className="text-sm">No releases yet.</p>
                <p className="text-xs mt-1">
                  Releases appear here when Jira version webhooks are received.
                </p>
              </div>
            )}

            {!loading && releases.length > 0 && sorted.length === 0 && (
              <div className="rounded-lg border border-dashed py-10 text-center text-muted-foreground">
                <p className="text-sm">No releases match these filters.</p>
              </div>
            )}

            {sorted.length > 0 && (
              <div className="rounded-lg border overflow-hidden bg-card">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 border-b">
                    <tr className="text-left">
                      <SortableTh
                        label="Release"
                        sortKey="name"
                        activeKey={sortKey}
                        dir={sortDir}
                        onClick={toggleSort}
                      />
                      <SortableTh
                        label="Date"
                        sortKey="date"
                        activeKey={sortKey}
                        dir={sortDir}
                        onClick={toggleSort}
                        className="w-48"
                      />
                      <SortableTh
                        label="Sync"
                        sortKey="sync"
                        activeKey={sortKey}
                        dir={sortDir}
                        onClick={toggleSort}
                        className="w-56"
                      />
                      <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Template
                      </th>
                      <SortableTh
                        label="Status"
                        sortKey="status"
                        activeKey={sortKey}
                        dir={sortDir}
                        onClick={toggleSort}
                        className="w-28"
                      />
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((release) => (
                      <ReleaseRow
                        key={release.id}
                        release={release}
                        onPurge={handlePurge}
                        purging={purgingId === release.id}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </main>
      </div>
    </AppShell>
  );
}


function SortableTh({
  label,
  sortKey,
  activeKey,
  dir,
  onClick,
  className,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  dir: SortDir;
  onClick: (key: SortKey) => void;
  className?: string;
}) {
  const active = sortKey === activeKey;
  const Icon = active ? (dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th className={cn("px-3 py-2", className)}>
      <button
        onClick={() => onClick(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide transition-colors",
          active
            ? "text-foreground"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        {label}
        <Icon className="h-3 w-3 opacity-70" />
      </button>
    </th>
  );
}

function ReleaseRow({
  release,
  onPurge,
  purging,
}: {
  release: ReleaseWithMeta;
  onPurge: (release: ReleaseWithMeta) => void;
  purging: boolean;
}) {
  const { platform: p, releaseType: rt } = parseReleaseName(release.name);
  const date = relativeDate(release.releaseDate, release.released);

  return (
    <tr className="border-b last:border-b-0 hover:bg-muted/40 transition-colors group">
      <td className="px-3 py-2.5">
        <Link
          href={`/releases/${release.id}`}
          className="flex items-center gap-2 min-w-0"
        >
          <span
            className={cn(
              "font-mono text-sm truncate group-hover:underline",
              release.deletedAt && "line-through text-muted-foreground",
            )}
          >
            {release.name}
          </span>
          {p && (
            <span className="inline-flex items-center text-[10px] font-medium px-1.5 h-4 rounded bg-muted text-muted-foreground shrink-0">
              {p}
            </span>
          )}
          {rt && (
            <span className="inline-flex items-center text-[10px] font-medium px-1.5 h-4 rounded bg-muted text-muted-foreground shrink-0">
              {rt}
            </span>
          )}
        </Link>
      </td>

      <td className="px-3 py-2.5">
        <DateCell date={date} />
      </td>

      <td className="px-3 py-2.5">
        <SyncCell summary={release.syncSummary} />
      </td>

      <td className="px-3 py-2.5">
        {release.matchedTemplate ? (
          <Link
            href={`/releases/templates/${release.matchedTemplate.id}`}
            className="text-xs text-muted-foreground hover:text-foreground hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {release.matchedTemplate.name}
          </Link>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
            <AlertCircle className="h-3 w-3" />
            No template
          </span>
        )}
      </td>

      <td className="px-3 py-2.5">
        <StatusBadge release={release} />
      </td>

      <td className="px-2 py-2.5 text-right">
        {release.deletedAt && (
          <button
            type="button"
            onClick={() => onPurge(release)}
            disabled={purging}
            title="Purge release — deletes it from this app and removes associated Google Tasks / Calendar events"
            className="inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] font-medium text-red-700 dark:text-red-400 hover:bg-red-500/10 disabled:opacity-60"
          >
            {purging ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Trash2 className="h-3 w-3" />
            )}
            Purge
          </button>
        )}
      </td>
    </tr>
  );
}

function DateCell({
  date,
}: {
  date: ReturnType<typeof relativeDate>;
}) {
  const toneClass =
    date.tone === "overdue"
      ? "text-red-600 dark:text-red-400"
      : date.tone === "today" || date.tone === "soon"
      ? "text-amber-600 dark:text-amber-400"
      : date.tone === "released"
      ? "text-muted-foreground"
      : date.tone === "none"
      ? "text-muted-foreground/50"
      : "text-foreground";

  return (
    <div className="flex flex-col">
      <span className={cn("text-xs font-mono tabular-nums", toneClass)}>
        {date.label}
      </span>
      {date.subLabel && (
        <span className={cn("text-[10px]", toneClass, "opacity-80")}>
          {date.subLabel}
        </span>
      )}
    </div>
  );
}

function SyncCell({ summary }: { summary: SyncSummary }) {
  const tracked = summary.total - summary.manual;
  if (tracked === 0) {
    return <span className="text-xs text-muted-foreground/50">—</span>;
  }

  const needsAttention = summary.failed + summary.missing;
  const hasIssues = needsAttention > 0 || summary.drifted > 0;
  const allSynced = summary.synced === tracked;

  return (
    <div className="flex items-center gap-2 min-w-0">
      {/* Stacked status bar: green=synced, amber=drifted, red=failed/missing, muted=pending */}
      <div className="flex h-1.5 w-20 rounded-full bg-muted overflow-hidden shrink-0">
        {summary.synced > 0 && (
          <div
            className="h-full bg-green-500"
            style={{ width: `${(summary.synced / tracked) * 100}%` }}
          />
        )}
        {summary.drifted > 0 && (
          <div
            className="h-full bg-amber-500"
            style={{ width: `${(summary.drifted / tracked) * 100}%` }}
          />
        )}
        {needsAttention > 0 && (
          <div
            className="h-full bg-red-500"
            style={{ width: `${(needsAttention / tracked) * 100}%` }}
          />
        )}
      </div>
      <div className="flex items-center gap-1.5 text-xs tabular-nums min-w-0">
        {allSynced ? (
          <span className="inline-flex items-center gap-1 text-green-700 dark:text-green-400">
            <CheckCircle2 className="h-3 w-3" />
            {summary.synced}
          </span>
        ) : (
          <>
            {summary.failed > 0 && (
              <span className="inline-flex items-center gap-0.5 text-red-600 dark:text-red-400">
                <XCircle className="h-3 w-3" />
                {summary.failed}
              </span>
            )}
            {summary.missing > 0 && (
              <span className="inline-flex items-center gap-0.5 text-red-600 dark:text-red-400">
                <Ghost className="h-3 w-3" />
                {summary.missing}
              </span>
            )}
            {summary.drifted > 0 && (
              <span className="inline-flex items-center gap-0.5 text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-3 w-3" />
                {summary.drifted}
              </span>
            )}
            {!hasIssues && summary.pending > 0 && (
              <span className="text-muted-foreground">{summary.pending} pending</span>
            )}
            <span className="text-muted-foreground/70">
              {summary.synced}/{tracked}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ release }: { release: ReleaseWithMeta }) {
  if (release.deletedAt) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 h-5 rounded bg-red-500/10 text-red-700 dark:text-red-400">
        <Trash2 className="h-3 w-3" />
        Deleted in Jira
      </span>
    );
  }
  if (release.archived) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 h-5 rounded border text-muted-foreground">
        <Archive className="h-3 w-3" />
        Archived
      </span>
    );
  }
  if (release.released) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 h-5 rounded bg-green-500/10 text-green-700 dark:text-green-400">
        <CheckCircle2 className="h-3 w-3" />
        Released
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 h-5 rounded bg-blue-500/10 text-blue-700 dark:text-blue-400">
      Active
    </span>
  );
}
