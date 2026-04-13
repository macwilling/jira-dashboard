import { NextRequest, NextResponse } from "next/server";
import { d1Query } from "@/lib/d1/client";
import { updateTaskInstanceStatus } from "@/lib/releases/templates-store";
import { createGoogleTask, createCalendarEvent } from "@/lib/google/client";
import type { ReleaseTaskInstance } from "@/lib/releases/types";

interface TaskInstanceRow {
  id: string;
  release_id: string;
  template_task_id: string;
  template_id: string;
  label: string;
  action_type: string;
  day_offset: number;
  due_date: string | null;
  status: string;
  action_config: string | null;
}

async function getTaskInstance(id: string): Promise<ReleaseTaskInstance | null> {
  const { results } = await d1Query<TaskInstanceRow>(
    `SELECT * FROM release_task_instances WHERE id = ? LIMIT 1`,
    [id]
  );
  const row = results[0];
  if (!row) return null;

  let actionConfig: Record<string, unknown> | null = null;
  if (row.action_config) {
    try { actionConfig = JSON.parse(row.action_config); } catch { /* ignore */ }
  }

  return {
    id: row.id,
    releaseId: row.release_id,
    templateTaskId: row.template_task_id,
    templateId: row.template_id,
    label: row.label,
    actionType: row.action_type as ReleaseTaskInstance["actionType"],
    dayOffset: row.day_offset,
    dueDate: row.due_date,
    status: row.status as ReleaseTaskInstance["status"],
    actionConfig,
    createdAt: "",
    updatedAt: "",
  };
}

/**
 * POST — dispatches the action for a task instance (creates Google Task or Calendar event).
 * Marks the instance as "done" on success.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> }
) {
  const { taskId } = await params;

  try {
    const instance = await getTaskInstance(taskId);
    if (!instance) {
      return NextResponse.json({ error: "task instance not found" }, { status: 404 });
    }

    if (instance.actionType === "manual") {
      // Manual tasks have nothing to dispatch; just mark done
      await updateTaskInstanceStatus(taskId, "done");
      return NextResponse.json({ ok: true, action: "manual" });
    }

    const config = instance.actionConfig ?? {};

    if (instance.actionType === "google_task") {
      const taskListId = (config.taskListId as string | undefined) ?? "@default";
      const externalId = await createGoogleTask(
        taskListId,
        instance.label,
        instance.dueDate
      );
      await updateTaskInstanceStatus(taskId, "done");
      return NextResponse.json({ ok: true, action: "google_task", externalId });
    }

    if (instance.actionType === "calendar_event") {
      const calendarId = (config.calendarId as string | undefined) ?? "primary";
      if (!instance.dueDate) {
        return NextResponse.json(
          { error: "cannot create calendar event: no due date on this task" },
          { status: 422 }
        );
      }
      const externalId = await createCalendarEvent(
        calendarId,
        instance.label,
        instance.dueDate
      );
      await updateTaskInstanceStatus(taskId, "done");
      return NextResponse.json({ ok: true, action: "calendar_event", externalId });
    }

    return NextResponse.json(
      { error: `action_type "${instance.actionType}" is not yet supported` },
      { status: 422 }
    );
  } catch (e) {
    console.error("[dispatch]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
