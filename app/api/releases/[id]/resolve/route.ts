import { NextRequest, NextResponse } from "next/server";
import { resolveRelease, type ResolutionAction } from "@/lib/releases/resolution";

const VALID_ACTIONS: ResolutionAction[] = [
  "keep_original",
  "switch_workflow",
  "discard",
];

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const body = (await req.json().catch(() => ({}))) as {
      action?: ResolutionAction;
    };
    if (!body.action || !VALID_ACTIONS.includes(body.action)) {
      return NextResponse.json(
        { error: `action must be one of ${VALID_ACTIONS.join(", ")}` },
        { status: 400 },
      );
    }
    const result = await resolveRelease({
      releaseId: id,
      action: body.action,
      actor: "ui",
    });
    return NextResponse.json(result);
  } catch (e) {
    console.error("[POST /api/releases/[id]/resolve]", e);
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 },
    );
  }
}
