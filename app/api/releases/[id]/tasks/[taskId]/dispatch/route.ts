import { NextRequest, NextResponse } from "next/server";
import { d1Query } from "@/lib/d1/client";
import { updateTaskInstanceStatus } from "@/lib/releases/templates-store";
import { dispatchInstance } from "@/lib/releases/dispatcher";
import type { ReleaseTaskInstance } from "@/lib/releases/types";

interface TaskInstanceRow {
  id: string;
  release_id: string;
  template_task_id: string;
  template_id: string;
  label: string;
  description: string | null;
  action_type: string;
  day_offset: number;
  all_day: number;
  start_time: string | null;
  duration_minutes: number;
  due_date: string | null;
  status: string;
  action_config: string | null;
  external_id: string | null;
  external_url: string | null;
  last_dispatch_error: string | null;
  last_dispatch_at: string | null;
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
    description: row.description,
    actionType: row.action_type as ReleaseTaskInstance["actionType"],
    dayOffset: row.day_offset,
    allDay: row.all_day === 1,
    startTime: row.start_time,
    durationMinutes: row.duration_minutes,
    dueDate: row.due_date,
    status: row.status as ReleaseTaskInstance["status"],
    actionConfig,
    externalId: row.external_id,
    externalUrl: row.external_url,
    lastDispatchError: row.last_dispatch_error,
    lastDispatchAt: row.last_dispatch_at,
    createdAt: "",
    updatedAt: "",
  };
}

/**
 * POST — manual retry of a single task's dispatch action. Normally auto-runs
 * via the webhook; this is the "Create task" button users hit after fixing
 * a Google connection error.
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
      await updateTaskInstanceStatus(taskId, "done");
      return NextResponse.json({ ok: true, action: "manual" });
    }

    const result = await dispatchInstance(instance);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    // Re-read so we can return the persisted external ref.
    const updated = await getTaskInstance(taskId);
    return NextResponse.json({
      ok: true,
      action: instance.actionType,
      externalId: updated?.externalId,
      externalUrl: updated?.externalUrl,
    });
  } catch (e) {
    console.error("[dispatch]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
