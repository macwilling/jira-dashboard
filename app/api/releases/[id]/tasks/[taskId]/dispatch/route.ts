import { NextRequest, NextResponse } from "next/server";
import {
  getTaskInstance,
  updateTaskInstanceStatus,
} from "@/lib/releases/task-instances-store";
import { dispatchInstance } from "@/lib/releases/dispatcher";

/**
 * POST — manual retry of a single task's dispatch action. Normally auto-runs
 * via the webhook; this is the "Create task" button users hit after fixing
 * a Google connection error.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> },
) {
  const { taskId } = await params;

  try {
    const instance = await getTaskInstance(taskId);
    if (!instance) {
      return NextResponse.json(
        { error: "task instance not found" },
        { status: 404 },
      );
    }

    if (instance.actionType === "manual") {
      await updateTaskInstanceStatus(taskId, "done");
      return NextResponse.json({ ok: true, action: "manual" });
    }

    const result = await dispatchInstance(instance);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

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
