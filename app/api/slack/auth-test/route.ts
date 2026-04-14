import { NextResponse } from "next/server";
import { hasSlackBotToken, slackAuthTest } from "@/lib/slack/client";

export const dynamic = "force-dynamic";

/**
 * GET /api/slack/auth-test — verify the server's bot token is valid and
 * report the team + bot identity for the Settings page indicator.
 *
 * Never returns the token itself. Only returns data Slack's auth.test
 * endpoint already considers public within the workspace.
 */
export async function GET() {
  if (!hasSlackBotToken()) {
    return NextResponse.json(
      { ok: false, configured: false, error: "SLACK_BOT_TOKEN is not set" },
      { status: 503 },
    );
  }
  try {
    const info = await slackAuthTest();
    return NextResponse.json({
      ok: true,
      configured: true,
      team: info.team,
      teamId: info.teamId,
      user: info.user,
      userId: info.userId,
      url: info.url,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, configured: true, error: (e as Error).message },
      { status: 500 },
    );
  }
}
