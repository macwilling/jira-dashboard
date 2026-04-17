import { NextRequest, NextResponse } from "next/server";
import { getTaskInstance } from "@/lib/releases/task-instances-store";
import { pushInstanceToGoogle } from "@/lib/releases/dispatcher";

/**
 * POST — force-update Google to match this row's expected (Jira-derived)
 * date/time, clearing drift. Used when someone moved the event in Google and
 * we want Jira/app to win.
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
    const result = await pushInstanceToGoogle(instance);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[push-to-google]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
