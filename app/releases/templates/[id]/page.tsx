"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Loader2,
  Plus,
  Trash2,
  Save,
  GripVertical,
} from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActionType, ReleaseTemplate, ReleaseTemplateTask, ReleaseType } from "@/lib/releases/types";
import type { TaskList, CalendarListEntry } from "@/lib/google/client";

interface DraftTask {
  _key: string;
  label: string;
  actionType: ActionType;
  dayOffset: number;
  taskListId: string;   // for google_task
  calendarId: string;   // for calendar_event
}

const ACTION_TYPES: ActionType[] = ["manual", "google_task", "calendar_event", "slack_message"];
const ACTION_LABELS: Record<ActionType, string> = {
  manual: "Manual",
  google_task: "Google Task",
  calendar_event: "Calendar Event",
  slack_message: "Slack Message",
};
const RELEASE_TYPES: Array<{ value: ReleaseType | ""; label: string }> = [
  { value: "", label: "Any" },
  { value: "major", label: "Major (x.0.0)" },
  { value: "minor", label: "Minor (x.y.0)" },
  { value: "patch", label: "Patch (x.y.z)" },
];

function SortableTaskRow({
  task,
  onChange,
  onDelete,
  taskLists,
  calendars,
}: {
  task: DraftTask;
  onChange: (updated: DraftTask) => void;
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
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="py-2 space-y-1.5">
      {/* Main row */}
      <div className="flex items-center gap-2">
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground shrink-0 touch-none"
          aria-label="Drag to reorder"
        >
          <GripVertical className="h-4 w-4" />
        </button>

        <Input
          value={task.label}
          onChange={(e) => onChange({ ...task, label: e.target.value })}
          placeholder="Task label"
          className="text-xs h-8 flex-1 min-w-0"
        />

        <select
          value={task.actionType}
          onChange={(e) =>
            onChange({ ...task, actionType: e.target.value as ActionType })
          }
          className="text-xs h-8 rounded-md border bg-background px-2 shrink-0 w-36"
        >
          {ACTION_TYPES.map((t) => (
            <option key={t} value={t}>{ACTION_LABELS[t]}</option>
          ))}
        </select>

        <div className="flex items-center gap-1 shrink-0">
          <Input
            type="number"
            value={task.dayOffset}
            onChange={(e) =>
              onChange({ ...task, dayOffset: parseInt(e.target.value, 10) || 0 })
            }
            className="text-xs h-8 w-16 font-mono"
            title="Days offset from release date (negative = before)"
          />
          <span className="text-xs text-muted-foreground">d</span>
        </div>

        <button
          onClick={onDelete}
          className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
          aria-label="Delete task"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Action config row */}
      {task.actionType === "google_task" && (
        <div className="pl-6 flex items-center gap-2">
          <span className="text-xxs text-muted-foreground w-20 shrink-0">Task list</span>
          {taskLists.length > 0 ? (
            <select
              value={task.taskListId}
              onChange={(e) => onChange({ ...task, taskListId: e.target.value })}
              className="text-xs h-7 rounded-md border bg-background px-2 flex-1 max-w-xs"
            >
              <option value="@default">Default task list</option>
              {taskLists.map((l) => (
                <option key={l.id} value={l.id}>{l.title}</option>
              ))}
            </select>
          ) : (
            <Input
              value={task.taskListId}
              onChange={(e) => onChange({ ...task, taskListId: e.target.value })}
              placeholder="@default"
              className="text-xs h-7 font-mono flex-1 max-w-xs"
            />
          )}
        </div>
      )}

      {task.actionType === "calendar_event" && (
        <div className="pl-6 flex items-center gap-2">
          <span className="text-xxs text-muted-foreground w-20 shrink-0">Calendar</span>
          {calendars.length > 0 ? (
            <select
              value={task.calendarId}
              onChange={(e) => onChange({ ...task, calendarId: e.target.value })}
              className="text-xs h-7 rounded-md border bg-background px-2 flex-1 max-w-xs"
            >
              <option value="primary">Primary calendar</option>
              {calendars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.summary}{c.primary ? " (primary)" : ""}
                </option>
              ))}
            </select>
          ) : (
            <Input
              value={task.calendarId}
              onChange={(e) => onChange({ ...task, calendarId: e.target.value })}
              placeholder="primary"
              className="text-xs h-7 font-mono flex-1 max-w-xs"
            />
          )}
        </div>
      )}
    </div>
  );
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
    actionType: t.actionType,
    dayOffset: t.dayOffset,
    taskListId: (config.taskListId as string | undefined) ?? "@default",
    calendarId: (config.calendarId as string | undefined) ?? "primary",
  };
}

export default function TemplateEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [template, setTemplate] = useState<ReleaseTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saved, setSaved] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [platformPrefix, setPlatformPrefix] = useState("");
  const [releaseType, setReleaseType] = useState<ReleaseType | "">("");
  const [tasks, setTasks] = useState<DraftTask[]>([]);

  // Google data (loaded if connected)
  const [taskLists, setTaskLists] = useState<TaskList[]>([]);
  const [calendars, setCalendars] = useState<CalendarListEntry[]>([]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
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

    // Load Google task lists and calendars (best-effort, silently ignore if not connected)
    fetch("/api/google/task-lists")
      .then((r) => r.json())
      .then((d) => { if (d.taskLists) setTaskLists(d.taskLists); })
      .catch(() => {});

    fetch("/api/google/calendars")
      .then((r) => r.json())
      .then((d) => { if (d.calendars) setCalendars(d.calendars); })
      .catch(() => {});
  }, [id]);

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
        tasks: tasks.map(({ label, actionType, dayOffset, taskListId, calendarId }) => ({
          label,
          actionType,
          dayOffset,
          actionConfig:
            actionType === "google_task"
              ? { taskListId: taskListId || "@default" }
              : actionType === "calendar_event"
              ? { calendarId: calendarId || "primary" }
              : null,
        })),
      }),
    });
    setSaving(false);
    if (res.ok) setSaved(true);
  };

  const handleDelete = async () => {
    if (!confirm(`Delete template "${name}"? This cannot be undone.`)) return;
    setDeleting(true);
    await fetch(`/api/releases/templates/${id}`, { method: "DELETE" });
    router.push("/releases/templates");
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!template) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-sm text-destructive">Template not found.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="flex items-center justify-between h-11 px-4">
          <div className="flex items-center gap-2">
            <Link
              href="/releases/templates"
              className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </Link>
            <h1 className="text-sm font-semibold tracking-tight">Edit Template</h1>
          </div>
          <div className="flex items-center gap-2">
            {saved && <span className="text-xs text-green-600">Saved</span>}
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
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-8">
        {/* Template metadata */}
        <section className="space-y-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Template
          </h2>

          <div className="space-y-1.5">
            <Label htmlFor="name" className="text-xs">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="text-sm max-w-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="platform" className="text-xs">Platform Prefix</Label>
              <Input
                id="platform"
                value={platformPrefix}
                onChange={(e) => setPlatformPrefix(e.target.value)}
                placeholder="e.g. web, android (blank = any)"
                className="text-xs font-mono"
              />
              <p className="text-xxs text-muted-foreground">
                Matches the part before{" "}
                <code className="bg-muted px-1 rounded">@</code> in the version name.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="releaseType" className="text-xs">Release Type</Label>
              <select
                id="releaseType"
                value={releaseType}
                onChange={(e) => setReleaseType(e.target.value as ReleaseType | "")}
                className="text-xs h-9 w-full rounded-md border bg-background px-2"
              >
                {RELEASE_TYPES.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <p className="text-xxs text-muted-foreground">
                Derived from semver: x.0.0 = major, x.y.0 = minor, x.y.z = patch.
              </p>
            </div>
          </div>
        </section>

        {/* Tasks */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Tasks
            </h2>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() =>
                setTasks((prev) => [
                  ...prev,
                  {
                    _key: newKey(),
                    label: "",
                    actionType: "manual",
                    dayOffset: 0,
                    taskListId: "@default",
                    calendarId: "primary",
                  },
                ])
              }
            >
              <Plus className="h-3.5 w-3.5" />
              Add task
            </Button>
          </div>

          {tasks.length === 0 && (
            <p className="text-xs text-muted-foreground py-2">
              No tasks yet. Add tasks to define the checklist for this template.
            </p>
          )}

          {tasks.length > 0 && (
            <>
              <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-x-1 text-xxs text-muted-foreground uppercase tracking-wide px-6">
                <span />
                <span>Label</span>
                <span className="w-36 text-center">Action</span>
                <span className="w-20 text-center">Day offset</span>
                <span />
              </div>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={tasks.map((t) => t._key)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="divide-y rounded-lg border px-2">
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
                        onDelete={() =>
                          setTasks((prev) => prev.filter((t) => t._key !== task._key))
                        }
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
              <p className="text-xxs text-muted-foreground">
                Day offset: 0 = release date, negative = before, positive = after.
                Connect Google in{" "}
                <Link href="/settings" className="underline">Settings</Link>{" "}
                to see task list and calendar dropdowns.
              </p>
            </>
          )}
        </section>

        {/* Danger zone */}
        <section className="space-y-3 pt-4 border-t">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Danger Zone
          </h2>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs text-destructive border-destructive/40 hover:bg-destructive/10 gap-1.5"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            Delete Template
          </Button>
        </section>
      </main>
    </div>
  );
}
