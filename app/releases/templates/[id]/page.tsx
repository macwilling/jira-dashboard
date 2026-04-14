"use client";

import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
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
  X,
  Bell,
} from "lucide-react";
import { SlackTargetPicker } from "@/components/releases/SlackTargetPicker";
import {
  GoogleTasksIcon,
  GoogleCalendarIcon,
} from "@/components/releases/GoogleIcons";
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
import {
  buildSampleMergeContext,
  renderMergeFields,
} from "@/lib/releases/merge-fields";
import { cn } from "@/lib/utils";
import type {
  ActionType,
  NotificationButton,
  ReleaseEventType,
  ReleaseNotification,
  ReleaseTemplate,
  ReleaseTemplateTask,
  ReleaseType,
} from "@/lib/releases/types";
import type { TaskList, CalendarListEntry } from "@/lib/google/client";

// Tasks in the editor can only be Google Tasks or Calendar Events now. Legacy
// "manual" rows still render (picker won't offer them) but new rows default to
// google_task. Slack is no longer an action type — notifications are
// event-driven and live in the Notifications section below the task list.
const ACTION_LABELS: Record<ActionType, string> = {
  manual: "Manual",
  google_task: "Google Task",
  calendar_event: "Calendar event",
};
const RELEASE_TYPE_OPTIONS: Array<{ value: ReleaseType; label: string; hint: string }> = [
  { value: "major", label: "Major", hint: "x.0.0" },
  { value: "minor", label: "Minor", hint: "x.y.0" },
  { value: "patch", label: "Patch", hint: "x.y.z" },
];
const DEFAULT_PLATFORM_SUGGESTIONS = ["web", "android", "ios", "backend"];

type OffsetDirection = "before" | "on" | "after";
function offsetToDirection(offset: number): OffsetDirection {
  if (offset < 0) return "before";
  if (offset > 0) return "after";
  return "on";
}

const INPUT_CLASS =
  "h-8 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";
const TEXTAREA_CLASS =
  "w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 resize-y";
const SELECT_CLASS =
  "h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function ActionPickerButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 h-9 px-3 text-sm font-medium transition-all",
        active
          ? "bg-background text-foreground shadow-sm"
          : "bg-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      <span className={cn("shrink-0", !active && "grayscale opacity-50")}>{icon}</span>
      {label}
    </button>
  );
}

const EVENT_OPTIONS: Array<{ value: ReleaseEventType; label: string; hint: string }> = [
  { value: "release.created",      label: "Release created",    hint: "When a new version appears in Jira" },
  { value: "release.date_changed", label: "Release date changed", hint: "When the release date moves" },
  { value: "release.released",     label: "Release released",   hint: "When Jira marks the version released" },
  { value: "task.failed",          label: "Task failed",        hint: "When a Google Task/Calendar dispatch errors" },
];

interface DraftButton {
  _key: string;
  label: string;
  url: string;
}

interface DraftNotification {
  _key: string;
  eventType: ReleaseEventType;
  message: string;
  /** Slack channel ID (C…/G…) or user ID (U…). Empty = unset. */
  target: string;
  buttons: DraftButton[];
}

const MAX_BUTTONS = 5;

function notificationToRow(n: ReleaseNotification): DraftNotification {
  return {
    _key: newKey(),
    eventType: n.eventType,
    message: n.message,
    target: n.target ?? "",
    buttons: (n.buttons ?? []).map((b) => ({
      _key: newKey(),
      label: b.label,
      url: b.url,
    })),
  };
}

function freshNotification(): DraftNotification {
  return {
    _key: newKey(),
    eventType: "release.created",
    message: "",
    target: "",
    buttons: [],
  };
}

function freshButton(): DraftButton {
  return { _key: newKey(), label: "", url: "" };
}

function draftButtonsToApi(buttons: DraftButton[]): NotificationButton[] {
  return buttons
    .map((b) => ({ label: b.label.trim(), url: b.url.trim() }))
    .filter((b) => b.label && b.url);
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
    actionType: "google_task",
    dayOffset: 0,
    allDay: true,
    startTime: "09:00",
    durationMinutes: 30,
    taskListId: "@default",
    calendarId: "primary",
  };
}

/**
 * Pill-based platform selector. Presets render as toggleable chips; user can
 * add custom values via a + Add button that reveals an inline input. Matches
 * the visual language of the Release-types checkboxes below it.
 */
function PlatformChipInput({
  values,
  onChange,
}: {
  values: string[];
  onChange: (next: string[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const addRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding) addRef.current?.focus();
  }, [adding]);

  const commitDraft = () => {
    const v = draft.trim().toLowerCase();
    setDraft("");
    setAdding(false);
    if (!v || values.includes(v)) return;
    onChange([...values, v]);
  };

  const togglePreset = (v: string) => {
    onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v]);
  };

  const removeValue = (v: string) => onChange(values.filter((x) => x !== v));

  // Union of presets and current custom values, dedup'd, in stable order.
  const visible = [
    ...DEFAULT_PLATFORM_SUGGESTIONS,
    ...values.filter((v) => !DEFAULT_PLATFORM_SUGGESTIONS.includes(v)),
  ];

  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      {visible.map((v) => {
        const active = values.includes(v);
        const isCustom = !DEFAULT_PLATFORM_SUGGESTIONS.includes(v);
        return (
          <button
            key={v}
            type="button"
            onClick={() => togglePreset(v)}
            className={cn(
              "inline-flex items-center gap-1.5 h-8 pl-2.5 pr-2.5 rounded-md border text-xs font-mono transition-colors",
              active
                ? "bg-primary/10 border-primary/40 text-foreground"
                : "bg-background border-input text-muted-foreground hover:text-foreground",
            )}
          >
            {v}
            {active && isCustom && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  removeValue(v);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    removeValue(v);
                  }
                }}
                aria-label={`Remove ${v}`}
                className="text-muted-foreground hover:text-destructive rounded cursor-pointer"
              >
                <X className="h-3 w-3" />
              </span>
            )}
          </button>
        );
      })}

      {adding ? (
        <input
          ref={addRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitDraft();
            } else if (e.key === "Escape") {
              setDraft("");
              setAdding(false);
            }
          }}
          placeholder="ios, backend…"
          className="h-8 w-28 rounded-md border border-input bg-background px-2 text-xs font-mono outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-dashed border-input text-xs text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
        >
          <Plus className="h-3 w-3" />
          Custom
        </button>
      )}
    </div>
  );
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
  const isLegacyManual = task.actionType === "manual";

  // Preview tokens using a sample release; pass this row's dayOffset so
  // {{task.dueDate}} previews at the right relative date.
  const sampleCtx = buildSampleMergeContext({ dayOffset: task.dayOffset });
  const labelPreview = task.label.includes("{{")
    ? renderMergeFields(task.label, sampleCtx) ?? ""
    : "";
  const descPreview = task.description.includes("{{")
    ? renderMergeFields(task.description, sampleCtx) ?? ""
    : "";
  const direction = offsetToDirection(task.dayOffset);
  const daysAbs = Math.abs(task.dayOffset);

  const setDirection = (next: OffsetDirection) => {
    if (next === "on") {
      onChange({ ...task, dayOffset: 0 });
      return;
    }
    const magnitude = daysAbs === 0 ? 1 : daysAbs;
    onChange({ ...task, dayOffset: next === "before" ? -magnitude : magnitude });
  };

  const setDaysMagnitude = (n: number) => {
    const mag = Math.max(0, Math.floor(n));
    if (mag === 0) {
      onChange({ ...task, dayOffset: 0 });
      return;
    }
    const sign = direction === "before" ? -1 : 1;
    onChange({ ...task, dayOffset: sign * mag });
  };

  const whenPreviewLine = (() => {
    if (direction === "on") return "Due on the release date";
    const suffix = direction === "before" ? "before release" : "after release";
    return `Due ${daysAbs || 1} day${(daysAbs || 1) === 1 ? "" : "s"} ${suffix}`;
  })();

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="bg-background hover:bg-muted/10 transition-colors"
    >
      {/* Compact header: drag · action toggle · row actions */}
      <div className="flex items-center gap-2 px-3 pt-3">
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing text-muted-foreground/60 hover:text-foreground shrink-0 touch-none"
          aria-label="Drag to reorder"
          type="button"
        >
          <GripVertical className="h-4 w-4" />
        </button>

        {/* iOS-style segmented control for action type */}
        <div className="inline-flex rounded-lg bg-muted p-0.5 gap-0.5">
          <ActionPickerButton
            active={isGoogleTask}
            onClick={() => onChange({ ...task, actionType: "google_task" })}
            icon={<GoogleTasksIcon className="h-4 w-4 rounded" />}
            label="Task"
          />
          <ActionPickerButton
            active={isCalendarEvent}
            onClick={() => onChange({ ...task, actionType: "calendar_event" })}
            icon={<GoogleCalendarIcon className="h-4 w-4" />}
            label="Calendar"
          />
        </div>

        {isLegacyManual && (
          <span className="text-xxs text-amber-700 dark:text-amber-400 inline-flex items-center gap-1 ml-1">
            <AlertTriangle className="h-3 w-3" />
            Legacy {ACTION_LABELS[task.actionType]}
          </span>
        )}

        <div className="ml-auto flex items-center gap-0.5">
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

      {/* Body */}
      <div className="px-3 pt-3 pb-4 space-y-4">
        {/* Title */}
        <div className="space-y-1.5">
          <Label className="text-xxs uppercase tracking-wide text-muted-foreground">
            Title
          </Label>
          <div className="flex items-center gap-1.5">
            <input
              ref={labelRef}
              value={task.label}
              onChange={(e) => onChange({ ...task, label: e.target.value })}
              placeholder={isCalendarEvent ? "Event title…" : "Task title…"}
              className={cn(INPUT_CLASS, "h-9 text-sm")}
            />
            <MergeFieldPicker onInsert={insertToLabel} />
          </div>
          {labelPreview && (
            <div className="text-xxs text-muted-foreground truncate">
              <span className="opacity-70">Preview:</span>{" "}
              <span className="text-foreground/80">{labelPreview}</span>
            </div>
          )}
        </div>

        {/* Description */}
        <div className="space-y-1.5">
          <Label className="text-xxs uppercase tracking-wide text-muted-foreground">
            Notes
          </Label>
          <div className="flex items-start gap-1.5">
            <textarea
              ref={descRef}
              value={task.description}
              onChange={(e) => onChange({ ...task, description: e.target.value })}
              placeholder={
                isCalendarEvent
                  ? "Details shown on the calendar event…"
                  : "Notes shown on the Google Task…"
              }
              rows={2}
              className={TEXTAREA_CLASS}
            />
            <MergeFieldPicker onInsert={insertToDesc} />
          </div>
          {descPreview && (
            <div className="rounded-md border border-dashed bg-muted/30 px-2.5 py-1.5 text-xxs">
              <div className="uppercase tracking-wide text-muted-foreground/80 mb-0.5">
                Preview — sample release
              </div>
              <div className="whitespace-pre-wrap break-words text-foreground/80">
                {descPreview}
              </div>
            </div>
          )}
        </div>

        {/* When */}
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <Label className="text-xxs uppercase tracking-wide text-muted-foreground">
              When
            </Label>
            <span className="text-xxs text-muted-foreground italic">
              {whenPreviewLine}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="inline-flex rounded-lg bg-muted p-0.5 gap-0.5">
              {(
                [
                  { value: "before" as const, label: "Before release" },
                  { value: "on" as const, label: "Release day" },
                  { value: "after" as const, label: "After release" },
                ]
              ).map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setDirection(value)}
                  className={cn(
                    "h-8 px-3 text-xs transition-all rounded-md",
                    direction === value
                      ? "bg-background text-foreground font-medium shadow-sm"
                      : "bg-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {direction !== "on" && (
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min="1"
                  value={daysAbs}
                  onChange={(e) => setDaysMagnitude(parseInt(e.target.value, 10) || 0)}
                  className={cn(INPUT_CLASS, "w-14 h-8 font-mono text-xs text-center")}
                />
                <span className="text-xs text-muted-foreground">
                  day{daysAbs === 1 ? "" : "s"}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Delivery — no bordered sub-card; inline. */}
        {!isLegacyManual && (
          <div className="space-y-1.5 border-t border-dashed pt-3">
            <Label className="text-xxs uppercase tracking-wide text-muted-foreground">
              Delivery
            </Label>

            {isGoogleTask && (
              <div className="grid grid-cols-[5rem_1fr] items-center gap-x-3 gap-y-2">
                <span className="text-xs text-muted-foreground">Task list</span>
                {taskLists.length > 0 ? (
                  <select
                    value={task.taskListId}
                    onChange={(e) => onChange({ ...task, taskListId: e.target.value })}
                    className={cn(SELECT_CLASS, "h-8 w-full max-w-sm text-xs")}
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
                    className={cn(INPUT_CLASS, "h-8 font-mono text-xs max-w-sm")}
                  />
                )}
                <span />
                <p className="text-xxs text-muted-foreground">
                  Tasks are date-only. Switch to Calendar for a specific time.
                </p>
              </div>
            )}

            {isCalendarEvent && (
              <div className="grid grid-cols-[5rem_1fr] items-center gap-x-3 gap-y-2">
                <span className="text-xs text-muted-foreground">Calendar</span>
                {calendars.length > 0 ? (
                  <select
                    value={task.calendarId}
                    onChange={(e) => onChange({ ...task, calendarId: e.target.value })}
                    className={cn(SELECT_CLASS, "h-8 w-full max-w-sm text-xs")}
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
                    className={cn(INPUT_CLASS, "h-8 font-mono text-xs max-w-sm")}
                  />
                )}

                <span className="text-xs text-muted-foreground">Time</span>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="inline-flex rounded-lg bg-muted p-0.5 gap-0.5">
                    <button
                      type="button"
                      onClick={() => onChange({ ...task, allDay: true })}
                      className={cn(
                        "h-8 px-3 text-xs transition-all rounded-md",
                        task.allDay
                          ? "bg-background text-foreground font-medium shadow-sm"
                          : "bg-transparent text-muted-foreground hover:text-foreground",
                      )}
                    >
                      All day
                    </button>
                    <button
                      type="button"
                      onClick={() => onChange({ ...task, allDay: false })}
                      className={cn(
                        "h-8 px-3 text-xs transition-all rounded-md",
                        !task.allDay
                          ? "bg-background text-foreground font-medium shadow-sm"
                          : "bg-transparent text-muted-foreground hover:text-foreground",
                      )}
                    >
                      At time
                    </button>
                  </div>
                  {!task.allDay && (
                    <>
                      <input
                        type="time"
                        value={task.startTime || "09:00"}
                        onChange={(e) => onChange({ ...task, startTime: e.target.value })}
                        className={cn(INPUT_CLASS, "h-8 w-28 text-xs font-mono")}
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
                        className={cn(INPUT_CLASS, "h-8 w-16 text-xs font-mono")}
                      />
                      <span className="text-xs text-muted-foreground">min</span>
                    </>
                  )}
                </div>
                {!task.allDay && (
                  <>
                    <span />
                    <p className="text-xxs text-muted-foreground">
                      Uses the standup timezone from Settings.
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {isLegacyManual && (
          <p className="text-xs text-muted-foreground inline-flex items-center gap-1.5 border-t border-dashed pt-3">
            <Info className="h-3 w-3" />
            Legacy Manual task — won&apos;t auto-dispatch until you pick Task or Calendar above.
          </p>
        )}
      </div>
    </div>
  );
}

function NotificationRow({
  notification,
  onChange,
  onDelete,
}: {
  notification: DraftNotification;
  onChange: (updated: DraftNotification) => void;
  onDelete: () => void;
}) {
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const insertToMessage = (token: string) => {
    const { nextValue, restoreCaret } = insertTokenAt(
      messageRef.current,
      notification.message,
      token,
    );
    onChange({ ...notification, message: nextValue });
    restoreCaret();
  };

  const targetMissing = !notification.target.trim();

  const previewText = (() => {
    if (!notification.message.trim()) return "";
    const ctx = buildSampleMergeContext();
    return renderMergeFields(notification.message, ctx) ?? notification.message;
  })();

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<
    { ok: true } | { ok: false; error: string } | null
  >(null);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/releases/notifications/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventType: notification.eventType,
          message: notification.message,
          target: notification.target.trim() || null,
          buttons: draftButtonsToApi(notification.buttons),
        }),
      });
      const data = await res.json();
      if (res.ok) setTestResult({ ok: true });
      else setTestResult({ ok: false, error: data.error || "Test failed" });
    } catch (e) {
      setTestResult({ ok: false, error: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-3 pt-3">
        <Bell className="h-3.5 w-3.5 text-muted-foreground/70 shrink-0" />
        <select
          value={notification.eventType}
          onChange={(e) =>
            onChange({
              ...notification,
              eventType: e.target.value as ReleaseEventType,
            })
          }
          className={cn(SELECT_CLASS, "h-8 text-xs")}
        >
          {EVENT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <span className="text-xxs text-muted-foreground hidden sm:inline">
          {EVENT_OPTIONS.find((o) => o.value === notification.eventType)?.hint}
        </span>
        <div className="ml-auto">
          <button
            type="button"
            onClick={onDelete}
            className="text-muted-foreground hover:text-destructive h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-destructive/10 transition-colors"
            aria-label="Delete notification"
            title="Delete notification"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="px-3 pt-3 pb-4 space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xxs uppercase tracking-wide text-muted-foreground">
            Message
          </Label>
          <div className="flex items-start gap-1.5">
            <textarea
              ref={messageRef}
              value={notification.message}
              onChange={(e) =>
                onChange({ ...notification, message: e.target.value })
              }
              placeholder="Message body sent as `text`. Use merge fields like {{release.name}}."
              rows={2}
              className={TEXTAREA_CLASS}
            />
            <MergeFieldPicker
              onInsert={insertToMessage}
              eventType={notification.eventType}
            />
          </div>
          {previewText && (
            <div className="rounded-md border border-dashed bg-muted/30 px-2.5 py-1.5 text-xs space-y-0.5">
              <div className="text-xxs uppercase tracking-wide text-muted-foreground/80">
                Preview — sample release
              </div>
              <div className="whitespace-pre-wrap break-words text-foreground/90">
                {previewText}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-1.5 border-t border-dashed pt-3">
          <div className="flex items-center justify-between">
            <Label className="text-xxs uppercase tracking-wide text-muted-foreground">
              Buttons
            </Label>
            <span className="text-xxs text-muted-foreground">
              {notification.buttons.length}/{MAX_BUTTONS} · merge fields OK
            </span>
          </div>
          {notification.buttons.length === 0 ? (
            <p className="text-xxs text-muted-foreground">
              Optional CTA buttons rendered below the message in Slack.
            </p>
          ) : (
            <div className="space-y-2">
              {notification.buttons.map((btn, idx) => (
                <div
                  key={btn._key}
                  className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto] items-center gap-2"
                >
                  <input
                    type="text"
                    value={btn.label}
                    onChange={(e) =>
                      onChange({
                        ...notification,
                        buttons: notification.buttons.map((b, i) =>
                          i === idx ? { ...b, label: e.target.value } : b,
                        ),
                      })
                    }
                    placeholder="View in Jira"
                    className={cn(INPUT_CLASS, "h-8 text-xs")}
                  />
                  <input
                    type="url"
                    value={btn.url}
                    onChange={(e) =>
                      onChange({
                        ...notification,
                        buttons: notification.buttons.map((b, i) =>
                          i === idx ? { ...b, url: e.target.value } : b,
                        ),
                      })
                    }
                    placeholder="https://…/{{release.id}}"
                    className={cn(INPUT_CLASS, "h-8 text-xs font-mono")}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      onChange({
                        ...notification,
                        buttons: notification.buttons.filter(
                          (_, i) => i !== idx,
                        ),
                      })
                    }
                    className="text-muted-foreground hover:text-destructive h-8 w-8 inline-flex items-center justify-center rounded-md hover:bg-destructive/10 transition-colors"
                    aria-label="Remove button"
                    title="Remove button"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {notification.buttons.length < MAX_BUTTONS && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={() =>
                onChange({
                  ...notification,
                  buttons: [...notification.buttons, freshButton()],
                })
              }
            >
              <Plus className="h-3 w-3" />
              Add button
            </Button>
          )}
        </div>

        <div className="space-y-1.5 border-t border-dashed pt-3">
          <Label className="text-xxs uppercase tracking-wide text-muted-foreground">
            Delivery
          </Label>
          <div className="grid grid-cols-[5rem_1fr] items-center gap-x-3 gap-y-2">
            <span className="text-xs text-muted-foreground">Send to</span>
            <SlackTargetPicker
              value={notification.target}
              onChange={(id) => onChange({ ...notification, target: id })}
            />
            <span />
            {targetMissing ? (
              <p className="text-xxs text-amber-700 dark:text-amber-400 inline-flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Pick a channel or person to send this event to.
              </p>
            ) : (
              <p className="text-xxs text-muted-foreground">
                Posts via Slack <code className="bg-muted px-1 rounded">chat.postMessage</code> using the server&apos;s bot token.
              </p>
            )}

            <span />
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={handleTest}
                disabled={
                  testing || targetMissing || !notification.message.trim()
                }
              >
                {testing ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Bell className="h-3 w-3" />
                )}
                Send test
              </Button>
              {testResult?.ok === true && (
                <span className="text-xxs text-green-600 dark:text-green-500">
                  Sent — check Slack
                </span>
              )}
              {testResult && testResult.ok === false && (
                <span className="text-xxs text-destructive">
                  {testResult.error}
                </span>
              )}
              {!testResult && (
                <span className="text-xxs text-muted-foreground">
                  Fires with sample data, prefixed <code className="bg-muted px-1 rounded">[TEST]</code>
                </span>
              )}
            </div>
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
  const [platformPrefixes, setPlatformPrefixes] = useState<string[]>([]);
  const [releaseTypes, setReleaseTypes] = useState<ReleaseType[]>([]);
  const [tasks, setTasks] = useState<DraftTask[]>([]);
  const [notifications, setNotifications] = useState<DraftNotification[]>([]);

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
        setPlatformPrefixes(t.platformPrefixes ?? []);
        setReleaseTypes(t.releaseTypes ?? []);
        setTasks((data.tasks ?? []).map(taskToRow));
        setNotifications(
          (data.notifications ?? []).map(notificationToRow),
        );
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
  }, [name, platformPrefixes, releaseTypes, tasks, notifications]);

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
        platformPrefixes: platformPrefixes.length > 0 ? platformPrefixes : null,
        releaseTypes: releaseTypes.length > 0 ? releaseTypes : null,
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
        notifications: notifications.map((n) => ({
          eventType: n.eventType,
          message: n.message,
          target: n.target.trim() || null,
          buttons: draftButtonsToApi(n.buttons),
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

          <div className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="name" className="text-xs">Name</Label>
              <input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <Label className="text-xs">Platforms</Label>
                <span className="text-xxs text-muted-foreground">
                  Part before <code className="bg-muted px-1 rounded">@</code>. Empty = any.
                </span>
              </div>
              <PlatformChipInput
                values={platformPrefixes}
                onChange={setPlatformPrefixes}
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <Label className="text-xs">Release types</Label>
                <span className="text-xxs text-muted-foreground">
                  Derived from semver. Empty = any.
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {RELEASE_TYPE_OPTIONS.map(({ value, label, hint }) => {
                  const active = releaseTypes.includes(value);
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() =>
                        setReleaseTypes((prev) =>
                          active
                            ? prev.filter((v) => v !== value)
                            : [...prev, value],
                        )
                      }
                      className={cn(
                        "inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border text-xs transition-colors",
                        active
                          ? "bg-primary/10 border-primary/40 text-foreground"
                          : "bg-background border-input text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <span className="font-medium">{label}</span>
                      <span className="text-[10px] font-mono opacity-60">{hint}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
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
                <div className="space-y-3">
                  {tasks.map((task) => (
                    <div
                      key={task._key}
                      className="rounded-xl border bg-card shadow-sm overflow-hidden"
                    >
                      <SortableTaskRow
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
                    </div>
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

        {/* Notifications */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Notifications
              </h2>
              <p className="text-xxs text-muted-foreground mt-0.5">
                Event-driven Slack webhooks. Fires when the selected lifecycle
                event happens for a matching release — not on a schedule.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() =>
                setNotifications((prev) => [...prev, freshNotification()])
              }
            >
              <Plus className="h-3.5 w-3.5" />
              Add notification
            </Button>
          </div>

          {notifications.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center space-y-2">
              <p className="text-sm text-muted-foreground">
                No notifications yet.
              </p>
              <p className="text-xxs text-muted-foreground">
                Add a rule to POST a Slack webhook when a release is created,
                its date changes, it&apos;s released, or a task fails.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {notifications.map((n) => (
                <NotificationRow
                  key={n._key}
                  notification={n}
                  onChange={(updated) =>
                    setNotifications((prev) =>
                      prev.map((x) => (x._key === updated._key ? updated : x)),
                    )
                  }
                  onDelete={() =>
                    setNotifications((prev) =>
                      prev.filter((x) => x._key !== n._key),
                    )
                  }
                />
              ))}
            </div>
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
