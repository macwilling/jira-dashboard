import { NextRequest, NextResponse } from "next/server";
import { verifySlackSignature } from "@/lib/slack/signing";
import { openSlackModal } from "@/lib/slack/client";
import { buildRequestTypeView } from "@/lib/slack/support-modals";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  const sig = req.headers.get("x-slack-signature");
  const tsHeader = req.headers.get("x-slack-request-timestamp");

  if (!process.env.SLACK_SIGNING_SECRET) {
    return NextResponse.json(
      { error: "SLACK_SIGNING_SECRET not configured" },
      { status: 503 },
    );
  }

  const ok = verifySlackSignature({ rawBody, signature: sig, timestamp: tsHeader });
  if (!ok) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  const params = new URLSearchParams(rawBody);
  const triggerId = params.get("trigger_id");

  if (!triggerId) {
    return NextResponse.json({ error: "missing trigger_id" }, { status: 400 });
  }

  try {
    await openSlackModal(triggerId, buildRequestTypeView());
  } catch (e) {
    console.error("[slack command] openModal failed", e);
    return NextResponse.json(
      { response_type: "ephemeral", text: `Failed to open form: ${(e as Error).message}` },
      { status: 200 },
    );
  }

  // Empty 200 — modal opens in Slack, no visible channel response needed.
  return new NextResponse(null, { status: 200 });
}
