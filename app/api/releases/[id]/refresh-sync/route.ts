import { NextRequest, NextResponse } from "next/server";
import { refreshSyncStatus } from "@/lib/releases/dispatcher";
import { listTaskInstances } from "@/lib/releases/templates-store";
import { computeSyncState, summarizeSyncStates } from "@/lib/releases/sync-state";

/**
 * POST — re-probe Google for every dispatched task in this release and update
 * local sync state (missing, drifted, synced). Returns the refreshed instances.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    await refreshSyncStatus(id);
    const instances = await listTaskInstances(id);
    const withState = instances.map((i) => ({ ...i, syncState: computeSyncState(i) }));
    return NextResponse.json({
      taskInstances: withState,
      syncSummary: summarizeSyncStates(instances),
    });
  } catch (e) {
    console.error("[refresh-sync]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
