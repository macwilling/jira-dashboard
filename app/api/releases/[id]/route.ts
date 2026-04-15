import { NextRequest, NextResponse } from "next/server";
import { getRelease } from "@/lib/releases/store";
import {
  listTemplates,
  listTaskInstances,
  listTemplateTasks,
} from "@/lib/releases/templates-store";
import { matchTemplates } from "@/lib/releases/matcher";
import { computeSyncState, summarizeSyncStates } from "@/lib/releases/sync-state";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const [release, templates] = await Promise.all([
      getRelease(id),
      listTemplates(),
    ]);

    if (!release) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    const matched = matchTemplates(release.name, templates);
    const [instances, taskCounts] = await Promise.all([
      listTaskInstances(id),
      Promise.all(matched.map((t) => listTemplateTasks(t.id).then((r) => r.length))),
    ]);
    const expectedTaskCount = taskCounts.reduce((s, n) => s + n, 0);

    const withState = instances.map((i) => ({ ...i, syncState: computeSyncState(i) }));

    return NextResponse.json({
      release,
      matchedTemplates: matched,
      expectedTaskCount,
      taskInstances: withState,
      syncSummary: summarizeSyncStates(instances),
    });
  } catch (e) {
    console.error("[GET /api/releases/[id]]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
