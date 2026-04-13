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
  Trash2,
} from "lucide-react";
import { AppShell } from "@/components/app-shell/AppShell";
import { cn } from "@/lib/utils";
import type { Release } from "@/lib/releases/types";
import { parseReleaseName } from "@/lib/releases/matcher";

interface ReleaseWithMeta extends Release {
  matchedTemplate: { id: string; name: string } | null;
  taskProgress: { total: number; done: number };
}

type ScopeFilter = "all" | "upcoming" | "released" | "archived" | "deleted";
type TemplateFilter = "all" | "has" | "none";

type SortKey = "date" | "name" | "progress" | "status";
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

function daysBetween(iso: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(iso + "T00:00:00");
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

function relativeDate(iso: string | null, released: boolean): {
  label: string;
  subLabel: string;
  tone: "overdue" | "soon" | "today" | "future" | "released" | "none";
} {
  if (!iso) return { label: "No date", subLabel: "", tone: "none" };
  const days = daysBetween(iso);
  if (released) return { label: iso, subLabel: "shipped", tone: "released" };
  if (days < 0) return { label: iso, subLabel: `${Math.abs(days)}d overdue`, tone: "overdue" };
  if (days === 0) return { label: iso, subLabel: "today", tone: "today" };
  if (days <= 7) return { label: iso, subLabel: `in ${days}d`, tone: "soon" };
  return { label: iso, subLabel: `in ${days}d`, tone: "future" };
}

function progressTone(done: number, total: number, dateTone: string, released: boolean) {
  if (released || total === 0) return "neutral";
  const pct = done / total;
  if (dateTone === "overdue" && pct < 1) return "danger";
  if (dateTone === "soon" && pct < 0.75) return "warn";
  if (pct === 1) return "done";
  return "neutral";
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
        case "progress": {
          const pa = a.taskProgress.total === 0 ? -1 : a.taskProgress.done / a.taskProgress.total;
          const pb = b.taskProgress.total === 0 ? -1 : b.taskProgress.done / b.taskProgress.total;
          cmp = pa - pb;
          break;
        }
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
        {/* Filter bar */}
        <div className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur px-4 py-2">
          <div className="max-w-7xl mx-auto flex items-center gap-2 flex-wrap">
            <FilterGroup
              label="Scope"
              value={scope}
              onChange={(v) => setScope(v as ScopeFilter)}
              options={(Object.keys(SCOPE_LABEL) as ScopeFilter[]).map((s) => ({
                value: s,
                label: SCOPE_LABEL[s],
                count: counts[s],
              }))}
            />

            <div className="w-px h-4 bg-border mx-1" />

            <FilterGroup
              label="Template"
              value={templateFilter}
              onChange={(v) => setTemplateFilter(v as TemplateFilter)}
              options={(Object.keys(TEMPLATE_LABEL) as TemplateFilter[]).map(
                (s) => ({ value: s, label: TEMPLATE_LABEL[s] })
              )}
            />

            {platformOptions.length > 0 && (
              <>
                <div className="w-px h-4 bg-border mx-1" />
                <label className="text-xs text-muted-foreground">Platform</label>
                <select
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value)}
                  className="text-xs h-7 rounded-md border bg-background px-2"
                >
                  <option value="">Any</option>
                  {platformOptions.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </>
            )}

            <span className="ml-auto text-xs text-muted-foreground tabular-nums">
              {sorted.length} of {releases.length}
            </span>
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
                        label="Progress"
                        sortKey="progress"
                        activeKey={sortKey}
                        dir={sortDir}
                        onClick={toggleSort}
                        className="w-48"
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

function FilterGroup<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; count?: number }[];
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground pr-1">
        {label}
      </span>
      <div className="inline-flex items-center gap-0.5 p-0.5 rounded-md bg-muted/50">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={cn(
              "inline-flex items-center gap-1.5 px-2 h-6 rounded text-xs transition-colors",
              value === opt.value
                ? "bg-background text-foreground shadow-sm font-medium"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {opt.label}
            {opt.count != null && (
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {opt.count}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
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
  const done = release.taskProgress.done;
  const total = release.taskProgress.total;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  const pTone = progressTone(done, total, date.tone, release.released);

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
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-24 rounded-full bg-muted overflow-hidden shrink-0">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                pTone === "done" && "bg-green-500",
                pTone === "warn" && "bg-amber-500",
                pTone === "danger" && "bg-red-500",
                pTone === "neutral" && "bg-foreground/60"
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
          {total > 0 ? (
            <span className="text-xs tabular-nums text-muted-foreground">
              {done}/{total}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          )}
        </div>
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
