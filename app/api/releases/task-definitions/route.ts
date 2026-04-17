import { NextRequest, NextResponse } from "next/server";
import {
  listTaskDefinitions,
  createTaskDefinition,
} from "@/lib/releases/task-definitions-store";
import type {
  ActionType,
  ConfigurableField,
} from "@/lib/releases/types";

export async function GET() {
  try {
    const definitions = await listTaskDefinitions();
    return NextResponse.json({ definitions });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
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
    if (!body.name?.trim() || !body.label?.trim() || !body.actionType) {
      return NextResponse.json(
        { error: "name, label, and actionType are required" },
        { status: 400 },
      );
    }
    const created = await createTaskDefinition({
      name: body.name.trim(),
      label: body.label,
      description: body.description ?? null,
      actionType: body.actionType,
      dayOffset: body.dayOffset,
      allDay: body.allDay,
      startTime: body.startTime,
      durationMinutes: body.durationMinutes,
      actionConfig: body.actionConfig,
      configurableFields: body.configurableFields,
    });
    return NextResponse.json({ definition: created });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
