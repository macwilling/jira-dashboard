import { NextRequest, NextResponse } from "next/server";
import { getRelease } from "@/lib/releases/store";
import {
  listTaskInstances,
  regenerateTaskInstances,
  listTemplates,
} from "@/lib/releases/templates-store";
import { matchTemplate } from "@/lib/releases/matcher";
import { autoDispatchPendingInstances } from "@/lib/releases/dispatcher";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const instances = await listTaskInstances(id);
    return NextResponse.json({ taskInstances: instances });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/** POST — regenerate task instances for this release from the matched template. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await req.json().catch(() => ({})) as { templateId?: string };

    const release = await getRelease(id);
    if (!release) {
      return NextResponse.json({ error: "release not found" }, { status: 404 });
    }

    let templateId = body.templateId;
    if (!templateId) {
      const templates = await listTemplates();
      const matched = matchTemplate(release.name, templates);
      if (!matched) {
        return NextResponse.json(
          { error: "no matching template found" },
          { status: 422 }
        );
      }
      templateId = matched.id;
    }

    await regenerateTaskInstances(release, templateId);

    // Auto-dispatch any newly-created Google Task / Calendar rows so the user
    // doesn't have to click "Create" per row after regenerating.
    await autoDispatchPendingInstances(id).catch((err) =>
      console.warn("[regenerate] autoDispatchPendingInstances failed", err),
    );

    // Re-read to include any external refs set during auto-dispatch.
    const instances = await listTaskInstances(id);
    return NextResponse.json({ taskInstances: instances });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
