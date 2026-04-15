import { NextResponse } from "next/server";
import { listReleases } from "@/lib/releases/store";
import { listTaskInstances } from "@/lib/releases/task-instances-store";
import { listCategories } from "@/lib/releases/categories";
import { listWorkflows } from "@/lib/releases/workflows-store";
import { summarizeSyncStates } from "@/lib/releases/sync-state";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [releases, categories, workflows] = await Promise.all([
      listReleases(),
      listCategories(),
      listWorkflows(),
    ]);

    const categoriesById = new Map(categories.map((c) => [c.id, c]));
    const workflowsById = new Map(workflows.map((w) => [w.id, w]));

    const result = await Promise.all(
      releases.map(async (release) => {
        const category = release.categoryId
          ? categoriesById.get(release.categoryId) ?? null
          : null;
        const workflow = category?.workflowId
          ? workflowsById.get(category.workflowId) ?? null
          : null;
        const instances = await listTaskInstances(release.id);
        return {
          ...release,
          category: category
            ? { id: category.id, key: category.key }
            : null,
          workflow: workflow ? { id: workflow.id, name: workflow.name } : null,
          syncSummary: summarizeSyncStates(instances),
        };
      }),
    );

    return NextResponse.json({ releases: result });
  } catch (e) {
    console.error("[GET /api/releases]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
