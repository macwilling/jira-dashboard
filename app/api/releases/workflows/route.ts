import { NextRequest, NextResponse } from "next/server";
import {
  createWorkflow,
  listWorkflows,
  listWorkflowTasks,
  listWorkflowNotifications,
} from "@/lib/releases/workflows-store";
import { listCategories } from "@/lib/releases/categories";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [workflows, categories] = await Promise.all([
      listWorkflows(),
      listCategories(),
    ]);

    const categoriesByWorkflow = new Map<string, { id: string; key: string }[]>();
    for (const c of categories) {
      if (!c.workflowId) continue;
      const arr = categoriesByWorkflow.get(c.workflowId) ?? [];
      arr.push({ id: c.id, key: c.key });
      categoriesByWorkflow.set(c.workflowId, arr);
    }

    const enriched = await Promise.all(
      workflows.map(async (w) => {
        const [tasks, notifications] = await Promise.all([
          listWorkflowTasks(w.id),
          listWorkflowNotifications(w.id),
        ]);
        return {
          ...w,
          taskCount: tasks.length,
          notificationCount: notifications.length,
          categories: categoriesByWorkflow.get(w.id) ?? [],
        };
      }),
    );

    return NextResponse.json({ workflows: enriched });
  } catch (e) {
    console.error("[GET /api/releases/workflows]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      name?: string;
      approvalSlackTarget?: string | null;
    };
    const name = body.name?.trim();
    if (!name) {
      return NextResponse.json(
        { error: "name is required" },
        { status: 400 },
      );
    }
    const created = await createWorkflow({
      name,
      approvalSlackTarget: body.approvalSlackTarget ?? null,
    });
    return NextResponse.json({ workflow: created });
  } catch (e) {
    console.error("[POST /api/releases/workflows]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
