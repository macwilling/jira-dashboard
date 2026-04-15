import { NextRequest, NextResponse } from "next/server";
import {
  getRelease,
  setApprovalCancelled,
} from "@/lib/releases/store";
import { updateSlackMessage } from "@/lib/slack/client";
import { buildCancelledBlocks } from "@/lib/releases/approval-message";

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
    if (release.approvalStatus === "cancelled") {
      return NextResponse.json({ ok: true });
    }

    await setApprovalCancelled(release.id);

    if (release.approvalMessageChannel && release.approvalMessageTs) {
      try {
        const base =
          process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? req.nextUrl.origin;
        const msg = buildCancelledBlocks({
          release,
          cancelledByUserId: null,
          releaseUrl: `${base}/releases/${release.id}`,
        });
        await updateSlackMessage({
          channel: release.approvalMessageChannel,
          ts: release.approvalMessageTs,
          ...msg,
        });
      } catch (e) {
        console.warn("[manual cancel] chat.update failed", e);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
