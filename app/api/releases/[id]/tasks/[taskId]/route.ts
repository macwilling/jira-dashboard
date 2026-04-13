import { NextRequest, NextResponse } from "next/server";
import { updateTaskInstanceStatus } from "@/lib/releases/templates-store";
import type { TaskInstanceStatus } from "@/lib/releases/types";

const VALID_STATUSES = new Set<TaskInstanceStatus>(["pending", "done", "skipped"]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> }
) {
  const { taskId } = await params;
  try {
    const body = (await req.json()) as { status?: string };
    const status = body.status as TaskInstanceStatus;

    if (!VALID_STATUSES.has(status)) {
      return NextResponse.json(
        { error: "status must be pending, done, or skipped" },
        { status: 400 }
      );
    }

    await updateTaskInstanceStatus(taskId, status);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
