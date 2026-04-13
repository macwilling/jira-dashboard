import { NextRequest, NextResponse } from "next/server";
import {
  getTemplate,
  updateTemplate,
  deleteTemplate,
  listTemplateTasks,
  replaceTemplateTasks,
} from "@/lib/releases/templates-store";
import type { ActionType, ReleaseType } from "@/lib/releases/types";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const [template, tasks] = await Promise.all([
      getTemplate(id),
      listTemplateTasks(id),
    ]);
    if (!template) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ template, tasks });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = (await req.json()) as {
      name?: string;
      platformPrefix?: string | null;
      releaseType?: ReleaseType | null;
      tasks?: Array<{
        label: string;
        description?: string | null;
        actionType: ActionType;
        dayOffset: number;
        allDay?: boolean;
        startTime?: string | null;
        durationMinutes?: number;
        actionConfig?: Record<string, unknown> | null;
      }>;
    };

    const template = await getTemplate(id);
    if (!template) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    await updateTemplate(id, {
      name: body.name,
      platformPrefix: body.platformPrefix,
      releaseType: body.releaseType,
    });

    if (body.tasks !== undefined) {
      await replaceTemplateTasks(id, body.tasks);
    }

    const [updated, tasks] = await Promise.all([
      getTemplate(id),
      listTemplateTasks(id),
    ]);

    return NextResponse.json({ template: updated, tasks });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await deleteTemplate(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
