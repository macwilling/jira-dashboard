"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Loader2,
  RefreshCw,
  Calendar,
  Package,
  ExternalLink,
  AlertTriangle,
  Trash2,
  CheckCircle2,
  Circle,
  XCircle,
  Ghost,
  RotateCcw,
  Minus,
  ArrowUpToLine,
} from "lucide-react";
import { AppShell } from "@/components/app-shell/AppShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { parseReleaseName } from "@/lib/releases/matcher";
import { cn } from "@/lib/utils";
import type {
  Release,
  ReleaseTemplate,
  ReleaseTaskInstance,
  ActionType,
} from "@/lib/releases/types";
import type { SyncState, SyncSummary } from "@/lib/releases/sync-state";

type InstanceWithState = ReleaseTaskInstance & { syncState: SyncState };

const ACTION_LABELS: Record<ActionType, string> = {
  manual: "Manual",
  google_task: "Google Task",
  calendar_event: "Calendar",
};

function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

function formatShortDate(iso: string): string {
  const d = new Date(`${dateOnly(iso)}T00:00:00`);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function daysFromToday(iso: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${dateOnly(iso)}T00:00:00`);
  if (isNaN(target.getTime())) return 0;
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

interface DateMeta {
  label: string;
  tone: "overdue" | "today" | "soon" | "future" | "none";
}

function dateMeta(iso: string | null): DateMeta {
  if (!iso) return { label: "—", tone: "none" };
  const pretty = formatShortDate(iso);
  const d = daysFromToday(iso);
  if (d < 0) return { label: pretty, tone: "overdue" };
  if (d === 0) return { label: pretty, tone: "today" };
  if (d <= 3) return { label: pretty, tone: "soon" };
  return { label: pretty, tone: "future" };
}

interface SyncMeta {
  label: string;
  icon: typeof Circle;
  /** Color for icon + state label text. */
  accentClass: string;
  /** Left-border accent for problem rows; empty for calm rows. */
  borderClass: string;
  /** Very subtle row background for problem rows; empty for calm rows. */
  rowBgClass: string;
  tone: "ok" | "warn" | "bad" | "neutral";
}

const SYNC_META: Record<SyncState, SyncMeta> = {
  synced: {
    label: "Synced",
    icon: CheckCircle2,
    accentClass: "text-green-600 dark:text-green-500",
    borderClass: "",
    rowBgClass: "",
    tone: "ok",
  },
  pending: {
    label: "Pending",
    icon: Circle,
    accentClass: "text-muted-foreground/60",
    borderClass: "",
    rowBgClass: "",
    tone: "neutral",
  },
  failed: {
    label: "Failed",
    icon: XCircle,
    accentClass: "text-red-600 dark:text-red-500",
    borderClass: "border-l-2 border-red-500",
    rowBgClass: "bg-red-500/[0.03]",
    tone: "bad",
  },
  missing: {
    label: "Missing",
    icon: Ghost,
    accentClass: "text-red-600 dark:text-red-500",
    borderClass: "border-l-2 border-red-500",
    rowBgClass: "bg-red-500/[0.03]",
    tone: "bad",
  },
  drifted: {
    label: "Drifted",
    icon: AlertTriangle,
    accentClass: "text-amber-600 dark:text-amber-500",
    borderClass: "border-l-2 border-amber-500",
    rowBgClass: "bg-amber-500/[0.03]",
    tone: "warn",
  },
  manual: {
    label: "Manual",
    icon: Minus,
    accentClass: "text-muted-foreground/50",
    borderClass: "",
    rowBgClass: "",
    tone: "neutral",
  },
};

/** Strips the MISSING:/DRIFT: prefixes used internally for state derivation. */
function prettyError(err: string | null): string | null {
  if (!err) return null;
  return err.replace(/^(MISSING|DRIFT):\s*/, "");
}

interface PhaseGroup {
  key: "before" | "release" | "after";
  title: string;
  subtitle: string;
  items: InstanceWithState[];
}

function groupByPhase(instances: InstanceWithState[]): PhaseGroup[] {
  const before: InstanceWithState[] = [];
  const onDay: InstanceWithState[] = [];
  const after: InstanceWithState[] = [];
  for (const i of instances) {
    if (i.dayOffset < 0) before.push(i);
    else if (i.dayOffset === 0) onDay.push(i);
    else after.push(i);
  }
  const sortAsc = (arr: InstanceWithState[]) =>
    arr.sort((a, b) => a.dayOffset - b.dayOffset);
  const groups: PhaseGroup[] = [
    { key: "before", title: "Before release", subtitle: "Prep work leading up to ship", items: sortAsc(before) },
    { key: "release", title: "Release day", subtitle: "Day of", items: sortAsc(onDay) },
    { key: "after", title: "After release", subtitle: "Follow-ups", items: sortAsc(after) },
  ];
  return groups.filter((g) => g.items.length > 0);
}

export default function ReleasePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [release, setRelease] = useState<Release | null>(null);
  const [matchedTemplate, setMatchedTemplate] = useState<ReleaseTemplate | null>(null);
  const [templateTaskCount, setTemplateTaskCount] = useState(0);
  const [instances, setInstances] = useState<InstanceWithState[]>([]);
  const [syncSummary, setSyncSummary] = useState<SyncSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regenOpen, setRegenOpen] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [pushingId, setPushingId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [purging, setPurging] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/releases/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setRelease(data.release);
        setMatchedTemplate(data.matchedTemplate);
        setTemplateTaskCount(data.matchedTemplateTaskCount ?? 0);
        setInstances(data.taskInstances ?? []);
        setSyncSummary(data.syncSummary ?? null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const handleRefreshSync = async () => {
    setRefreshing(true);
    setRowErrors({});
    try {
      const res = await fetch(`/api/releases/${id}/refresh-sync`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setInstances(data.taskInstances ?? []);
        setSyncSummary(data.syncSummary ?? null);
      } else {
        setError(data.error || "Refresh failed");
      }
    } finally {
      setRefreshing(false);
    }
  };

  const handleRetry = async (instance: InstanceWithState) => {
    setRetryingId(instance.id);
    setRowErrors((e) => {
      const next = { ...e };
      delete next[instance.id];
      return next;
    });
    try {
      const res = await fetch(
        `/api/releases/${id}/tasks/${instance.id}/dispatch`,
        { method: "POST" },
      );
      const data = await res.json();
      if (res.ok) {
        // Reload to pick up authoritative sync state.
        load();
      } else {
        setRowErrors((e) => ({ ...e, [instance.id]: data.error || "Dispatch failed" }));
      }
    } catch (e) {
      setRowErrors((errs) => ({ ...errs, [instance.id]: (e as Error).message }));
    } finally {
      setRetryingId(null);
    }
  };

  const handlePushToGoogle = async (instance: InstanceWithState) => {
    setPushingId(instance.id);
    setRowErrors((e) => {
      const next = { ...e };
      delete next[instance.id];
      return next;
    });
    try {
      const res = await fetch(
        `/api/releases/${id}/tasks/${instance.id}/push-to-google`,
        { method: "POST" },
      );
      const data = await res.json();
      if (res.ok) {
        load();
      } else {
        setRowErrors((e) => ({ ...e, [instance.id]: data.error || "Push failed" }));
      }
    } catch (e) {
      setRowErrors((errs) => ({ ...errs, [instance.id]: (e as Error).message }));
    } finally {
      setPushingId(null);
    }
  };

  const handlePurge = async () => {
    if (!release) return;
    const withExternal = instances.filter((i) => !!i.externalId).length;
    const googleLine = withExternal
      ? `\n\nThe app will attempt to delete ${withExternal} associated Google Task / Calendar item(s).`
      : "";
    if (
      !confirm(
        `Purge "${release.name}"? This deletes the release and its task history from this app.${googleLine}`,
      )
    ) {
      return;
    }
    setPurging(true);
    try {
      const res = await fetch(`/api/releases/${id}/purge`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Purge failed");
        return;
      }
      if (data.errors && data.errors.length > 0) {
        const lines = data.errors
          .map((e: { label: string; error: string }) => `• ${e.label}: ${e.error}`)
          .join("\n");
        alert(
          `Release purged. Some Google cleanup failed — delete these by hand:\n\n${lines}`,
        );
      }
      router.push("/releases");
    } finally {
      setPurging(false);
    }
  };

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      const res = await fetch(`/api/releases/${id}/tasks`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        // Re-fetch to get fresh syncState values.
        setRegenOpen(false);
        load();
      } else {
        setError(data.error || "Failed to regenerate tasks");
      }
    } finally {
      setRegenerating(false);
    }
  };

  const parsed = release ? parseReleaseName(release.name) : null;
  const groups = useMemo(() => groupByPhase(instances), [instances]);

  // Count pending dispatches that are rebuilt on regenerate (used in the dialog).
  const pendingRegenCount = useMemo(
    () => instances.filter((i) => i.syncState === "pending" || i.syncState === "failed").length,
    [instances],
  );
  const syncedKeepCount = useMemo(
    () => instances.filter((i) => i.syncState === "synced" || i.syncState === "drifted").length,
    [instances],
  );

  if (loading) {
    return (
      <AppShell title="Release">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </AppShell>
    );
  }

  if (error || !release) {
    return (
      <AppShell title="Release">
        <div className="flex items-center justify-center py-20">
          <p className="text-sm text-destructive">{error ?? "Release not found"}</p>
        </div>
      </AppShell>
    );
  }

  const jiraUrl = process.env.NEXT_PUBLIC_JIRA_URL
    ? `${process.env.NEXT_PUBLIC_JIRA_URL}/projects/IST/versions/${release.id}`
    : null;

  const actions = (
    <div className="ml-auto flex items-center gap-1">
      {jiraUrl && (
        <Tooltip>
          <TooltipTrigger
            render={
              <a
                href={jiraUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 h-7 px-2 text-xs rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              />
            }
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Edit in Jira
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs text-xs leading-snug">
            Open this release&apos;s version page in Jira. Jira is the source of
            truth — changes there flow back via webhook and cascade to Google.
          </TooltipContent>
        </Tooltip>
      )}
      {!release.deletedAt && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1.5 text-muted-foreground"
                onClick={handleRefreshSync}
                disabled={refreshing}
              />
            }
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            Refresh sync
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs text-xs leading-snug">
            Re-checks each row against Google Tasks and Google Calendar to catch
            events that were deleted, moved, or re-dated. Read-only — doesn&apos;t
            change anything in Google.
          </TooltipContent>
        </Tooltip>
      )}
      {matchedTemplate && !release.deletedAt && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1.5 text-muted-foreground"
                onClick={() => setRegenOpen(true)}
                disabled={regenerating}
              />
            }
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Rebuild
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs text-xs leading-snug">
            Rebuilds the checklist from the current template. Rows already
            created in Google are kept; undispatched rows are replaced.
          </TooltipContent>
        </Tooltip>
      )}
      {release.deletedAt && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs gap-1.5 text-red-700 dark:text-red-400 hover:bg-red-500/10"
          onClick={handlePurge}
          disabled={purging}
        >
          {purging ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
          Purge
        </Button>
      )}
    </div>
  );

  return (
    <AppShell title={<span className="font-mono">{release.name}</span>} actions={actions}>
      <main className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        {release.deletedAt && (
          <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 flex items-start gap-2 text-sm">
            <Trash2 className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
            <div className="space-y-0.5">
              <p className="font-medium text-red-700 dark:text-red-400">
                Deleted in Jira
              </p>
              <p className="text-xs text-muted-foreground">
                This release was deleted in Jira on{" "}
                {release.deletedAt.slice(0, 10)}. Task history is kept until you
                click <span className="font-medium">Purge</span>, which removes
                the release from this app and attempts to delete any associated
                Google Tasks / Calendar events.
              </p>
            </div>
          </div>
        )}

        {/* Header: meta + sync summary */}
        <section className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-start">
          <div className="space-y-2 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              {parsed?.platform && (
                <Badge variant="secondary" className="text-xs h-5 px-1.5">
                  {parsed.platform}
                </Badge>
              )}
              {parsed?.releaseType && (
                <Badge variant="secondary" className="text-xs h-5 px-1.5">
                  {parsed.releaseType}
                </Badge>
              )}
              {release.released && <Badge variant="secondary" className="text-xs h-5 px-1.5">Released</Badge>}
              {release.archived && <Badge variant="outline" className="text-xs h-5 px-1.5">Archived</Badge>}
              {release.releaseDate && (
                <span className="text-xs text-muted-foreground inline-flex items-center gap-1 tabular-nums">
                  <Calendar className="h-3 w-3" />
                  {formatShortDate(release.releaseDate)}
                </span>
              )}
            </div>
            {release.description && (
              <p className="text-sm text-muted-foreground">{release.description}</p>
            )}
            <div className="flex items-center gap-2 text-sm">
              <Package className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              {matchedTemplate ? (
                <span className="text-muted-foreground">
                  Template:{" "}
                  <Link
                    href={`/releases/templates/${matchedTemplate.id}`}
                    className="text-foreground font-medium hover:underline"
                  >
                    {matchedTemplate.name}
                  </Link>
                </span>
              ) : (
                <span className="text-muted-foreground">
                  No template matched —{" "}
                  <Link href="/releases/templates" className="hover:underline text-foreground">
                    manage templates
                  </Link>
                </span>
              )}
            </div>
          </div>

          {syncSummary && syncSummary.total > 0 && (
            <SyncSummaryCard summary={syncSummary} />
          )}
        </section>

        {/* Tasks grouped by phase */}
        {groups.length > 0 ? (
          <div className="space-y-5">
            {groups.map((group) => (
              <section key={group.key} className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <div>
                    <h2 className="text-sm font-semibold">{group.title}</h2>
                    <p className="text-xxs text-muted-foreground">{group.subtitle}</p>
                  </div>
                  <span className="text-xxs text-muted-foreground tabular-nums">
                    {group.items.length}
                  </span>
                </div>
                <div className="rounded-lg border divide-y overflow-hidden">
                  {group.items.map((instance) => (
                    <TaskRow
                      key={instance.id}
                      instance={instance}
                      retrying={retryingId === instance.id}
                      pushing={pushingId === instance.id}
                      rowError={rowErrors[instance.id]}
                      onRetry={() => handleRetry(instance)}
                      onPushToGoogle={() => handlePushToGoogle(instance)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : matchedTemplate ? (
          <div className="rounded-lg border border-dashed p-8 text-center space-y-3">
            <p className="text-sm text-muted-foreground">No tasks generated yet.</p>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setRegenOpen(true)}
              disabled={regenerating}
            >
              Generate from template
            </Button>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-8 text-center space-y-3">
            <p className="text-sm text-muted-foreground">
              No tasks — create a template that matches this release.
            </p>
            <Link href="/releases/templates">
              <Button variant="outline" size="sm" className="h-7 text-xs">
                Manage templates
              </Button>
            </Link>
          </div>
        )}
      </main>

      {/* Rebuild confirm */}
      <Dialog open={regenOpen} onOpenChange={setRegenOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rebuild checklist?</DialogTitle>
            <DialogDescription>
              Rebuilds this release&apos;s checklist from the{" "}
              <span className="font-medium text-foreground">
                {matchedTemplate?.name}
              </span>{" "}
              template. Useful after the template changes, or to reset rows
              that got into a bad state.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-sm">
            <div className="rounded-md border bg-muted/30 p-3 space-y-2">
              <div className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-green-600 shrink-0" />
                <div>
                  <span className="font-medium tabular-nums">{syncedKeepCount}</span>{" "}
                  row{syncedKeepCount === 1 ? "" : "s"} already in Google{" "}
                  <span className="text-muted-foreground">— kept as-is</span>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-muted-foreground shrink-0" />
                <div>
                  <span className="font-medium tabular-nums">{pendingRegenCount}</span>{" "}
                  row{pendingRegenCount === 1 ? "" : "s"} not yet in Google{" "}
                  <span className="text-muted-foreground">— removed</span>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-blue-600 shrink-0" />
                <div>
                  <span className="font-medium tabular-nums">{templateTaskCount}</span>{" "}
                  fresh row{templateTaskCount === 1 ? "" : "s"} from template{" "}
                  <span className="text-muted-foreground">
                    — created and dispatched to Google automatically
                  </span>
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Existing Google Tasks and Calendar events aren&apos;t touched —
              only this app&apos;s checklist. If you want to remove a Google
              item, delete it in Google and click{" "}
              <span className="font-medium text-foreground">Refresh sync</span>.
            </p>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setRegenOpen(false)} disabled={regenerating}>
              Cancel
            </Button>
            <Button onClick={handleRegenerate} disabled={regenerating}>
              {regenerating && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Rebuild
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function TaskRow({
  instance,
  retrying,
  pushing,
  rowError,
  onRetry,
  onPushToGoogle,
}: {
  instance: InstanceWithState;
  retrying: boolean;
  pushing: boolean;
  rowError: string | undefined;
  onRetry: () => void;
  onPushToGoogle: () => void;
}) {
  const state = instance.syncState;
  const meta = SYNC_META[state];
  const Icon = meta.icon;
  const canRetry = state === "failed" || state === "missing";
  const canPush = state === "drifted";
  const hasExternal = !!instance.externalUrl;
  const detailError = prettyError(rowError ?? instance.lastDispatchError);
  const showError = detailError && meta.tone !== "ok" && meta.tone !== "neutral";
  const date = dateMeta(instance.dueDate);
  const dateText = !instance.allDay && instance.startTime
    ? `${date.label} ${instance.startTime}`
    : date.label;

  return (
    <div
      className={cn(
        "grid grid-cols-[20px_minmax(0,1fr)_140px_84px_28px_112px] items-center gap-3 px-4 py-2.5 transition-colors",
        meta.borderClass,
        meta.rowBgClass,
      )}
    >
      {/* Status icon */}
      <Icon className={cn("h-4 w-4 shrink-0", meta.accentClass)} aria-label={meta.label} />

      {/* Label + secondary line */}
      <div className="min-w-0">
        <div className="text-sm text-foreground truncate">{instance.label}</div>
        <div className="text-xs text-muted-foreground truncate">
          {ACTION_LABELS[instance.actionType]}
          {instance.dayOffset !== 0 && (
            <> · {instance.dayOffset > 0 ? "+" : ""}{instance.dayOffset}d</>
          )}
        </div>
      </div>

      {/* Date */}
      <div className="text-xs text-muted-foreground font-mono tabular-nums text-right">
        {dateText}
      </div>

      {/* State label — colored for problem states, muted otherwise */}
      <div className={cn("text-xs text-right font-medium", meta.accentClass)}>
        {meta.label}
      </div>

      {/* Open link — icon-only, always same column for alignment */}
      <div className="flex justify-center">
        {hasExternal && (
          <a
            href={instance.externalUrl!}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center h-7 w-7 text-muted-foreground/60 hover:text-foreground transition-colors rounded"
            title="Open in Google"
            aria-label="Open in Google"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>

      {/* Primary action — Retry / Accept / nothing */}
      <div className="flex justify-end">
        {canRetry ? (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1.5 px-2.5 w-full"
            onClick={onRetry}
            disabled={retrying}
          >
            {retrying ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RotateCcw className="h-3 w-3" />
            )}
            Retry
          </Button>
        ) : canPush ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1.5 px-2.5 w-full border-amber-500/40 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
                  onClick={onPushToGoogle}
                  disabled={pushing}
                />
              }
            >
              {pushing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <ArrowUpToLine className="h-3 w-3" />
              )}
              Push to Google
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-xs text-xs leading-snug">
              Overwrites the Google event with the expected date/time (derived
              from the Jira release date). Use to re-assert Jira as the source
              of truth when someone edited the event in Google.
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>

      {/* Error detail — spans from label column across all trailing columns */}
      {showError && (
        <div className={cn("col-start-2 col-span-5 text-xs", meta.accentClass)}>
          {detailError}
        </div>
      )}
    </div>
  );
}

function SyncSummaryCard({ summary }: { summary: SyncSummary }) {
  const tracked = summary.total - summary.manual;
  const issues = [
    summary.failed && { n: summary.failed, label: "failed", bad: true },
    summary.missing && { n: summary.missing, label: "missing", bad: true },
    summary.drifted && { n: summary.drifted, label: "drifted", bad: false },
    summary.pending && { n: summary.pending, label: "pending", bad: false },
  ].filter(Boolean) as { n: number; label: string; bad: boolean }[];

  return (
    <div className="flex items-baseline gap-3 min-w-[200px] justify-end">
      <div className="text-right">
        <div className="text-2xl font-semibold tabular-nums leading-none">
          {summary.synced}
          <span className="text-muted-foreground/60 text-lg font-normal">
            {" "}/ {tracked}
          </span>
        </div>
        <div className="text-xs text-muted-foreground mt-1">synced</div>
      </div>
      {issues.length > 0 && (
        <div className="border-l pl-3 text-xs text-muted-foreground space-y-0.5">
          {issues.map((i) => (
            <div
              key={i.label}
              className={cn(
                "tabular-nums",
                i.bad && "text-red-600 dark:text-red-500",
              )}
            >
              {i.n} {i.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
