import { NextRequest, NextResponse } from "next/server";
import { getRelease } from "@/lib/releases/store";
import { getCategory } from "@/lib/releases/categories";
import {
  getWorkflow,
  listWorkflowTasks,
} from "@/lib/releases/workflows-store";
import { listTaskInstances } from "@/lib/releases/task-instances-store";
import {
  computeSyncState,
  summarizeSyncStates,
} from "@/lib/releases/sync-state";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const release = await getRelease(id);
    if (!release) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    const category = release.categoryId
      ? await getCategory(release.categoryId)
      : null;
    const workflow = category?.workflowId
      ? await getWorkflow(category.workflowId)
      : null;

    const [instances, workflowTasks] = await Promise.all([
      listTaskInstances(id),
      workflow ? listWorkflowTasks(workflow.id) : Promise.resolve([]),
    ]);

    const withState = instances.map((i) => ({
      ...i,
      syncState: computeSyncState(i),
    }));

    return NextResponse.json({
      release,
      category,
      workflow,
      expectedTaskCount: workflowTasks.length,
      taskInstances: withState,
      syncSummary: summarizeSyncStates(instances),
    });
  } catch (e) {
    console.error("[GET /api/releases/[id]]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
