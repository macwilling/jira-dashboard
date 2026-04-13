"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Loader2,
  Plus,
  Trash2,
  Save,
  GripVertical,
  Copy,
  AlertTriangle,
  Info,
} from "lucide-react";
import { AppShell } from "@/components/app-shell/AppShell";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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
  MergeFieldPicker,
  insertTokenAt,
} from "@/components/releases/MergeFieldPicker";
import { cn } from "@/lib/utils";
import type {
  ActionType,
  ReleaseTemplate,
  ReleaseTemplateTask,
  ReleaseType,
} from "@/lib/releases/types";
import type { TaskList, CalendarListEntry } from "@/lib/google/client";

// Slack dispatch isn't implemented yet. We keep it in the type union but
// hide it from the picker so users can't create new slack rows. Existing
// rows with slack_message still render and display a "not yet supported" hint.
const ACTION_PICKER_TYPES: ActionType[] = ["manual", "google_task", "calendar_event"];
const ACTION_LABELS: Record<ActionType, string> = {
  manual: "Manual",
  google_task: "Google Task",
  calendar_event: "Calendar Event",
  slack_message: "Slack (coming soon)",
};
const RELEASE_TYPES: Array<{ value: ReleaseType | ""; label: string }> = [
  { value: "", label: "Any" },
  { value: "major", label: "Major (x.0.0)" },
  { value: "minor", label: "Minor (x.y.0)" },
  { value: "patch", label: "Patch (x.y.z)" },
];

const INPUT_CLASS =
  "h-8 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";
const TEXTAREA_CLASS =
  "w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 resize-y";
const SELECT_CLASS =
  "h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function relativeDayLabel(offset: number): string {
  if (offset === 0) return "release day";
  if (offset === -1) return "1 day before release";
  if (offset === 1) return "1 day after release";
  if (offset < 0) return `${Math.abs(offset)} days before release`;
  return `${offset} days after release`;
}

interface DraftTask {
  _key: string;
  label: string;
  description: string;
  actionType: ActionType;
  dayOffset: number;
  allDay: boolean;
  startTime: string;    // "HH:MM" — empty when allDay
  durationMinutes: number;
  taskListId: string;   // for google_task
  calendarId: string;   // for calendar_event
}

let keyCounter = 0;
function newKey() {
  return `task-${++keyCounter}-${Date.now()}`;
}

function taskToRow(t: ReleaseTemplateTask): DraftTask {
  const config = t.actionConfig ?? {};
  return {
    _key: newKey(),
    label: t.label,
    description: t.description ?? "",
    actionType: t.actionType,
    dayOffset: t.dayOffset,
    allDay: t.allDay,
    startTime: t.startTime ?? "",
    durationMinutes: t.durationMinutes,
    taskListId: (config.taskListId as string | undefined) ?? "@default",
    calendarId: (config.calendarId as string | undefined) ?? "primary",
  };
}

function freshTask(): DraftTask {
  return {
    _key: newKey(),
    label: "",
    description: "",
    actionType: "manual",
    dayOffset: 0,
    allDay: true,
    startTime: "09:00",
    durationMinutes: 30,
    taskListId: "@default",
    calendarId: "primary",
  };
}

function SortableTaskRow({
  task,
  onChange,
  onDuplicate,
  onDelete,
  taskLists,
  calendars,
}: {
  task: DraftTask;
  onChange: (updated: DraftTask) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  taskLists: TaskList[];
  calendars: CalendarListEntry[];
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task._key });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const labelRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);

  const insertToLabel = (token: string) => {
    const { nextValue, restoreCaret } = insertTokenAt(labelRef.current, task.label, token);
    onChange({ ...task, label: nextValue });
    restoreCaret();
  };
  const insertToDesc = (token: string) => {
    const { nextValue, restoreCaret } = insertTokenAt(descRef.current, task.description, token);
    onChange({ ...task, description: nextValue });
    restoreCaret();
  };

  const isGoogleTask = task.actionType === "google_task";
  const isCalendarEvent = task.actionType === "calendar_event";
  const isSlack = task.actionType === "slack_message";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="py-3 px-3 bg-background hover:bg-muted/20 transition-colors"
    >
      {/* Summary row */}
      <div className="flex items-start gap-2">
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground shrink-0 touch-none mt-1.5"
          aria-label="Drag to reorder"
          type="button"
        >
          <GripVertical className="h-4 w-4" />
        </button>

        <div className="flex-1 min-w-0 space-y-0.5">
          <div className="flex items-center gap-1.5">
            <input
              ref={labelRef}
              value={task.label}
              onChange={(e) => onChange({ ...task, label: e.target.value })}
              placeholder="Task label"
              className={INPUT_CLASS}
            />
            <MergeFieldPicker onInsert={insertToLabel} />
          </div>
        </div>

        <select
          value={task.actionType}
          onChange={(e) =>
            onChange({ ...task, actionType: e.target.value as ActionType })
          }
          className={cn(SELECT_CLASS, "w-40 shrink-0 mt-0")}
        >
          {ACTION_PICKER_TYPES.map((t) => (
            <option key={t} value={t}>{ACTION_LABELS[t]}</option>
          ))}
          {/* Only show slack_message if the existing task already has it */}
          {isSlack && <option value="slack_message">{ACTION_LABELS.slack_message}</option>}
        </select>

        <div className="flex flex-col items-start gap-0.5 shrink-0 mt-0 w-24">
          <div className="flex items-center gap-1">
            <input
              type="number"
              value={task.dayOffset}
              onChange={(e) =>
                onChange({ ...task, dayOffset: parseInt(e.target.value, 10) || 0 })
              }
              className={cn(INPUT_CLASS, "w-16 font-mono text-xs h-8")}
              title="Days offset from release date (negative = before)"
            />
            <span className="text-xs text-muted-foreground">d</span>
          </div>
          <span className="text-xxs text-muted-foreground whitespace-nowrap tabular-nums">
            {relativeDayLabel(task.dayOffset)}
          </span>
        </div>

        <div className="flex items-center gap-0.5 shrink-0 mt-1">
          <button
            onClick={onDuplicate}
            className="text-muted-foreground hover:text-foreground h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-muted transition-colors"
            aria-label="Duplicate task"
            title="Duplicate task"
            type="button"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onDelete}
            className="text-muted-foreground hover:text-destructive h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-destructive/10 transition-colors"
            aria-label="Delete task"
            title="Delete task"
            type="button"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Details — indented under the handle */}
      <div className="pl-6 pt-2.5 space-y-3">
        {/* Description */}
        <div className="space-y-1">
          <Label className="text-xxs uppercase tracking-wide text-muted-foreground">
            Description
          </Label>
          <div className="flex items-start gap-1.5">
            <textarea
              ref={descRef}
              value={task.description}
              onChange={(e) => onChange({ ...task, description: e.target.value })}
              placeholder={
                isGoogleTask
                  ? "Notes shown on the Google Task…"
                  : isCalendarEvent
                  ? "Details shown on the calendar event…"
                  : "Checklist note for yourself…"
              }
              rows={2}
              className={TEXTAREA_CLASS}
            />
            <MergeFieldPicker onInsert={insertToDesc} />
          </div>
        </div>

        {/* Action config */}
        <div className="space-y-1.5">
          <Label className="text-xxs uppercase tracking-wide text-muted-foreground">
            Action config
          </Label>
          <div className="rounded-md border bg-muted/20 px-3 py-2 min-h-[44px]">
            {task.actionType === "manual" && (
              <p className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
                <Info className="h-3 w-3" />
                Manual task — no auto-dispatch. You&apos;ll check it off yourself.
              </p>
            )}

            {isGoogleTask && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-20 shrink-0">Task list</span>
                  {taskLists.length > 0 ? (
                    <select
                      value={task.taskListId}
                      onChange={(e) => onChange({ ...task, taskListId: e.target.value })}
                      className={cn(SELECT_CLASS, "flex-1 max-w-sm h-7")}
                    >
                      <option value="@default">Default task list</option>
                      {taskLists.map((l) => (
                        <option key={l.id} value={l.id}>{l.title}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={task.taskListId}
                      onChange={(e) => onChange({ ...task, taskListId: e.target.value })}
                      placeholder="@default"
                      className={cn(INPUT_CLASS, "h-7 font-mono text-xs flex-1 max-w-sm")}
                    />
                  )}
                </div>
                <p className="text-xxs text-muted-foreground pl-[calc(5rem+0.5rem)]">
                  Tasks are date-only — the Google Tasks API discards time. Use a
                  Calendar Event if you need a specific time.
                </p>
              </div>
            )}

            {isCalendarEvent && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-20 shrink-0">Calendar</span>
                  {calendars.length > 0 ? (
                    <select
                      value={task.calendarId}
                      onChange={(e) => onChange({ ...task, calendarId: e.target.value })}
                      className={cn(SELECT_CLASS, "flex-1 max-w-sm h-7")}
                    >
                      <option value="primary">Primary calendar</option>
                      {calendars.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.summary}{c.primary ? " (primary)" : ""}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={task.calendarId}
                      onChange={(e) => onChange({ ...task, calendarId: e.target.value })}
                      placeholder="primary"
                      className={cn(INPUT_CLASS, "h-7 font-mono text-xs flex-1 max-w-sm")}
                    />
                  )}
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-muted-foreground w-20 shrink-0">When</span>
                  <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
                    <input
                      type="radio"
                      checked={task.allDay}
                      onChange={() => onChange({ ...task, allDay: true })}
                    />
                    All day
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
                    <input
                      type="radio"
                      checked={!task.allDay}
                      onChange={() => onChange({ ...task, allDay: false })}
                    />
                    At
                  </label>
                  <input
                    type="time"
                    value={task.startTime || "09:00"}
                    onChange={(e) => onChange({ ...task, startTime: e.target.value })}
                    disabled={task.allDay}
                    className={cn(INPUT_CLASS, "h-7 w-28 text-xs font-mono")}
                  />
                  <span className="text-xs text-muted-foreground">for</span>
                  <input
                    type="number"
                    min="5"
                    max="480"
                    step="5"
                    value={task.durationMinutes}
                    onChange={(e) =>
                      onChange({ ...task, durationMinutes: parseInt(e.target.value, 10) || 30 })
                    }
                    disabled={task.allDay}
                    className={cn(INPUT_CLASS, "h-7 w-16 text-xs font-mono")}
                  />
                  <span className="text-xs text-muted-foreground">min</span>
                </div>
                {!task.allDay && (
                  <p className="text-xxs text-muted-foreground pl-[calc(5rem+0.5rem)]">
                    Uses the standup timezone from Settings.
                  </p>
                )}
              </div>
            )}

            {isSlack && (
              <p className="text-xs text-amber-700 dark:text-amber-400 inline-flex items-center gap-1.5">
                <AlertTriangle className="h-3 w-3" />
                Slack dispatch is not yet implemented — this row won&apos;t auto-dispatch.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TemplateEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [template, setTemplate] = useState<ReleaseTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  const [name, setName] = useState("");
  const [platformPrefix, setPlatformPrefix] = useState("");
  const [releaseType, setReleaseType] = useState<ReleaseType | "">("");
  const [tasks, setTasks] = useState<DraftTask[]>([]);

  const [taskLists, setTaskLists] = useState<TaskList[]>([]);
  const [calendars, setCalendars] = useState<CalendarListEntry[]>([]);
  const [googleError, setGoogleError] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    fetch(`/api/releases/templates/${id}`)
      .then((r) => r.json())
      .then((data) => {
        const t: ReleaseTemplate = data.template;
        setTemplate(t);
        setName(t.name);
        setPlatformPrefix(t.platformPrefix ?? "");
        setReleaseType(t.releaseType ?? "");
        setTasks((data.tasks ?? []).map(taskToRow));
      })
      .finally(() => setLoading(false));

    Promise.all([
      fetch("/api/google/task-lists").then(async (r) => ({ r, d: await r.json() })),
      fetch("/api/google/calendars").then(async (r) => ({ r, d: await r.json() })),
    ])
      .then(([tl, cal]) => {
        if (tl.r.ok && tl.d.taskLists) setTaskLists(tl.d.taskLists);
        if (cal.r.ok && cal.d.calendars) setCalendars(cal.d.calendars);
        const errs = [
          !tl.r.ok ? `task lists: ${tl.d.error ?? tl.r.status}` : null,
          !cal.r.ok ? `calendars: ${cal.d.error ?? cal.r.status}` : null,
        ].filter(Boolean);
        if (errs.length) setGoogleError(errs.join(" · "));
      })
      .catch((e) => setGoogleError((e as Error).message));
  }, [id]);

  // Clear the "Saved" confirmation if the user touches anything.
  useEffect(() => {
    if (saved) setSaved(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, platformPrefix, releaseType, tasks]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setTasks((prev) => {
      const oldIdx = prev.findIndex((t) => t._key === active.id);
      const newIdx = prev.findIndex((t) => t._key === over.id);
      return arrayMove(prev, oldIdx, newIdx);
    });
  }, []);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setSaved(false);
    const res = await fetch(`/api/releases/templates/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        platformPrefix: platformPrefix.trim() || null,
        releaseType: releaseType || null,
        tasks: tasks.map((t) => ({
          label: t.label,
          description: t.description.trim() || null,
          actionType: t.actionType,
          dayOffset: t.dayOffset,
          allDay: t.allDay,
          startTime: t.allDay ? null : (t.startTime || null),
          durationMinutes: t.durationMinutes,
          actionConfig:
            t.actionType === "google_task"
              ? { taskListId: t.taskListId || "@default" }
              : t.actionType === "calendar_event"
              ? { calendarId: t.calendarId || "primary" }
              : null,
        })),
      }),
    });
    setSaving(false);
    if (res.ok) setSaved(true);
  };

  const handleDelete = async () => {
    setDeleting(true);
    await fetch(`/api/releases/templates/${id}`, { method: "DELETE" });
    router.push("/releases/templates");
  };

  const handleDuplicate = (key: string) => {
    setTasks((prev) => {
      const idx = prev.findIndex((t) => t._key === key);
      if (idx < 0) return prev;
      const orig = prev[idx];
      const copy: DraftTask = { ...orig, _key: newKey(), label: orig.label ? `${orig.label} (copy)` : "" };
      return [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)];
    });
  };

  if (loading) {
    return (
      <AppShell title="Edit Template">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </AppShell>
    );
  }

  if (!template) {
    return (
      <AppShell title="Edit Template">
        <div className="flex items-center justify-center py-20">
          <p className="text-sm text-destructive">Template not found.</p>
        </div>
      </AppShell>
    );
  }

  const actions = (
    <div className="ml-auto flex items-center gap-2">
      {saved && <span className="text-xs text-green-600 dark:text-green-500">Saved</span>}
      <Button
        size="sm"
        className="h-7 text-xs gap-1.5"
        onClick={handleSave}
        disabled={saving || !name.trim()}
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
    <AppShell title="Edit Template" subtitle={template.name} actions={actions}>
      <main className="max-w-4xl mx-auto px-6 py-6 space-y-8">
        {/* Template metadata */}
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Template
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="name" className="text-xs">Name</Label>
              <input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="platform" className="text-xs">Platform prefix</Label>
                <input
                  id="platform"
                  value={platformPrefix}
                  onChange={(e) => setPlatformPrefix(e.target.value)}
                  placeholder="web, android (blank = any)"
                  className={cn(INPUT_CLASS, "font-mono text-xs")}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="releaseType" className="text-xs">Release type</Label>
                <select
                  id="releaseType"
                  value={releaseType}
                  onChange={(e) => setReleaseType(e.target.value as ReleaseType | "")}
                  className={cn(SELECT_CLASS, "h-8 w-full text-sm")}
                >
                  {RELEASE_TYPES.map(({ value, label }) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          <p className="text-xxs text-muted-foreground">
            Matches the part before <code className="bg-muted px-1 rounded">@</code> in the version name.
            Release type is derived from semver: x.0.0 = major, x.y.0 = minor, x.y.z = patch.
          </p>
        </section>

        {/* Tasks */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Tasks
              </h2>
              <p className="text-xxs text-muted-foreground mt-0.5">
                Use the <span className="inline-flex items-center gap-0.5 font-medium">⚡ button</span> next to a field to insert merge fields like <code className="bg-muted px-1 rounded">{"{{release.name}}"}</code>.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => setTasks((prev) => [...prev, freshTask()])}
            >
              <Plus className="h-3.5 w-3.5" />
              Add task
            </Button>
          </div>

          {tasks.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center space-y-2">
              <p className="text-sm text-muted-foreground">No tasks yet.</p>
              <p className="text-xxs text-muted-foreground">
                Tasks run in order. Each task gets a due date = release date + day offset.
              </p>
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={tasks.map((t) => t._key)}
                strategy={verticalListSortingStrategy}
              >
                <div className="rounded-lg border divide-y overflow-hidden">
                  {tasks.map((task) => (
                    <SortableTaskRow
                      key={task._key}
                      task={task}
                      taskLists={taskLists}
                      calendars={calendars}
                      onChange={(updated) =>
                        setTasks((prev) =>
                          prev.map((t) => (t._key === updated._key ? updated : t))
                        )
                      }
                      onDuplicate={() => handleDuplicate(task._key)}
                      onDelete={() =>
                        setTasks((prev) => prev.filter((t) => t._key !== task._key))
                      }
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}

          {googleError && (
            <p className="text-xxs text-destructive">
              Google fetch failed — {googleError}. If you recently changed OAuth
              scopes, disconnect and reconnect Google in{" "}
              <Link href="/settings" className="underline">Settings</Link>.
            </p>
          )}
        </section>

        {/* Danger zone */}
        <section className="space-y-3 pt-4 border-t">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Danger zone
          </h2>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs text-destructive border-destructive/40 hover:bg-destructive/10 gap-1.5"
            onClick={() => setDeleteOpen(true)}
            disabled={deleting}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete template
          </Button>
        </section>
      </main>

      {/* Delete confirm */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete template?</DialogTitle>
            <DialogDescription>
              This deletes <span className="font-medium text-foreground">{template.name}</span>{" "}
              and its <span className="font-medium text-foreground">{tasks.length}</span> task definition{tasks.length === 1 ? "" : "s"}.
              Past releases keep the task instances they already have, but new releases
              matching this template will have no checklist.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button
              variant="outline"
              className="text-destructive border-destructive/40 hover:bg-destructive/10"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Delete template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
