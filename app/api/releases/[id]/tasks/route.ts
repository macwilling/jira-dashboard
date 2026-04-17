import { NextRequest, NextResponse } from "next/server";
import { getRelease } from "@/lib/releases/store";
import { getCategory } from "@/lib/releases/categories";
import { getWorkflow } from "@/lib/releases/workflows-store";
import {
  listTaskInstances,
  regenerateTaskInstances,
} from "@/lib/releases/task-instances-store";
import { autoDispatchPendingInstances } from "@/lib/releases/dispatcher";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const instances = await listTaskInstances(id);
    return NextResponse.json({ taskInstances: instances });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/**
 * POST — regenerate task instances for this release from its assigned
 * workflow. Refuses if the release has no category, or its category has no
 * workflow — those are the "unmatched" states that should be resolved in Jira
 * (or via the categories UI) before regenerating.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const release = await getRelease(id);
    if (!release) {
      return NextResponse.json(
        { error: "release not found" },
        { status: 404 },
      );
    }

    if (!release.categoryId) {
      return NextResponse.json(
        { error: "release is unmatched — no category assigned" },
        { status: 422 },
      );
    }

    const category = await getCategory(release.categoryId);
    if (!category?.workflowId) {
      return NextResponse.json(
        {
          error: `category "${category?.key ?? release.categoryId}" has no workflow assigned`,
        },
        { status: 422 },
      );
    }

    const workflow = await getWorkflow(category.workflowId);
    if (!workflow) {
      return NextResponse.json(
        { error: "assigned workflow not found" },
        { status: 422 },
      );
    }

    await regenerateTaskInstances(release, workflow.id);

    await autoDispatchPendingInstances(id).catch((err) =>
      console.warn("[regenerate] autoDispatchPendingInstances failed", err),
    );

    const instances = await listTaskInstances(id);
    return NextResponse.json({ taskInstances: instances });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
