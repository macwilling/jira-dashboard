"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Loader2,
  RefreshCw,
  CheckCircle2,
  Circle,
  MinusCircle,
  Calendar,
  Package,
  Play,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Release, ReleaseTemplate, ReleaseTaskInstance, ActionType, TaskInstanceStatus } from "@/lib/releases/types";

const ACTION_LABELS: Record<ActionType, string> = {
  manual: "Manual",
  google_task: "Google Task",
  calendar_event: "Calendar",
  slack_message: "Slack",
};

function StatusIcon({ status }: { status: TaskInstanceStatus }) {
  if (status === "done") return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />;
  if (status === "skipped") return <MinusCircle className="h-4 w-4 text-muted-foreground shrink-0" />;
  return <Circle className="h-4 w-4 text-muted-foreground shrink-0" />;
}

function DueDateChip({ dueDate }: { dueDate: string | null }) {
  if (!dueDate) return <span className="text-xs text-muted-foreground/50">No date</span>;

  const today = new Date().toISOString().slice(0, 10);
  const isOverdue = dueDate < today;
  const isToday = dueDate === today;

  return (
    <span
      className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded font-mono ${
        isOverdue
          ? "bg-red-500/10 text-red-600 dark:text-red-400"
          : isToday
          ? "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400"
          : "bg-muted text-muted-foreground"
      }`}
    >
      <Calendar className="h-3 w-3" />
      {dueDate}
    </span>
  );
}

export default function ReleasePage() {
  const { id } = useParams<{ id: string }>();
  const [release, setRelease] = useState<Release | null>(null);
  const [matchedTemplate, setMatchedTemplate] = useState<ReleaseTemplate | null>(null);
  const [instances, setInstances] = useState<ReleaseTaskInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [dispatchingId, setDispatchingId] = useState<string | null>(null);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/releases/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setRelease(data.release);
        setMatchedTemplate(data.matchedTemplate);
        setInstances(data.taskInstances ?? []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const handleStatusCycle = async (instance: ReleaseTaskInstance) => {
    const next: TaskInstanceStatus =
      instance.status === "pending" ? "done" :
      instance.status === "done" ? "skipped" : "pending";

    setInstances((prev) =>
      prev.map((i) => (i.id === instance.id ? { ...i, status: next } : i))
    );

    await fetch(`/api/releases/${id}/tasks/${instance.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    }).catch(() => {
      // Revert on error
      setInstances((prev) =>
        prev.map((i) => (i.id === instance.id ? { ...i, status: instance.status } : i))
      );
    });
  };

  const handleDispatch = async (instance: ReleaseTaskInstance) => {
    setDispatchingId(instance.id);
    setDispatchError(null);
    try {
      const res = await fetch(`/api/releases/${id}/tasks/${instance.id}/dispatch`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok) {
        setInstances((prev) =>
          prev.map((i) => (i.id === instance.id ? { ...i, status: "done" } : i))
        );
      } else {
        setDispatchError(data.error || "Dispatch failed");
      }
    } catch (e) {
      setDispatchError((e as Error).message);
    } finally {
      setDispatchingId(null);
    }
  };

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      const res = await fetch(`/api/releases/${id}/tasks`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setInstances(data.taskInstances ?? []);
      } else {
        alert(data.error || "Failed to regenerate tasks");
      }
    } finally {
      setRegenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !release) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-sm text-destructive">{error ?? "Release not found"}</p>
      </div>
    );
  }

  const done = instances.filter((i) => i.status === "done").length;
  const total = instances.length;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="flex items-center justify-between h-11 px-4">
          <div className="flex items-center gap-2">
            <Link
              href="/releases"
              className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </Link>
            <h1 className="text-sm font-semibold tracking-tight font-mono">{release.name}</h1>
          </div>
          {matchedTemplate && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1.5 text-muted-foreground"
              onClick={handleRegenerate}
              disabled={regenerating}
            >
              {regenerating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Regenerate tasks
            </Button>
          )}
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        {/* Release meta */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              {release.releaseDate && (
                <span className="text-sm text-muted-foreground flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" />
                  {release.releaseDate}
                </span>
              )}
              {release.released && <Badge variant="secondary" className="text-xs">Released</Badge>}
              {release.archived && <Badge variant="outline" className="text-xs">Archived</Badge>}
            </div>
            {release.description && (
              <p className="text-sm text-muted-foreground">{release.description}</p>
            )}
          </div>
        </div>

        {/* Template match */}
        <div className="flex items-center gap-2">
          <Package className="h-3.5 w-3.5 text-muted-foreground" />
          {matchedTemplate ? (
            <span className="text-sm">
              Template:{" "}
              <Link
                href={`/releases/templates/${matchedTemplate.id}`}
                className="font-medium hover:underline"
              >
                {matchedTemplate.name}
              </Link>
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">
              No template matched —{" "}
              <Link href="/releases/templates" className="hover:underline">
                manage templates
              </Link>
            </span>
          )}
        </div>

        {/* Tasks */}
        {dispatchError && (
          <p className="text-xs text-destructive">{dispatchError}</p>
        )}

        {instances.length > 0 ? (
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Checklist
              </h2>
              <span className="text-xs text-muted-foreground tabular-nums">
                {done}/{total} done
              </span>
            </div>
            <div className="rounded-lg border divide-y">
              {instances.map((instance) => (
                <div
                  key={instance.id}
                  className="flex items-center gap-3 px-4 py-3"
                >
                  <button
                    onClick={() => handleStatusCycle(instance)}
                    className="shrink-0"
                    title="Click to cycle status"
                  >
                    <StatusIcon status={instance.status} />
                  </button>
                  <div className="flex-1 min-w-0">
                    <p
                      className={`text-sm ${
                        instance.status === "done"
                          ? "line-through text-muted-foreground"
                          : instance.status === "skipped"
                          ? "text-muted-foreground"
                          : ""
                      }`}
                    >
                      {instance.label}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {ACTION_LABELS[instance.actionType]}
                      {instance.dayOffset !== 0 && (
                        <span className="ml-1 opacity-60">
                          ({instance.dayOffset > 0 ? "+" : ""}{instance.dayOffset}d)
                        </span>
                      )}
                    </p>
                  </div>
                  <DueDateChip dueDate={instance.dueDate} />
                  {(instance.actionType === "google_task" ||
                    instance.actionType === "calendar_event") &&
                    instance.status === "pending" && (
                      <button
                        onClick={() => handleDispatch(instance)}
                        disabled={dispatchingId === instance.id}
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 shrink-0 pl-1"
                        title={
                          instance.actionType === "google_task"
                            ? "Create Google Task"
                            : "Create Calendar Event"
                        }
                      >
                        {dispatchingId === instance.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Play className="h-3.5 w-3.5" />
                        )}
                      </button>
                    )}
                </div>
              ))}
            </div>
            <p className="text-xxs text-muted-foreground">
              Click the status icon to cycle: pending → done → skipped.
              Click <Play className="inline h-3 w-3" /> to create the Google Task or Calendar event.
            </p>
          </section>
        ) : matchedTemplate ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
            <p className="text-sm">No tasks generated yet.</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 h-7 text-xs"
              onClick={handleRegenerate}
              disabled={regenerating}
            >
              {regenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              Generate from template
            </Button>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
            <p className="text-sm">No tasks — create a template that matches this release.</p>
            <Link href="/releases/templates">
              <Button variant="outline" size="sm" className="mt-3 h-7 text-xs">
                Manage Templates
              </Button>
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
