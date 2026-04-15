import { NextRequest, NextResponse } from "next/server";
import {
  getTaskDefinition,
  updateTaskDefinition,
  deleteTaskDefinition,
} from "@/lib/releases/task-definitions-store";
import { countWorkflowTasksUsingDefinition as countTemplateTasksUsingDefinition } from "@/lib/releases/workflows-store";
import type {
  ActionType,
  ConfigurableField,
} from "@/lib/releases/types";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const definition = await getTaskDefinition(id);
    if (!definition) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    const usageCount = await countTemplateTasksUsingDefinition(id);
    return NextResponse.json({ definition, usageCount });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const body = (await req.json()) as {
      name?: string;
      label?: string;
      description?: string | null;
      actionType?: ActionType;
      dayOffset?: number;
      allDay?: boolean;
      startTime?: string | null;
      durationMinutes?: number;
      actionConfig?: Record<string, unknown> | null;
      configurableFields?: ConfigurableField[];
    };
    const existing = await getTaskDefinition(id);
    if (!existing) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    await updateTaskDefinition(id, body);
    const updated = await getTaskDefinition(id);
    return NextResponse.json({ definition: updated });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const detach = req.nextUrl.searchParams.get("detachLinked") === "1";
  try {
    await deleteTaskDefinition(id, { detachLinked: detach });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      // 409 Conflict when linked tasks block deletion; any other failure 500.
      { status: (e as Error).message.startsWith("Cannot delete") ? 409 : 500 },
    );
  }
}
