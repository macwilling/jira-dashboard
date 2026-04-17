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
  Clock,
  Check,
  X as XIcon,
  AlertOctagon,
  RefreshCcw,
  ShieldAlert,
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
  ReleaseCategory,
  Workflow,
  ReleaseTaskInstance,
  ActionType,
  ResolutionSnapshot,
} from "@/lib/releases/types";

type ResolutionAction = "keep_original" | "switch_workflow" | "discard";
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
  const [category, setCategory] = useState<ReleaseCategory | null>(null);
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [expectedTaskCount, setExpectedTaskCount] = useState(0);
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
  const [approving, setApproving] = useState(false);
  const [cancellingApproval, setCancellingApproval] = useState(false);
  const [resolving, setResolving] = useState<ResolutionAction | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/releases/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setRelease(data.release);
        setCategory(data.category ?? null);
        setWorkflow(data.workflow ?? null);
        setExpectedTaskCount(data.expectedTaskCount ?? 0);
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

  const handleManualApprove = async () => {
    setApproving(true);
    try {
      const res = await fetch(`/api/releases/${id}/approve`, { method: "POST" });
      if (res.ok) load();
      else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Approve failed");
      }
    } finally {
      setApproving(false);
    }
  };

  const handleResolve = async (action: ResolutionAction) => {
    const confirmMsg =
      action === "discard"
        ? "Discard all non-completed tasks for this release? Google Tasks / Calendar events for them will also be deleted."
        : action === "switch_workflow"
          ? "Switch to the new workflow? Tasks from the old workflow will be deleted (remote + local) and fresh ones generated."
          : "Keep the original workflow? This release stays on the old category — future Jira updates won't re-trigger resolution for the same change.";
    if (!confirm(confirmMsg)) return;
    setResolving(action);
    setResolveError(null);
    try {
      const res = await fetch(`/api/releases/${id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResolveError(data.error || "Resolution failed");
        return;
      }
      load();
    } finally {
      setResolving(null);
    }
  };

  const handleManualCancel = async () => {
    setCancellingApproval(true);
    try {
      const res = await fetch(`/api/releases/${id}/cancel-approval`, {
        method: "POST",
      });
      if (res.ok) load();
      else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Cancel failed");
      }
    } finally {
      setCancellingApproval(false);
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
      {workflow && !release.deletedAt && (
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
            Rebuilds the checklist from the current workflow. Rows already
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

        {/* Resolution banner — release is frozen pending admin choice because
            its category changed after tasks existed. Displaces the task list
            with a three-card decision UI driven by the snapshot. */}
        {release.resolutionRequired &&
          release.resolutionSnapshot &&
          !release.deletedAt && (
            <div className="rounded-md border border-red-500/40 bg-red-500/5 px-3 py-2 flex items-start gap-3 text-sm">
              <ShieldAlert className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
              <div className="space-y-0.5">
                <p className="font-medium text-red-700 dark:text-red-400">
                  Resolution required — category changed
                </p>
                <p className="text-xs text-muted-foreground">
                  Jira renamed this release from a <code className="bg-muted px-1 rounded">{release.resolutionSnapshot.oldCategoryKey ?? "?"}</code>{" "}
                  release into{" "}
                  <code className="bg-muted px-1 rounded">
                    {release.resolutionSnapshot.newCategoryKey ?? "unmatched"}
                  </code>
                  . All task generation, dispatch, and notifications are frozen
                  until you pick a path below.
                </p>
              </div>
            </div>
          )}

        {/* Unmatched banner — prominent alert when the release isn't wired to a
            workflow. Two distinct causes: no category parsed, or category has
            no workflow assigned. Only show when not deleted, not pending
            resolution (the resolution banner takes precedence), and not
            already released. */}
        {!release.resolutionRequired &&
          !release.deletedAt &&
          !release.released &&
          !workflow && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 flex items-start gap-3 text-sm">
              <AlertOctagon className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
              <div className="flex-1 space-y-0.5">
                {!release.categoryId ? (
                  <>
                    <p className="font-medium text-amber-700 dark:text-amber-400">
                      Unmatched — name didn&apos;t parse
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Expected <code className="bg-muted px-1 rounded">platform@x.y.z</code>.
                      Until the Jira version name parses into one of the{" "}
                      <Link
                        href="/releases/categories"
                        className="underline hover:text-foreground"
                      >
                        configured categories
                      </Link>
                      , no tasks, notifications, or approvals fire for this
                      release.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-medium text-amber-700 dark:text-amber-400">
                      Category{" "}
                      <code className="bg-background px-1 rounded font-mono">
                        {category?.key ?? release.categoryId}
                      </code>{" "}
                      has no workflow
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Assign one on the{" "}
                      <Link
                        href="/releases/categories"
                        className="underline hover:text-foreground"
                      >
                        categories page
                      </Link>
                      . Until then, no tasks, notifications, or approvals fire
                      for this release.
                    </p>
                  </>
                )}
              </div>
            </div>
          )}

        {/* Approval banner — pending, approved (recently), or cancelled.
            Pending is actionable and shows Approve/Cancel buttons as a
            fallback for when the Slack interactive path fails. Approved and
            cancelled are passive state reminders. */}
        {release.approvalStatus === "pending" &&
          !release.resolutionRequired &&
          !release.deletedAt && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 flex items-start gap-3 text-sm">
            <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
            <div className="flex-1 space-y-0.5">
              <p className="font-medium text-amber-700 dark:text-amber-400">
                Awaiting approval
              </p>
              <p className="text-xs text-muted-foreground">
                Tasks are materialized but won&apos;t dispatch to Google until
                someone approves. Check Slack for the interactive message — or
                approve directly from here if Slack isn&apos;t available.
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Button
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={handleManualApprove}
                disabled={approving || cancellingApproval}
              >
                {approving ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Check className="h-3 w-3" />
                )}
                Approve
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1 text-muted-foreground"
                onClick={handleManualCancel}
                disabled={approving || cancellingApproval}
              >
                {cancellingApproval ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <XIcon className="h-3 w-3" />
                )}
                Cancel
              </Button>
            </div>
          </div>
        )}

        {release.approvalStatus === "cancelled" && !release.deletedAt && (
          <div className="rounded-md border border-muted bg-muted/30 px-3 py-2 flex items-start gap-3 text-sm">
            <XCircle className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="flex-1 space-y-0.5">
              <p className="font-medium text-foreground">Approval cancelled</p>
              <p className="text-xs text-muted-foreground">
                Tasks were not dispatched. To run them, click{" "}
                <span className="font-medium">Approve</span>.
              </p>
            </div>
            <Button
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={handleManualApprove}
              disabled={approving}
            >
              {approving ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Check className="h-3 w-3" />
              )}
              Approve anyway
            </Button>
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
              {!release.categoryId ? (
                <span className="text-muted-foreground">
                  No category matched —{" "}
                  <Link href="/releases/categories" className="hover:underline text-foreground">
                    manage categories
                  </Link>
                </span>
              ) : !workflow ? (
                <span className="text-muted-foreground">
                  Category{" "}
                  <span className="text-foreground font-medium">
                    {category?.key ?? release.categoryId}
                  </span>{" "}
                  has no workflow —{" "}
                  <Link href="/releases/categories" className="hover:underline text-foreground">
                    assign one
                  </Link>
                </span>
              ) : (
                <span className="text-muted-foreground">
                  Workflow:{" "}
                  <Link
                    href={`/releases/workflows/${workflow.id}`}
                    className="text-foreground font-medium hover:underline"
                  >
                    {workflow.name}
                  </Link>
                  {category && (
                    <span className="ml-2 text-xs text-muted-foreground/80">
                      ({category.key})
                    </span>
                  )}
                </span>
              )}
            </div>
          </div>

          {syncSummary && syncSummary.total > 0 && (
            <SyncSummaryCard summary={syncSummary} />
          )}
        </section>

        {/* Resolution cards — shown instead of the task list while resolution
            is required. Three choices driven by the snapshot. */}
        {release.resolutionRequired && release.resolutionSnapshot && !release.deletedAt ? (
          <ResolutionCards
            snapshot={release.resolutionSnapshot}
            resolving={resolving}
            error={resolveError}
            onResolve={handleResolve}
          />
        ) : /* Tasks grouped by phase */
        groups.length > 0 ? (
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
        ) : workflow ? (
          <div className="rounded-lg border border-dashed p-8 text-center space-y-3">
            <p className="text-sm text-muted-foreground">No tasks generated yet.</p>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setRegenOpen(true)}
              disabled={regenerating}
            >
              Generate from workflow
            </Button>
          </div>
        ) : !release.categoryId ? (
          <div className="rounded-lg border border-dashed p-8 text-center space-y-3">
            <p className="text-sm text-muted-foreground">
              No tasks — this release didn&apos;t match any category.
            </p>
            <Link href="/releases/categories">
              <Button variant="outline" size="sm" className="h-7 text-xs">
                Manage categories
              </Button>
            </Link>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-8 text-center space-y-3">
            <p className="text-sm text-muted-foreground">
              No tasks — category{" "}
              <span className="font-medium text-foreground">
                {category?.key ?? release.categoryId}
              </span>{" "}
              has no workflow assigned.
            </p>
            <Link href="/releases/categories">
              <Button variant="outline" size="sm" className="h-7 text-xs">
                Assign workflow
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
                {workflow?.name ?? "assigned"}
              </span>{" "}
              workflow. Useful after a workflow changes, or to reset rows that
              got into a bad state.
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
                  <span className="font-medium tabular-nums">{expectedTaskCount}</span>{" "}
                  fresh row{expectedTaskCount === 1 ? "" : "s"} from workflow{" "}
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

function ResolutionCards({
  snapshot,
  resolving,
  error,
  onResolve,
}: {
  snapshot: ResolutionSnapshot;
  resolving: ResolutionAction | null;
  error: string | null;
  onResolve: (action: ResolutionAction) => void;
}) {
  const totalNonCompleted =
    snapshot.taskCounts.pending + snapshot.taskCounts.dispatched;
  const hasNewWorkflow = !!snapshot.newWorkflowId;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">Pick a resolution</h2>
        <p className="text-xxs text-muted-foreground">
          Snapshot at {snapshot.detectedAt.slice(0, 16).replace("T", " ")} UTC —{" "}
          {snapshot.taskCounts.pending} pending ·{" "}
          {snapshot.taskCounts.dispatched} dispatched ·{" "}
          {snapshot.taskCounts.completed} completed.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <ResolutionCard
          tone="neutral"
          icon={RotateCcw}
          title="Keep original workflow"
          summary={
            <>
              Stay on{" "}
              <span className="font-medium text-foreground">
                {snapshot.oldWorkflowName ?? "the old workflow"}
              </span>
              . All {totalNonCompleted} existing task
              {totalNonCompleted === 1 ? "" : "s"} remain as-is.
            </>
          }
          when="Use when the Jira rename was a typo or a cosmetic change and the release should still behave like a {snapshot.oldCategoryKey} release."
          buttonLabel="Keep original"
          buttonVariant="outline"
          loading={resolving === "keep_original"}
          disabled={resolving !== null}
          onClick={() => onResolve("keep_original")}
        />

        <ResolutionCard
          tone={hasNewWorkflow ? "primary" : "disabled"}
          icon={RefreshCcw}
          title="Switch to new workflow"
          summary={
            hasNewWorkflow ? (
              <>
                Move to{" "}
                <span className="font-medium text-foreground">
                  {snapshot.newWorkflowName ?? "the new workflow"}
                </span>
                . Deletes {totalNonCompleted} non-completed task
                {totalNonCompleted === 1 ? "" : "s"} (Google resources
                included) and generates fresh ones.
              </>
            ) : (
              <>
                New category{" "}
                <code className="bg-muted px-1 rounded">
                  {snapshot.newCategoryKey ?? "unmatched"}
                </code>{" "}
                has no workflow assigned — not available. Assign a workflow
                first.
              </>
            )
          }
          when="Use when the Jira rename reflects the actual release shape and the release should run the new workflow's tasks."
          buttonLabel="Switch workflow"
          buttonVariant="default"
          loading={resolving === "switch_workflow"}
          disabled={resolving !== null || !hasNewWorkflow}
          onClick={() => onResolve("switch_workflow")}
        />

        <ResolutionCard
          tone="danger"
          icon={Trash2}
          title="Discard all"
          summary={
            <>
              Remove all {totalNonCompleted} non-completed task
              {totalNonCompleted === 1 ? "" : "s"} (Google resources included).
              The release is marked unmatched and won&apos;t fire anything
              until you reassign it.
            </>
          }
          when="Use when the rename means this release is cancelled or will be managed entirely out-of-band."
          buttonLabel="Discard all"
          buttonVariant="destructive"
          loading={resolving === "discard"}
          disabled={resolving !== null}
          onClick={() => onResolve("discard")}
        />
      </div>
    </section>
  );
}

function ResolutionCard({
  tone,
  icon: Icon,
  title,
  summary,
  when,
  buttonLabel,
  buttonVariant,
  loading,
  disabled,
  onClick,
}: {
  tone: "neutral" | "primary" | "danger" | "disabled";
  icon: typeof RotateCcw;
  title: string;
  summary: React.ReactNode;
  when: string;
  buttonLabel: string;
  buttonVariant: "default" | "outline" | "destructive";
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const toneClass =
    tone === "primary"
      ? "border-primary/30"
      : tone === "danger"
        ? "border-red-500/20"
        : tone === "disabled"
          ? "opacity-60"
          : "";

  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-4 flex flex-col gap-3 min-h-[220px]",
        toneClass,
      )}
    >
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <p className="text-xs text-muted-foreground flex-1">{summary}</p>
      <p className="text-xxs text-muted-foreground/80 border-t pt-2">
        <span className="font-medium">When:</span> {when}
      </p>
      <Button
        size="sm"
        variant={buttonVariant}
        onClick={onClick}
        disabled={disabled}
        className="h-7 text-xs gap-1.5"
      >
        {loading ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Icon className="h-3 w-3" />
        )}
        {buttonLabel}
      </Button>
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
