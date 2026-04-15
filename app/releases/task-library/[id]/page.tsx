"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Loader2,
  Save,
  Trash2,
  Lock,
  Unlock,
  AlertTriangle,
} from "lucide-react";
import { AppShell } from "@/components/app-shell/AppShell";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  GoogleTasksIcon,
  GoogleCalendarIcon,
} from "@/components/releases/GoogleIcons";
import {
  MergeFieldPicker,
  insertTokenAt,
} from "@/components/releases/MergeFieldPicker";
import {
  buildSampleMergeContext,
  renderMergeFields,
} from "@/lib/releases/merge-fields";
import { sanitizeCalendarHtml } from "@/lib/releases/html-sanitize";
import { cn } from "@/lib/utils";
import type {
  ConfigurableField,
  TaskDefinition,
} from "@/lib/releases/types";
import type { TaskList, CalendarListEntry } from "@/lib/google/client";

const INPUT_CLASS =
  "h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const TEXTAREA_CLASS =
  "w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 resize-y";
const SELECT_CLASS =
  "h-9 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function LockToggle({
  configurable,
  onToggle,
}: {
  configurable: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={
        configurable
          ? "Configurable — use-sites can override this field"
          : "Locked — use-sites must use the definition value"
      }
      className={cn(
        "inline-flex items-center gap-1 h-6 px-1.5 rounded text-xxs transition-colors shrink-0",
        configurable
          ? "bg-primary/10 text-primary hover:bg-primary/20"
          : "bg-muted text-muted-foreground hover:bg-muted/70",
      )}
    >
      {configurable ? (
        <Unlock className="h-3 w-3" />
      ) : (
        <Lock className="h-3 w-3" />
      )}
      {configurable ? "Configurable" : "Locked"}
    </button>
  );
}

export default function TaskDefinitionEditPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [def, setDef] = useState<TaskDefinition | null>(null);
  const [usageCount, setUsageCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [taskLists, setTaskLists] = useState<TaskList[]>([]);
  const [calendars, setCalendars] = useState<CalendarListEntry[]>([]);

  const labelRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(() => {
    fetch(`/api/releases/task-definitions/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setDef(data.definition ?? null);
        setUsageCount(data.usageCount ?? 0);
      })
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    Promise.all([
      fetch("/api/google/task-lists").then(async (r) => ({ r, d: await r.json() })),
      fetch("/api/google/calendars").then(async (r) => ({ r, d: await r.json() })),
    ])
      .then(([tl, cal]) => {
        if (tl.r.ok && tl.d.taskLists) setTaskLists(tl.d.taskLists);
        if (cal.r.ok && cal.d.calendars) setCalendars(cal.d.calendars);
      })
      .catch(() => {});
  }, []);

  // Clear the "Saved" confirmation if the user touches anything.
  useEffect(() => {
    if (saved) setSaved(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def]);

  const update = <K extends keyof TaskDefinition>(
    key: K,
    value: TaskDefinition[K],
  ) => {
    setDef((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const toggleConfigurable = (field: ConfigurableField) => {
    setDef((prev) => {
      if (!prev) return prev;
      const set = new Set(prev.configurableFields);
      if (set.has(field)) set.delete(field);
      else set.add(field);
      return { ...prev, configurableFields: Array.from(set) };
    });
  };

  const handleSave = async () => {
    if (!def) return;
    setSaving(true);
    const res = await fetch(`/api/releases/task-definitions/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: def.name.trim(),
        label: def.label,
        description: def.description?.trim() || null,
        actionType: def.actionType,
        dayOffset: def.dayOffset,
        allDay: def.allDay,
        startTime: def.allDay ? null : def.startTime || null,
        durationMinutes: def.durationMinutes,
        actionConfig: def.actionConfig,
        configurableFields: def.configurableFields,
      }),
    });
    setSaving(false);
    if (res.ok) setSaved(true);
  };

  const handleDelete = async (detachLinked: boolean) => {
    setDeleting(true);
    setDeleteError(null);
    const url = detachLinked
      ? `/api/releases/task-definitions/${id}?detachLinked=1`
      : `/api/releases/task-definitions/${id}`;
    const res = await fetch(url, { method: "DELETE" });
    if (res.ok) {
      router.push("/releases/task-library");
    } else {
      const data = await res.json().catch(() => ({}));
      setDeleteError(data.error ?? "Delete failed");
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <AppShell title="Task Definition">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </AppShell>
    );
  }

  if (!def) {
    return (
      <AppShell title="Task Definition">
        <div className="flex items-center justify-center py-20">
          <p className="text-sm text-destructive">Definition not found.</p>
        </div>
      </AppShell>
    );
  }

  const configurable = new Set(def.configurableFields);
  const canOverride = (f: ConfigurableField) => configurable.has(f);

  const insertToLabel = (token: string) => {
    if (!def) return;
    const { nextValue, restoreCaret } = insertTokenAt(
      labelRef.current,
      def.label,
      token,
    );
    update("label", nextValue);
    restoreCaret();
  };
  const insertToDesc = (token: string) => {
    if (!def) return;
    const { nextValue, restoreCaret } = insertTokenAt(
      descRef.current,
      def.description ?? "",
      token,
    );
    update("description", nextValue || null);
    restoreCaret();
  };

  const sampleCtx = buildSampleMergeContext({ dayOffset: def.dayOffset });
  const labelPreview = def.label.includes("{{")
    ? renderMergeFields(def.label, sampleCtx) ?? ""
    : "";
  const descPreview = def.description?.includes("{{")
    ? renderMergeFields(def.description, sampleCtx) ?? ""
    : "";
  const isCalendarEvent = def.actionType === "calendar_event";

  const actions = (
    <div className="ml-auto flex items-center gap-2">
      {saved && (
        <span className="text-xs text-green-600 dark:text-green-500">Saved</span>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="h-7 text-xs gap-1.5 text-red-700 dark:text-red-400 hover:bg-red-500/10"
        onClick={() => setDeleteOpen(true)}
      >
        <Trash2 className="h-3.5 w-3.5" />
        Delete
      </Button>
      <Button
        size="sm"
        className="h-7 text-xs gap-1.5"
        onClick={handleSave}
        disabled={saving || !def.name.trim()}
      >
        {saving ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Save className="h-3.5 w-3.5" />
        )}
        Save
      </Button>
    </div>
  );

  return (
    <AppShell
      title="Task Definition"
      subtitle={def.name}
      actions={actions}
    >
      <main className="max-w-3xl mx-auto px-6 py-6 space-y-6">
        {usageCount > 0 && (
          <div className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            Used by{" "}
            <span className="font-medium text-foreground tabular-nums">{usageCount}</span>{" "}
            template task{usageCount === 1 ? "" : "s"}. Changes here flow to future
            releases only — past release instances are snapshots.
          </div>
        )}

        {/* Library identity */}
        <section className="space-y-1.5">
          <Label className="text-xs">Library name</Label>
          <input
            value={def.name}
            onChange={(e) => update("name", e.target.value)}
            placeholder="e.g. Deploy calendar event"
            className={INPUT_CLASS}
          />
          <p className="text-xxs text-muted-foreground">
            Shown when linking template tasks to this definition.
          </p>
        </section>

        {/* Action type — always locked */}
        <section className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Action type</Label>
            <span className="inline-flex items-center gap-1 h-6 px-1.5 rounded text-xxs bg-muted text-muted-foreground">
              <Lock className="h-3 w-3" />
              Always locked
            </span>
          </div>
          <div className="inline-flex rounded-lg bg-muted p-0.5 gap-0.5">
            <button
              type="button"
              onClick={() => update("actionType", "google_task")}
              className={cn(
                "inline-flex items-center gap-2 h-9 px-3 text-sm transition-all rounded-md",
                def.actionType === "google_task"
                  ? "bg-background text-foreground shadow-sm"
                  : "bg-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <GoogleTasksIcon
                className={cn(
                  "h-4 w-4 rounded",
                  def.actionType !== "google_task" && "grayscale opacity-50",
                )}
              />
              Task
            </button>
            <button
              type="button"
              onClick={() => update("actionType", "calendar_event")}
              className={cn(
                "inline-flex items-center gap-2 h-9 px-3 text-sm transition-all rounded-md",
                def.actionType === "calendar_event"
                  ? "bg-background text-foreground shadow-sm"
                  : "bg-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <GoogleCalendarIcon
                className={cn(
                  "h-4 w-4",
                  def.actionType !== "calendar_event" && "grayscale opacity-50",
                )}
              />
              Calendar
            </button>
          </div>
        </section>

        {/* Configurable fields */}
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Fields
          </h2>
          <p className="text-xxs text-muted-foreground -mt-1">
            Toggle each field between{" "}
            <span className="font-medium">Locked</span> (use-sites must use the
            definition value) and{" "}
            <span className="font-medium">Configurable</span> (use-sites can
            override with per-template values).
          </p>

          {/* Title (label) */}
          <FieldRow
            label="Title"
            hint="Task/event title. Supports merge fields like {{release.name}}."
            configurable={canOverride("label")}
            onToggle={() => toggleConfigurable("label")}
          >
            <div className="flex items-center gap-1.5">
              <input
                ref={labelRef}
                value={def.label}
                onChange={(e) => update("label", e.target.value)}
                className={INPUT_CLASS}
              />
              <MergeFieldPicker onInsert={insertToLabel} />
            </div>
            {labelPreview && (
              <div className="text-xxs text-muted-foreground truncate mt-1.5">
                <span className="opacity-70">Preview:</span>{" "}
                <span className="text-foreground/80">{labelPreview}</span>
              </div>
            )}
          </FieldRow>

          {/* Notes (description) */}
          <FieldRow
            label="Notes"
            hint="Event description or task notes."
            configurable={canOverride("description")}
            onToggle={() => toggleConfigurable("description")}
          >
            <div className="flex items-start gap-1.5">
              <textarea
                ref={descRef}
                value={def.description ?? ""}
                onChange={(e) =>
                  update("description", e.target.value || null)
                }
                rows={3}
                className={TEXTAREA_CLASS}
              />
              <MergeFieldPicker onInsert={insertToDesc} />
            </div>
            {descPreview && (
              <div className="rounded-md border border-dashed bg-muted/30 px-2.5 py-1.5 text-xxs mt-1.5">
                <div className="uppercase tracking-wide text-muted-foreground/80 mb-0.5">
                  Preview — sample release
                </div>
                {isCalendarEvent ? (
                  <div
                    className="whitespace-pre-wrap break-words text-foreground/80 [&_a]:underline [&_a]:text-primary"
                    dangerouslySetInnerHTML={{
                      __html: sanitizeCalendarHtml(descPreview),
                    }}
                  />
                ) : (
                  <div className="whitespace-pre-wrap break-words text-foreground/80">
                    {descPreview}
                  </div>
                )}
              </div>
            )}
          </FieldRow>

          {/* Day offset */}
          <FieldRow
            label="Day offset"
            hint="Days relative to release date. Negative = before."
            configurable={canOverride("dayOffset")}
            onToggle={() => toggleConfigurable("dayOffset")}
          >
            <input
              type="number"
              value={def.dayOffset}
              onChange={(e) =>
                update("dayOffset", parseInt(e.target.value, 10) || 0)
              }
              className={cn(INPUT_CLASS, "w-24 font-mono")}
            />
          </FieldRow>

          {def.actionType === "calendar_event" && (
            <>
              <FieldRow
                label="All-day"
                hint="All-day event vs. timed."
                configurable={canOverride("allDay")}
                onToggle={() => toggleConfigurable("allDay")}
              >
                <div className="inline-flex rounded-lg bg-muted p-0.5 gap-0.5">
                  <button
                    type="button"
                    onClick={() => update("allDay", true)}
                    className={cn(
                      "h-8 px-3 text-xs transition-all rounded-md",
                      def.allDay
                        ? "bg-background text-foreground font-medium shadow-sm"
                        : "bg-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    All day
                  </button>
                  <button
                    type="button"
                    onClick={() => update("allDay", false)}
                    className={cn(
                      "h-8 px-3 text-xs transition-all rounded-md",
                      !def.allDay
                        ? "bg-background text-foreground font-medium shadow-sm"
                        : "bg-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    At time
                  </button>
                </div>
              </FieldRow>

              {!def.allDay && (
                <>
                  <FieldRow
                    label="Start time"
                    hint="Event start time (uses the standup timezone)."
                    configurable={canOverride("startTime")}
                    onToggle={() => toggleConfigurable("startTime")}
                  >
                    <input
                      type="time"
                      value={def.startTime ?? "09:00"}
                      onChange={(e) => update("startTime", e.target.value)}
                      className={cn(INPUT_CLASS, "w-32 font-mono")}
                    />
                  </FieldRow>

                  <FieldRow
                    label="Duration"
                    hint="Event length in minutes."
                    configurable={canOverride("durationMinutes")}
                    onToggle={() => toggleConfigurable("durationMinutes")}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={5}
                        max={480}
                        step={5}
                        value={def.durationMinutes}
                        onChange={(e) =>
                          update(
                            "durationMinutes",
                            parseInt(e.target.value, 10) || 30,
                          )
                        }
                        className={cn(INPUT_CLASS, "w-20 font-mono")}
                      />
                      <span className="text-xs text-muted-foreground">min</span>
                    </div>
                  </FieldRow>
                </>
              )}
            </>
          )}

          <FieldRow
            label={isCalendarEvent ? "Calendar" : "Task list"}
            hint={
              isCalendarEvent
                ? "Target calendar for the event."
                : "Target task list for the Google Task."
            }
            configurable={canOverride("actionConfig")}
            onToggle={() => toggleConfigurable("actionConfig")}
          >
            {isCalendarEvent ? (
              calendars.length > 0 ? (
                <select
                  value={
                    (def.actionConfig?.calendarId as string | undefined) ??
                    "primary"
                  }
                  onChange={(e) =>
                    update("actionConfig", { calendarId: e.target.value })
                  }
                  className={cn(SELECT_CLASS, "w-full max-w-sm")}
                >
                  <option value="primary">Primary calendar</option>
                  {calendars.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.summary}
                      {c.primary ? " (primary)" : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={
                    (def.actionConfig?.calendarId as string | undefined) ??
                    "primary"
                  }
                  onChange={(e) =>
                    update("actionConfig", { calendarId: e.target.value })
                  }
                  placeholder="primary"
                  className={cn(INPUT_CLASS, "font-mono max-w-sm")}
                />
              )
            ) : taskLists.length > 0 ? (
              <select
                value={
                  (def.actionConfig?.taskListId as string | undefined) ??
                  "@default"
                }
                onChange={(e) =>
                  update("actionConfig", { taskListId: e.target.value })
                }
                className={cn(SELECT_CLASS, "w-full max-w-sm")}
              >
                <option value="@default">Default task list</option>
                {taskLists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.title}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={
                  (def.actionConfig?.taskListId as string | undefined) ??
                  "@default"
                }
                onChange={(e) =>
                  update("actionConfig", { taskListId: e.target.value })
                }
                placeholder="@default"
                className={cn(INPUT_CLASS, "font-mono max-w-sm")}
              />
            )}
          </FieldRow>
        </section>
      </main>

      {/* Delete confirm — handles "in use" case by offering detach-linked */}
      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open);
          if (!open) setDeleteError(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete definition?</DialogTitle>
            <DialogDescription>
              {usageCount === 0 ? (
                <>
                  No template tasks link to this definition — safe to delete.
                </>
              ) : (
                <>
                  <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="h-3 w-3" />
                    {usageCount} template task{usageCount === 1 ? "" : "s"} still
                    link to this definition.
                  </span>
                  <br />
                  Detaching will unlink them — they become inline tasks using
                  whatever values were last saved on the template row. Future
                  library edits won&apos;t reach them.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <p className="text-xs text-destructive">{deleteError}</p>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDeleteOpen(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => handleDelete(usageCount > 0)}
              disabled={deleting}
            >
              {deleting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              )}
              {usageCount > 0 ? "Detach & delete" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function FieldRow({
  label,
  hint,
  configurable,
  onToggle,
  children,
}: {
  label: string;
  hint: string;
  configurable: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <Label className="text-xs font-medium">{label}</Label>
          <p className="text-xxs text-muted-foreground mt-0.5">{hint}</p>
        </div>
        <LockToggle configurable={configurable} onToggle={onToggle} />
      </div>
      <div>{children}</div>
    </div>
  );
}
