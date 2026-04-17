import { NextRequest, NextResponse } from "next/server";
import {
  getCategory,
  listCategories,
  setCategoryWorkflow,
} from "@/lib/releases/categories";
import { getWorkflow, listWorkflows } from "@/lib/releases/workflows-store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [categories, workflows] = await Promise.all([
      listCategories(),
      listWorkflows(),
    ]);
    const workflowsById = new Map(workflows.map((w) => [w.id, w]));
    const enriched = categories.map((c) => ({
      ...c,
      workflow: c.workflowId
        ? workflowsById.get(c.workflowId)
          ? {
              id: c.workflowId,
              name: workflowsById.get(c.workflowId)!.name,
            }
          : null
        : null,
    }));
    return NextResponse.json({
      categories: enriched,
      workflows: workflows.map((w) => ({ id: w.id, name: w.name })),
    });
  } catch (e) {
    console.error("[GET /api/releases/categories]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      categoryId?: string;
      workflowId?: string | null;
    };
    if (!body.categoryId) {
      return NextResponse.json(
        { error: "categoryId is required" },
        { status: 400 },
      );
    }
    const category = await getCategory(body.categoryId);
    if (!category) {
      return NextResponse.json({ error: "category not found" }, { status: 404 });
    }
    const targetWorkflowId = body.workflowId ?? null;
    if (targetWorkflowId) {
      const workflow = await getWorkflow(targetWorkflowId);
      if (!workflow) {
        return NextResponse.json(
          { error: "workflow not found" },
          { status: 404 },
        );
      }
    }
    await setCategoryWorkflow(body.categoryId, targetWorkflowId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[PATCH /api/releases/categories]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
