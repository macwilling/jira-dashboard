import { NextRequest, NextResponse } from "next/server";
import { getRelease } from "@/lib/releases/store";
import {
  listTaskInstances,
  regenerateTaskInstances,
  listTemplates,
} from "@/lib/releases/templates-store";
import { matchTemplates } from "@/lib/releases/matcher";
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

/** POST — regenerate task instances for this release from every matching template. */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const release = await getRelease(id);
    if (!release) {
      return NextResponse.json({ error: "release not found" }, { status: 404 });
    }

    const templates = await listTemplates();
    const matched = matchTemplates(release.name, templates);
    if (matched.length === 0) {
      return NextResponse.json(
        { error: "no matching template found" },
        { status: 422 }
      );
    }

    await regenerateTaskInstances(release);

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
