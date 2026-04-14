"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Loader2,
  RefreshCw,
  CheckCircle2,
  Circle,
  MinusCircle,
  Calendar,
  Package,
  Play,
  ExternalLink,
  AlertTriangle,
  ArrowRight,
  Trash2,
} from "lucide-react";
import { AppShell } from "@/components/app-shell/AppShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  TaskInstanceStatus,
} from "@/lib/releases/types";

const ACTION_LABELS: Record<ActionType, string> = {
  manual: "Manual",
  google_task: "Google Task",
  calendar_event: "Calendar",
  slack_message: "Slack",
};

const ACTION_DISPATCH_LABEL: Record<ActionType, string> = {
  manual: "",
  google_task: "Create task",
  calendar_event: "Create event",
  slack_message: "Send message",
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
  if (!iso) return { label: "No date", tone: "none" };
  const pretty = formatShortDate(iso);
  const d = daysFromToday(iso);
  if (d < 0) return { label: `${pretty} · ${Math.abs(d)}d overdue`, tone: "overdue" };
  if (d === 0) return { label: `${pretty} · today`, tone: "today" };
  if (d <= 3) return { label: `${pretty} · in ${d}d`, tone: "soon" };
  return { label: `${pretty} · in ${d}d`, tone: "future" };
}

function DateChip({ dueDate, done }: { dueDate: string | null; done: boolean }) {
  const meta = dateMeta(dueDate);
  const tone = done ? "none" : meta.tone;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded font-mono tabular-nums shrink-0",
        tone === "overdue" && "bg-red-500/10 text-red-600 dark:text-red-400",
        tone === "today" && "bg-amber-500/15 text-amber-700 dark:text-amber-400",
        tone === "soon" && "bg-amber-500/10 text-amber-700/80 dark:text-amber-400/80",
        tone === "future" && "bg-muted text-muted-foreground",
        tone === "none" && "bg-muted/50 text-muted-foreground/70",
      )}
    >
      <Calendar className="h-3 w-3" />
      {meta.label}
    </span>
  );
}

function StatusToggle({
  status,
  onChange,
  disabled,
}: {
  status: TaskInstanceStatus;
  onChange: (next: TaskInstanceStatus) => void;
  disabled?: boolean;
}) {
  const opts: { value: TaskInstanceStatus; icon: typeof Circle; label: string }[] = [
    { value: "pending", icon: Circle, label: "Pending" },
    { value: "done", icon: CheckCircle2, label: "Done" },
    { value: "skipped", icon: MinusCircle, label: "Skip" },
  ];
  return (
    <div
      role="group"
      className="inline-flex rounded-md border bg-background overflow-hidden shrink-0"
    >
      {opts.map(({ value, icon: Icon, label }) => {
        const active = status === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => onChange(value)}
            disabled={disabled}
            title={label}
            aria-label={label}
            aria-pressed={active}
            className={cn(
              "flex items-center justify-center h-7 w-7 transition-colors disabled:opacity-50",
              "border-r last:border-r-0",
              active && value === "pending" && "bg-muted text-foreground",
              active && value === "done" && "bg-green-500/15 text-green-700 dark:text-green-400",
              active && value === "skipped" && "bg-muted text-muted-foreground",
              !active && "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        );
      })}
    </div>
  );
}

function ActionBadge({ type }: { type: ActionType }) {
  if (type === "manual") {
    return (
      <Badge variant="outline" className="text-xxs h-4 px-1.5 text-muted-foreground">
        {ACTION_LABELS[type]}
      </Badge>
    );
  }
  if (type === "slack_message") {
    return (
      <Badge variant="outline" className="text-xxs h-4 px-1.5 text-muted-foreground/60 border-dashed">
        {ACTION_LABELS[type]} (n/a)
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="text-xxs h-4 px-1.5">
      {ACTION_LABELS[type]}
    </Badge>
  );
}

interface PhaseGroup {
  key: "before" | "release" | "after";
  title: string;
  subtitle: string;
  items: ReleaseTaskInstance[];
}

function groupByPhase(instances: ReleaseTaskInstance[]): PhaseGroup[] {
  const before: ReleaseTaskInstance[] = [];
  const onDay: ReleaseTaskInstance[] = [];
  const after: ReleaseTaskInstance[] = [];
  for (const i of instances) {
    if (i.dayOffset < 0) before.push(i);
    else if (i.dayOffset === 0) onDay.push(i);
    else after.push(i);
  }
  const sortAsc = (arr: ReleaseTaskInstance[]) =>
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
  const [instances, setInstances] = useState<ReleaseTaskInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [regenOpen, setRegenOpen] = useState(false);
  const [dispatchingId, setDispatchingId] = useState<string | null>(null);
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
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const handleSetStatus = async (
    instance: ReleaseTaskInstance,
    next: TaskInstanceStatus,
  ) => {
    if (next === instance.status) return;
    const prevStatus = instance.status;
    setInstances((prev) =>
      prev.map((i) => (i.id === instance.id ? { ...i, status: next } : i)),
    );
    try {
      const res = await fetch(`/api/releases/${id}/tasks/${instance.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error("failed");
    } catch {
      setInstances((prev) =>
        prev.map((i) => (i.id === instance.id ? { ...i, status: prevStatus } : i)),
      );
    }
  };

  const handleDispatch = async (instance: ReleaseTaskInstance) => {
    setDispatchingId(instance.id);
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
        setInstances((prev) =>
          prev.map((i) =>
            i.id === instance.id
              ? {
                  ...i,
                  status: "done",
                  externalId: data.externalId ?? i.externalId,
                  externalUrl: data.externalUrl ?? i.externalUrl,
                }
              : i,
          ),
        );
      } else {
        setRowErrors((e) => ({ ...e, [instance.id]: data.error || "Dispatch failed" }));
      }
    } catch (e) {
      setRowErrors((errs) => ({ ...errs, [instance.id]: (e as Error).message }));
    } finally {
      setDispatchingId(null);
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
        setInstances(data.taskInstances ?? []);
        setRegenOpen(false);
      } else {
        setError(data.error || "Failed to regenerate tasks");
      }
    } finally {
      setRegenerating(false);
    }
  };

  const counts = useMemo(() => {
    const pending = instances.filter((i) => i.status === "pending").length;
    const done = instances.filter((i) => i.status === "done").length;
    const skipped = instances.filter((i) => i.status === "skipped").length;
    return { pending, done, skipped, total: instances.length };
  }, [instances]);

  const parsed = release ? parseReleaseName(release.name) : null;
  const groups = useMemo(() => groupByPhase(instances), [instances]);

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

  const actions = (
    <div className="ml-auto flex items-center gap-1">
      {matchedTemplate && !release.deletedAt && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs gap-1.5 text-muted-foreground"
          onClick={() => setRegenOpen(true)}
          disabled={regenerating}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Regenerate
        </Button>
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

  const pct = counts.total ? Math.round((counts.done / counts.total) * 100) : 0;

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

        {/* Header: meta + progress summary */}
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

          {counts.total > 0 && (
            <div className="rounded-lg border bg-muted/20 px-4 py-3 min-w-[220px]">
              <div className="flex items-baseline justify-between gap-3 mb-2">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">Progress</span>
                <span className="text-sm font-semibold tabular-nums">
                  {counts.done}/{counts.total}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-green-500 transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="flex gap-3 mt-2 text-xxs text-muted-foreground tabular-nums">
                <span>{counts.pending} pending</span>
                <span>{counts.done} done</span>
                {counts.skipped > 0 && <span>{counts.skipped} skipped</span>}
              </div>
            </div>
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
                    {group.items.filter((i) => i.status === "done").length}/{group.items.length}
                  </span>
                </div>
                <div className="rounded-lg border divide-y overflow-hidden">
                  {group.items.map((instance) => {
                    const canDispatch =
                      instance.status === "pending" &&
                      (instance.actionType === "google_task" ||
                        instance.actionType === "calendar_event");
                    const hasExternal = !!instance.externalUrl;
                    const rowError = rowErrors[instance.id] ?? instance.lastDispatchError;
                    return (
                      <div key={instance.id} className="group">
                        <div className="flex items-center gap-3 px-3 py-2.5">
                          <StatusToggle
                            status={instance.status}
                            onChange={(next) => handleSetStatus(instance, next)}
                            disabled={dispatchingId === instance.id}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                              <p
                                className={cn(
                                  "text-sm truncate",
                                  instance.status === "done" && "line-through text-muted-foreground",
                                  instance.status === "skipped" && "text-muted-foreground",
                                )}
                              >
                                {instance.label}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 mt-0.5 text-xxs text-muted-foreground">
                              <ActionBadge type={instance.actionType} />
                              {instance.dayOffset !== 0 && (
                                <span className="tabular-nums font-mono">
                                  {instance.dayOffset > 0 ? "+" : ""}
                                  {instance.dayOffset}d
                                </span>
                              )}
                            </div>
                          </div>
                          <DateChip
                            dueDate={instance.dueDate}
                            done={instance.status === "done" || instance.status === "skipped"}
                          />
                          {hasExternal && (
                            <a
                              href={instance.externalUrl!}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
                              title="Open in Google"
                            >
                              <ExternalLink className="h-3 w-3" />
                              Open
                            </a>
                          )}
                          {canDispatch && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs gap-1.5 shrink-0"
                              onClick={() => handleDispatch(instance)}
                              disabled={dispatchingId === instance.id}
                            >
                              {dispatchingId === instance.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Play className="h-3 w-3" />
                              )}
                              {ACTION_DISPATCH_LABEL[instance.actionType]}
                            </Button>
                          )}
                        </div>
                        {rowError && (
                          <div className="px-3 pb-2 pl-[calc(0.75rem+84px+0.75rem)] flex items-start gap-1.5 text-xs text-destructive">
                            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                            <span>{rowError}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
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

      {/* Regenerate confirm */}
      <Dialog open={regenOpen} onOpenChange={setRegenOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Regenerate tasks</DialogTitle>
            <DialogDescription>
              This rebuilds the pending checklist from{" "}
              <span className="font-medium text-foreground">
                {matchedTemplate?.name}
              </span>
              . Existing <span className="font-medium text-foreground">done</span> and{" "}
              <span className="font-medium text-foreground">skipped</span> tasks are kept.
              Any new Google Task or Calendar rows will be dispatched automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border bg-muted/30 p-3 space-y-1.5 text-xs">
            <div className="flex items-center gap-2">
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
              <span>Delete <span className="font-mono tabular-nums">{counts.pending}</span> pending task{counts.pending === 1 ? "" : "s"}</span>
            </div>
            <div className="flex items-center gap-2">
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
              <span>
                Keep <span className="font-mono tabular-nums">{counts.done}</span> done
                {counts.skipped > 0 && <>, <span className="font-mono tabular-nums">{counts.skipped}</span> skipped</>}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
              <span>
                Create <span className="font-mono tabular-nums">{templateTaskCount}</span> new task{templateTaskCount === 1 ? "" : "s"} from template
              </span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRegenOpen(false)} disabled={regenerating}>
              Cancel
            </Button>
            <Button onClick={handleRegenerate} disabled={regenerating}>
              {regenerating && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Regenerate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
