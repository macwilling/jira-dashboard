import { NextRequest, NextResponse } from "next/server";
import {
  getRelease,
  setApprovalApproved,
} from "@/lib/releases/store";
import {
  autoDispatchPendingInstances,
} from "@/lib/releases/dispatcher";
import { updateSlackMessage } from "@/lib/slack/client";
import { listTaskInstances } from "@/lib/releases/task-instances-store";
import { buildApprovedBlocks } from "@/lib/releases/approval-message";

/**
 * Manual approval from the release detail page. Belt-and-suspenders for when
 * the Slack interactive path fails (bot kicked from channel, signing secret
 * misconfigured, etc.). Does the same work as the Slack endpoint: marks the
 * release approved, dispatches pending instances, updates the Slack message
 * if one exists.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const release = await getRelease(id);
    if (!release) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    // Allow manual approve from any pending-ish state — the user is explicitly
    // overriding. Silently no-op if already approved.
    if (release.approvalStatus === "approved") {
      return NextResponse.json({ ok: true });
    }

    await setApprovalApproved(release.id, null);
    await autoDispatchPendingInstances(release.id).catch((err) =>
      console.warn("[manual approve] dispatch failed", err),
    );

    if (release.approvalMessageChannel && release.approvalMessageTs) {
      try {
        const instances = await listTaskInstances(release.id);
        const base =
          process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? req.nextUrl.origin;
        const msg = buildApprovedBlocks({
          release,
          approvedByUserId: null, // manual approval from the app has no Slack user
          approvedAt: new Date().toISOString(),
          taskCount: instances.length,
          releaseUrl: `${base}/releases/${release.id}`,
        });
        await updateSlackMessage({
          channel: release.approvalMessageChannel,
          ts: release.approvalMessageTs,
          ...msg,
        });
      } catch (e) {
        console.warn("[manual approve] chat.update failed", e);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
