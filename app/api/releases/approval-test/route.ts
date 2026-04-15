import { NextRequest, NextResponse } from "next/server";
import { hasSlackBotToken, postSlackMessage } from "@/lib/slack/client";
import { hasSlackSigningSecret } from "@/lib/slack/signing";
import { buildTestInitialBlocks } from "@/lib/releases/approval-message";

/**
 * Settings-page "Test round-trip" endpoint.
 *
 * Posts a throwaway approval-style message to a Slack target. The buttons on
 * that message have distinct action_ids (approval_test_approve/cancel) so the
 * interactive endpoint can recognize them and edit the message in place —
 * without touching any real release.
 *
 * The test target comes from the request body so the UI can let the user try
 * a picked-but-not-yet-saved value. Auth is enforced at the edge (Cloudflare
 * Access) for the whole app; no in-app auth check needed here.
 */
export async function POST(req: NextRequest) {
  if (!hasSlackBotToken()) {
    return NextResponse.json(
      { error: "SLACK_BOT_TOKEN not configured" },
      { status: 400 },
    );
  }

  let body: { target?: string } = {};
  try {
    body = (await req.json()) as { target?: string };
  } catch {
    // empty body is fine — just means no target provided
  }
  const target = body.target?.trim();
  if (!target) {
    return NextResponse.json(
      { error: "target is required (channel C…/G… or user U…)" },
      { status: 400 },
    );
  }

  const signingConfigured = hasSlackSigningSecret();
  const appUrlConfigured = !!process.env.NEXT_PUBLIC_APP_URL;

  // Short random token for the message — carried through button value so if
  // the user rapid-fires test sends, each message is individually identifiable
  // in the audit log.
  const token = Math.random().toString(36).slice(2, 10);

  try {
    const msg = buildTestInitialBlocks({ token });
    const posted = await postSlackMessage({ channel: target, ...msg });
    return NextResponse.json({
      ok: true,
      token,
      messageTs: posted.ts,
      channel: posted.channel,
      warnings: [
        !signingConfigured &&
          "SLACK_SIGNING_SECRET is not set — button clicks will be rejected by the interactive endpoint until you add it.",
        !appUrlConfigured &&
          "NEXT_PUBLIC_APP_URL is not set — Slack's Request URL must point to a publicly-reachable instance of this app for buttons to work.",
      ].filter(Boolean),
    });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 },
    );
  }
}
