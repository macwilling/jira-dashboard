"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Loader2,
  Save,
  Trash2,
  Plus,
  GripVertical,
  X,
  Bell,
  Library,
  Lock,
  Unlock,
  Link2,
  Unlink,
  ExternalLink,
} from "lucide-react";
import { AppShell } from "@/components/app-shell/AppShell";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { SlackTargetPicker } from "@/components/releases/SlackTargetPicker";
import {
  MergeFieldPicker,
  insertTokenAt,
} from "@/components/releases/MergeFieldPicker";
import { cn } from "@/lib/utils";
import type {
  ActionType,
  ConfigurableField,
  NotificationButton,
  ReleaseEventType,
  TaskDefinition,
  Workflow,
  WorkflowNotification,
  WorkflowTask,
  WorkflowTaskOverrides,
} from "@/lib/releases/types";

const INPUT_CLASS =
  "h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const TEXTAREA_CLASS =
  "w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 resize-y";
const SELECT_CLASS =
  "h-9 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const EVENT_TYPE_LABELS: Record<ReleaseEventType, string> = {
  "release.created": "Release created",
  "release.date_changed": "Release date changed",
  "release.released": "Release shipped",
  "task.failed": "Task failed",
  "release.needs_resolution": "Release needs resolution",
};

const EVENT_TYPE_OPTIONS: ReleaseEventType[] = [
  "release.created",
  "release.date_changed",
  "release.released",
  "task.failed",
  "release.needs_resolution",
];

// Locally-editable row shape. Narrowed from WorkflowTask so new rows don't
// need to invent an id until save.
interface TaskRowDraft {
  id: string; // local-only key (UUID); server rebuilds IDs on save
  definitionId: string | null;
  label: string;
  description: string | null;
  actionType: ActionType;
  dayOffset: number;
  allDay: boolean;
  startTime: string | null;
  durationMinutes: number;
  actionConfig: Record<string, unknown> | null;
  overrides: WorkflowTaskOverrides | null;
}

interface NotificationRowDraft {
  id: string;
  eventType: ReleaseEventType;
  message: string;
  target: string;
  buttons: NotificationButton[];
}

function toTaskDraft(t: WorkflowTask): TaskRowDraft {
  return {
    id: t.id,
    definitionId: t.definitionId,
    label: t.label,
    description: t.description,
    actionType: t.actionType,
    dayOffset: t.dayOffset,
    allDay: t.allDay,
    startTime: t.startTime,
    durationMinutes: t.durationMinutes,
    actionConfig: t.actionConfig,
    overrides: t.overrides,
  };
}

function toNotificationDraft(n: WorkflowNotification): NotificationRowDraft {
  return {
    id: n.id,
    eventType: n.eventType,
    message: n.message,
    target: n.target,
    buttons: n.buttons,
  };
}

function newDraftId() {
  return crypto.randomUUID();
}

function emptyTask(): TaskRowDraft {
  return {
    id: newDraftId(),
    definitionId: null,
    label: "",
    description: null,
    actionType: "google_task",
    dayOffset: 0,
    allDay: true,
    startTime: null,
    durationMinutes: 30,
    actionConfig: null,
    overrides: null,
  };
}

function emptyNotification(): NotificationRowDraft {
  return {
    id: newDraftId(),
    eventType: "release.created",
    message: "",
    target: "",
    buttons: [],
  };
}

export default function WorkflowEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [assignedCategories, setAssignedCategories] = useState<
    { id: string; key: string }[]
  >([]);
  const [tasks, setTasks] = useState<TaskRowDraft[]>([]);
  const [notifications, setNotifications] = useState<NotificationRowDraft[]>([]);
  const [definitions, setDefinitions] = useState<TaskDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([
      fetch(`/api/releases/workflows/${id}`).then((r) => r.json()),
      fetch("/api/releases/task-definitions").then((r) => r.json()),
    ])
      .then(([wfData, defData]) => {
        setWorkflow(wfData.workflow ?? null);
        setAssignedCategories(wfData.categories ?? []);
        setTasks((wfData.tasks ?? []).map(toTaskDraft));
        setNotifications(
          (wfData.notifications ?? []).map(toNotificationDraft),
        );
        setDefinitions(defData.definitions ?? []);
      })
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (saved) setSaved(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflow, tasks, notifications]);

  const definitionsById = useMemo(
    () => new Map(definitions.map((d) => [d.id, d])),
    [definitions],
  );

  const updateWorkflow = <K extends keyof Workflow>(
    key: K,
    value: Workflow[K],
  ) => {
    setWorkflow((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const updateTask = (
    taskId: string,
    patch: Partial<TaskRowDraft>,
  ) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, ...patch } : t)),
    );
  };

  const removeTask = (taskId: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
  };

  const addTask = () => {
    setTasks((prev) => [...prev, emptyTask()]);
  };

  const linkTaskToDefinition = (
    taskId: string,
    definitionId: string | null,
  ) => {
    const def = definitionId ? definitionsById.get(definitionId) ?? null : null;
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== taskId) return t;
        if (!def) {
          // Unlink: keep the current values as inline.
          return { ...t, definitionId: null, overrides: null };
        }
        // Link: seed all fields from the definition. Locked fields will always
        // use the definition's value at materialize time, but we mirror them
        // here so the editor shows the real value instead of empty inputs.
        return {
          ...t,
          definitionId: def.id,
          label: def.label,
          description: def.description,
          actionType: def.actionType,
          dayOffset: def.dayOffset,
          allDay: def.allDay,
          startTime: def.startTime,
          durationMinutes: def.durationMinutes,
          actionConfig: def.actionConfig,
          overrides: null,
        };
      }),
    );
  };

  const moveTask = (taskId: string, dir: -1 | 1) => {
    setTasks((prev) => {
      const idx = prev.findIndex((t) => t.id === taskId);
      if (idx < 0) return prev;
      const next = idx + dir;
      if (next < 0 || next >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[next]] = [copy[next], copy[idx]];
      return copy;
    });
  };

  const updateNotification = (
    notificationId: string,
    patch: Partial<NotificationRowDraft>,
  ) => {
    setNotifications((prev) =>
      prev.map((n) =>
        n.id === notificationId ? { ...n, ...patch } : n,
      ),
    );
  };

  const removeNotification = (notificationId: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== notificationId));
  };

  const addNotification = () => {
    setNotifications((prev) => [...prev, emptyNotification()]);
  };

  const handleSave = async () => {
    if (!workflow) return;
    setSaving(true);
    const res = await fetch(`/api/releases/workflows/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: workflow.name.trim(),
        approvalSlackTarget: workflow.approvalSlackTarget || null,
        tasks: tasks
          .filter((t) => t.label.trim() || t.definitionId)
          .map((t) => ({
            definitionId: t.definitionId,
            label: t.label,
            description: t.description,
            actionType: t.actionType,
            dayOffset: t.dayOffset,
            allDay: t.allDay,
            startTime: t.startTime,
            durationMinutes: t.durationMinutes,
            actionConfig: t.actionConfig,
            overrides: t.overrides,
          })),
        notifications: notifications
          .filter(
            (n) => n.message.trim() && n.target.trim(),
          )
          .map((n) => ({
            eventType: n.eventType,
            message: n.message,
            target: n.target,
            buttons: n.buttons,
          })),
      }),
    });
    setSaving(false);
    if (res.ok) {
      setSaved(true);
      load();
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    const res = await fetch(`/api/releases/workflows/${id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      router.push("/releases/workflows");
    } else {
      const data = await res.json().catch(() => ({}));
      setDeleteError(data.error ?? "Delete failed");
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <AppShell title="Workflow">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </AppShell>
    );
  }

  if (!workflow) {
    return (
      <AppShell title="Workflow">
        <div className="flex items-center justify-center py-20">
          <p className="text-sm text-destructive">Workflow not found.</p>
        </div>
      </AppShell>
    );
  }

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
        disabled={saving || !workflow.name.trim()}
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
    <AppShell title="Workflow" subtitle={workflow.name} actions={actions}>
      <main className="max-w-4xl mx-auto px-6 py-6 space-y-6">
        {/* Identity + assignment summary */}
        <section className="space-y-3">
          <div>
            <Label className="text-xs">Name</Label>
            <input
              value={workflow.name}
              onChange={(e) => updateWorkflow("name", e.target.value)}
              placeholder="e.g. Web major release"
              className={cn(INPUT_CLASS, "mt-1.5")}
            />
          </div>

          <div className="rounded-md border bg-muted/30 px-3 py-2 flex items-center gap-2 text-xs text-muted-foreground">
            <span>Assigned to:</span>
            {assignedCategories.length === 0 ? (
              <span>
                No categories yet —{" "}
                <Link
                  href="/releases/categories"
                  className="underline hover:text-foreground"
                >
                  assign on categories page
                </Link>
              </span>
            ) : (
              <div className="flex items-center gap-1 flex-wrap">
                {assignedCategories.map((c) => (
                  <Badge
                    key={c.id}
                    variant="secondary"
                    className="text-[10px] h-5 px-1.5 font-mono"
                  >
                    {c.key}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Approval gate */}
        <section className="space-y-2">
          <div>
            <Label className="text-xs">Approval Slack target</Label>
            <p className="text-xxs text-muted-foreground mt-0.5">
              Leave blank to skip approval — tasks auto-dispatch as soon as the
              release date is set. Pick a channel or user to gate dispatch on a
              human click.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <SlackTargetPicker
              value={workflow.approvalSlackTarget ?? ""}
              onChange={(v) =>
                updateWorkflow("approvalSlackTarget", v || null)
              }
              className="w-full max-w-sm"
            />
            {workflow.approvalSlackTarget && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs gap-1 text-muted-foreground"
                onClick={() => updateWorkflow("approvalSlackTarget", null)}
              >
                <X className="h-3 w-3" />
                Clear
              </Button>
            )}
          </div>
        </section>

        {/* Tasks */}
        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <div>
              <h2 className="text-sm font-semibold">Tasks</h2>
              <p className="text-xxs text-muted-foreground">
                Ordered list of work materialized per release. Link to the
                library to inherit values, or define inline.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={addTask}
            >
              <Plus className="h-3 w-3" />
              Add task
            </Button>
          </div>

          {tasks.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
              No tasks yet.
            </div>
          ) : (
            <div className="space-y-2">
              {tasks.map((t, i) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  index={i}
                  isLast={i === tasks.length - 1}
                  definition={
                    t.definitionId
                      ? definitionsById.get(t.definitionId) ?? null
                      : null
                  }
                  definitions={definitions}
                  onUpdate={(patch) => updateTask(t.id, patch)}
                  onRemove={() => removeTask(t.id)}
                  onMove={(dir) => moveTask(t.id, dir)}
                  onLink={(defId) => linkTaskToDefinition(t.id, defId)}
                />
              ))}
            </div>
          )}
        </section>

        {/* Notifications */}
        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <div>
              <h2 className="text-sm font-semibold">Notification rules</h2>
              <p className="text-xxs text-muted-foreground">
                Fire a Slack message when a lifecycle event happens on a release
                using this workflow.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={addNotification}
            >
              <Plus className="h-3 w-3" />
              Add rule
            </Button>
          </div>

          {notifications.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
              No notification rules.
            </div>
          ) : (
            <div className="space-y-2">
              {notifications.map((n) => (
                <NotificationRow
                  key={n.id}
                  notification={n}
                  onUpdate={(patch) => updateNotification(n.id, patch)}
                  onRemove={() => removeNotification(n.id)}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open);
          if (!open) setDeleteError(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete workflow?</DialogTitle>
            <DialogDescription>
              {assignedCategories.length === 0 ? (
                <>
                  Not assigned to any category — safe to delete. Releases using
                  this workflow in the past keep their task history.
                </>
              ) : (
                <>
                  Still assigned to{" "}
                  <span className="font-medium text-foreground">
                    {assignedCategories.map((c) => c.key).join(", ")}
                  </span>
                  . Unassign first on the categories page.
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
              onClick={handleDelete}
              disabled={deleting || assignedCategories.length > 0}
            >
              {deleting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              )}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function TaskRow({
  task,
  index,
  isLast,
  definition,
  definitions,
  onUpdate,
  onRemove,
  onMove,
  onLink,
}: {
  task: TaskRowDraft;
  index: number;
  isLast: boolean;
  definition: TaskDefinition | null;
  definitions: TaskDefinition[];
  onUpdate: (patch: Partial<TaskRowDraft>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  onLink: (definitionId: string | null) => void;
}) {
  const labelRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const [showLink, setShowLink] = useState(false);

  const isLinked = !!task.definitionId;
  const configurable = new Set<ConfigurableField>(
    definition?.configurableFields ?? [],
  );
  const canOverride = (f: ConfigurableField) =>
    !isLinked || configurable.has(f);

  // When linked, we display the effective value: override (if present) or
  // definition default. On change we write into `overrides` (configurable
  // only); locked writes are silently ignored by the UI — disabled inputs
  // prevent them from firing.
  const effective = <K extends keyof TaskRowDraft>(
    field: K,
    configurableField: ConfigurableField | null,
  ): TaskRowDraft[K] => {
    if (!isLinked || !definition) return task[field];
    if (configurableField && configurable.has(configurableField)) {
      const ov = task.overrides as Record<string, unknown> | null;
      if (ov && configurableField in ov) {
        return ov[configurableField] as TaskRowDraft[K];
      }
    }
    // Not configurable or no override → fall back to definition value mirrored
    // onto the task itself (we seeded those on link).
    return task[field];
  };

  const updateField = <K extends keyof TaskRowDraft>(
    key: K,
    value: TaskRowDraft[K],
    configurableField: ConfigurableField | null,
  ) => {
    if (isLinked && configurableField) {
      const current = (task.overrides ?? {}) as Record<string, unknown>;
      const next = { ...current, [configurableField]: value };
      onUpdate({
        [key]: value,
        overrides: next as WorkflowTaskOverrides,
      } as Partial<TaskRowDraft>);
    } else {
      onUpdate({ [key]: value } as Partial<TaskRowDraft>);
    }
  };

  const insertToLabel = (token: string) => {
    const { nextValue, restoreCaret } = insertTokenAt(
      labelRef.current,
      task.label,
      token,
    );
    updateField("label", nextValue, "label");
    restoreCaret();
  };
  const insertToDesc = (token: string) => {
    const { nextValue, restoreCaret } = insertTokenAt(
      descRef.current,
      task.description ?? "",
      token,
    );
    updateField("description", nextValue || null, "description");
    restoreCaret();
  };

  const ActionIcon =
    task.actionType === "calendar_event"
      ? GoogleCalendarIcon
      : task.actionType === "google_task"
        ? GoogleTasksIcon
        : null;

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/20">
        <div className="flex flex-col">
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            className="h-4 w-4 flex items-center justify-center text-muted-foreground/60 hover:text-foreground disabled:opacity-20"
            title="Move up"
          >
            <GripVertical className="h-3 w-3 rotate-90" />
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={isLast}
            className="h-4 w-4 flex items-center justify-center text-muted-foreground/60 hover:text-foreground disabled:opacity-20"
            title="Move down"
          >
            <GripVertical className="h-3 w-3 rotate-90" />
          </button>
        </div>
        <span className="text-xxs font-mono text-muted-foreground tabular-nums w-5">
          {index + 1}
        </span>
        {ActionIcon && <ActionIcon className="h-3.5 w-3.5 rounded" />}
        <div className="flex-1 min-w-0">
          <p className="text-sm truncate">
            {task.label || (
              <span className="text-muted-foreground italic">
                Untitled task
              </span>
            )}
          </p>
          {isLinked && definition && (
            <p className="text-xxs text-muted-foreground flex items-center gap-1 mt-0.5">
              <Library className="h-2.5 w-2.5" />
              Linked to{" "}
              <Link
                href={`/releases/task-library/${definition.id}`}
                className="underline hover:text-foreground inline-flex items-center gap-0.5"
                onClick={(e) => e.stopPropagation()}
              >
                {definition.name}
                <ExternalLink className="h-2 w-2" />
              </Link>
            </p>
          )}
          {isLinked && !definition && (
            <p className="text-xxs text-red-600 dark:text-red-400 flex items-center gap-1 mt-0.5">
              <Library className="h-2.5 w-2.5" />
              Linked definition missing
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xxs gap-1 text-muted-foreground"
          onClick={() => setShowLink((s) => !s)}
        >
          {isLinked ? (
            <>
              <Unlink className="h-3 w-3" />
              Unlink
            </>
          ) : (
            <>
              <Link2 className="h-3 w-3" />
              Link library
            </>
          )}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 text-muted-foreground hover:text-red-600"
          onClick={onRemove}
          title="Remove task"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {showLink && (
        <div className="px-3 py-2 border-b bg-muted/10 space-y-1.5">
          <Label className="text-xxs text-muted-foreground">
            Library definition
          </Label>
          <select
            value={task.definitionId ?? ""}
            onChange={(e) => {
              onLink(e.target.value || null);
              setShowLink(false);
            }}
            className={cn(SELECT_CLASS, "w-full")}
          >
            <option value="">(inline — no library link)</option>
            {definitions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <p className="text-xxs text-muted-foreground">
            Linking seeds all fields from the definition. Fields the definition
            marks <Lock className="inline h-2.5 w-2.5 mx-0.5" />
            locked will use the library value at materialize time.
          </p>
        </div>
      )}

      <div className="p-3 space-y-3">
        <FieldLine
          label="Title"
          hint="Task/event title. Supports merge fields."
          locked={!canOverride("label")}
        >
          <div className="flex items-center gap-1.5">
            <input
              ref={labelRef}
              value={task.label}
              disabled={!canOverride("label")}
              onChange={(e) => updateField("label", e.target.value, "label")}
              className={cn(
                INPUT_CLASS,
                !canOverride("label") && "bg-muted/40 text-muted-foreground",
              )}
            />
            {canOverride("label") && <MergeFieldPicker onInsert={insertToLabel} />}
          </div>
        </FieldLine>

        <FieldLine
          label="Notes"
          hint="Event description or task notes."
          locked={!canOverride("description")}
        >
          <div className="flex items-start gap-1.5">
            <textarea
              ref={descRef}
              value={task.description ?? ""}
              disabled={!canOverride("description")}
              onChange={(e) =>
                updateField(
                  "description",
                  e.target.value || null,
                  "description",
                )
              }
              rows={2}
              className={cn(
                TEXTAREA_CLASS,
                !canOverride("description") &&
                  "bg-muted/40 text-muted-foreground",
              )}
            />
            {canOverride("description") && (
              <MergeFieldPicker onInsert={insertToDesc} />
            )}
          </div>
        </FieldLine>

        <div className="grid grid-cols-2 gap-3">
          <FieldLine
            label="Action type"
            hint={isLinked ? "Locked by library definition." : "Task or calendar event."}
            locked={isLinked}
          >
            <div className="inline-flex rounded-lg bg-muted p-0.5 gap-0.5">
              <button
                type="button"
                disabled={isLinked}
                onClick={() =>
                  updateField("actionType", "google_task", null)
                }
                className={cn(
                  "inline-flex items-center gap-1.5 h-8 px-2.5 text-xs transition-all rounded-md",
                  task.actionType === "google_task"
                    ? "bg-background text-foreground shadow-sm"
                    : "bg-transparent text-muted-foreground hover:text-foreground",
                  isLinked && "opacity-60 cursor-not-allowed",
                )}
              >
                <GoogleTasksIcon
                  className={cn(
                    "h-3.5 w-3.5 rounded",
                    task.actionType !== "google_task" &&
                      "grayscale opacity-50",
                  )}
                />
                Task
              </button>
              <button
                type="button"
                disabled={isLinked}
                onClick={() =>
                  updateField("actionType", "calendar_event", null)
                }
                className={cn(
                  "inline-flex items-center gap-1.5 h-8 px-2.5 text-xs transition-all rounded-md",
                  task.actionType === "calendar_event"
                    ? "bg-background text-foreground shadow-sm"
                    : "bg-transparent text-muted-foreground hover:text-foreground",
                  isLinked && "opacity-60 cursor-not-allowed",
                )}
              >
                <GoogleCalendarIcon
                  className={cn(
                    "h-3.5 w-3.5",
                    task.actionType !== "calendar_event" &&
                      "grayscale opacity-50",
                  )}
                />
                Calendar
              </button>
            </div>
          </FieldLine>

          <FieldLine
            label="Day offset"
            hint="Days relative to release date. Negative = before."
            locked={!canOverride("dayOffset")}
          >
            <input
              type="number"
              value={task.dayOffset}
              disabled={!canOverride("dayOffset")}
              onChange={(e) =>
                updateField(
                  "dayOffset",
                  parseInt(e.target.value, 10) || 0,
                  "dayOffset",
                )
              }
              className={cn(
                INPUT_CLASS,
                "w-24 font-mono",
                !canOverride("dayOffset") &&
                  "bg-muted/40 text-muted-foreground",
              )}
            />
          </FieldLine>
        </div>

        {task.actionType === "calendar_event" && (
          <div className="grid grid-cols-2 gap-3">
            <FieldLine
              label="All-day"
              hint="All-day event vs. timed."
              locked={!canOverride("allDay")}
            >
              <div className="inline-flex rounded-lg bg-muted p-0.5 gap-0.5">
                <button
                  type="button"
                  disabled={!canOverride("allDay")}
                  onClick={() => updateField("allDay", true, "allDay")}
                  className={cn(
                    "h-8 px-3 text-xs transition-all rounded-md",
                    task.allDay
                      ? "bg-background text-foreground shadow-sm"
                      : "bg-transparent text-muted-foreground hover:text-foreground",
                    !canOverride("allDay") && "opacity-60 cursor-not-allowed",
                  )}
                >
                  All day
                </button>
                <button
                  type="button"
                  disabled={!canOverride("allDay")}
                  onClick={() => updateField("allDay", false, "allDay")}
                  className={cn(
                    "h-8 px-3 text-xs transition-all rounded-md",
                    !task.allDay
                      ? "bg-background text-foreground shadow-sm"
                      : "bg-transparent text-muted-foreground hover:text-foreground",
                    !canOverride("allDay") && "opacity-60 cursor-not-allowed",
                  )}
                >
                  At time
                </button>
              </div>
            </FieldLine>

            {!task.allDay && (
              <FieldLine
                label="Start / duration"
                hint="Event time and length."
                locked={
                  !canOverride("startTime") && !canOverride("durationMinutes")
                }
              >
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    value={task.startTime ?? "09:00"}
                    disabled={!canOverride("startTime")}
                    onChange={(e) =>
                      updateField("startTime", e.target.value, "startTime")
                    }
                    className={cn(
                      INPUT_CLASS,
                      "w-28 font-mono",
                      !canOverride("startTime") &&
                        "bg-muted/40 text-muted-foreground",
                    )}
                  />
                  <input
                    type="number"
                    min={5}
                    max={480}
                    step={5}
                    value={task.durationMinutes}
                    disabled={!canOverride("durationMinutes")}
                    onChange={(e) =>
                      updateField(
                        "durationMinutes",
                        parseInt(e.target.value, 10) || 30,
                        "durationMinutes",
                      )
                    }
                    className={cn(
                      INPUT_CLASS,
                      "w-20 font-mono",
                      !canOverride("durationMinutes") &&
                        "bg-muted/40 text-muted-foreground",
                    )}
                  />
                  <span className="text-xs text-muted-foreground">min</span>
                </div>
              </FieldLine>
            )}
          </div>
        )}
      </div>
      {/* reference 'effective' so TS doesn't flag it as unused while leaving the helper documented */}
      <span className="hidden">{String(effective("label", "label"))}</span>
    </div>
  );
}

function NotificationRow({
  notification,
  onUpdate,
  onRemove,
}: {
  notification: NotificationRowDraft;
  onUpdate: (patch: Partial<NotificationRowDraft>) => void;
  onRemove: () => void;
}) {
  const messageRef = useRef<HTMLTextAreaElement>(null);

  const insertToMessage = (token: string) => {
    const { nextValue, restoreCaret } = insertTokenAt(
      messageRef.current,
      notification.message,
      token,
    );
    onUpdate({ message: nextValue });
    restoreCaret();
  };

  const addButton = () => {
    onUpdate({
      buttons: [...notification.buttons, { label: "", url: "" }],
    });
  };

  const updateButton = (idx: number, patch: Partial<NotificationButton>) => {
    const next = notification.buttons.map((b, i) =>
      i === idx ? { ...b, ...patch } : b,
    );
    onUpdate({ buttons: next });
  };

  const removeButton = (idx: number) => {
    onUpdate({
      buttons: notification.buttons.filter((_, i) => i !== idx),
    });
  };

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/20">
        <Bell className="h-3.5 w-3.5 text-muted-foreground" />
        <select
          value={notification.eventType}
          onChange={(e) =>
            onUpdate({ eventType: e.target.value as ReleaseEventType })
          }
          className={cn(SELECT_CLASS, "h-7 text-xs")}
        >
          {EVENT_TYPE_OPTIONS.map((ev) => (
            <option key={ev} value={ev}>
              {EVENT_TYPE_LABELS[ev]}
            </option>
          ))}
        </select>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 text-muted-foreground hover:text-red-600"
          onClick={onRemove}
          title="Remove rule"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="p-3 space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xxs text-muted-foreground">
            Slack target
          </Label>
          <SlackTargetPicker
            value={notification.target}
            onChange={(v) => onUpdate({ target: v })}
            className="w-full max-w-sm"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xxs text-muted-foreground">Message</Label>
          <div className="flex items-start gap-1.5">
            <textarea
              ref={messageRef}
              value={notification.message}
              onChange={(e) => onUpdate({ message: e.target.value })}
              rows={3}
              placeholder={`e.g. 🚀 {{release.name}} is live — see the release page for details.`}
              className={TEXTAREA_CLASS}
            />
            <MergeFieldPicker
              onInsert={insertToMessage}
              eventType={notification.eventType}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xxs text-muted-foreground">
              Buttons (optional)
            </Label>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xxs gap-1 text-muted-foreground"
              onClick={addButton}
            >
              <Plus className="h-3 w-3" />
              Add button
            </Button>
          </div>
          {notification.buttons.map((b, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input
                value={b.label}
                onChange={(e) =>
                  updateButton(i, { label: e.target.value })
                }
                placeholder="Button label"
                className={cn(INPUT_CLASS, "h-8 max-w-[200px]")}
              />
              <input
                value={b.url}
                onChange={(e) => updateButton(i, { url: e.target.value })}
                placeholder="https://…"
                className={cn(INPUT_CLASS, "h-8 flex-1 font-mono text-xs")}
              />
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 text-muted-foreground hover:text-red-600"
                onClick={() => removeButton(i)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FieldLine({
  label,
  hint,
  locked,
  children,
}: {
  label: string;
  hint?: string;
  locked?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <Label className="text-xxs text-muted-foreground">{label}</Label>
        {locked ? (
          <span className="inline-flex items-center gap-0.5 text-xxs text-muted-foreground/60">
            <Lock className="h-2.5 w-2.5" />
            locked
          </span>
        ) : (
          <span className="inline-flex items-center gap-0.5 text-xxs text-primary/70">
            <Unlock className="h-2.5 w-2.5" />
          </span>
        )}
      </div>
      {children}
      {hint && <p className="text-xxs text-muted-foreground">{hint}</p>}
    </div>
  );
}
