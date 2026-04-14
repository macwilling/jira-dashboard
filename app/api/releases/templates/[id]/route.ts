import { NextRequest, NextResponse } from "next/server";
import {
  getTemplate,
  updateTemplate,
  deleteTemplate,
  listTemplateTasks,
  replaceTemplateTasks,
} from "@/lib/releases/templates-store";
import {
  listTemplateNotifications,
  replaceTemplateNotifications,
} from "@/lib/releases/notifications-store";
import type {
  ActionType,
  ReleaseEventType,
  ReleaseType,
} from "@/lib/releases/types";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const [template, tasks, notifications] = await Promise.all([
      getTemplate(id),
      listTemplateTasks(id),
      listTemplateNotifications(id),
    ]);
    if (!template) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ template, tasks, notifications });
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
      platformPrefixes?: string[] | null;
      releaseTypes?: ReleaseType[] | null;
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
      notifications?: Array<{
        eventType: ReleaseEventType;
        message: string;
        target?: string | null;
        buttons?: Array<{ label: string; url: string }>;
      }>;
    };

    const template = await getTemplate(id);
    if (!template) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    const updateArgs: Parameters<typeof updateTemplate>[1] = { name: body.name };
    if ("platformPrefixes" in body) updateArgs.platformPrefixes = body.platformPrefixes ?? null;
    if ("releaseTypes" in body) updateArgs.releaseTypes = body.releaseTypes ?? null;
    await updateTemplate(id, updateArgs);

    if (body.tasks !== undefined) {
      await replaceTemplateTasks(id, body.tasks);
    }

    if (body.notifications !== undefined) {
      await replaceTemplateNotifications(id, body.notifications);
    }

    const [updated, tasks, notifications] = await Promise.all([
      getTemplate(id),
      listTemplateTasks(id),
      listTemplateNotifications(id),
    ]);

    return NextResponse.json({ template: updated, tasks, notifications });
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
