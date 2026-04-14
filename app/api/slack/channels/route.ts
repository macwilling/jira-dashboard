import { NextResponse } from "next/server";
import { hasSlackBotToken, listSlackChannels } from "@/lib/slack/client";

export const dynamic = "force-dynamic";

/**
 * GET /api/slack/channels — list channels the bot can see.
 *
 * Returns { id, name, isPrivate, isMember }. No raw profile fields,
 * topic, purpose, or member lists. Safe to return to the browser.
 */
export async function GET() {
  if (!hasSlackBotToken()) {
    return NextResponse.json(
      { error: "SLACK_BOT_TOKEN is not configured", channels: [] },
      { status: 503 },
    );
  }
  try {
    const channels = await listSlackChannels();
    return NextResponse.json({ channels });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message, channels: [] },
      { status: 500 },
    );
  }
}
