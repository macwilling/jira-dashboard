import { NextResponse } from "next/server";
import { hasSlackBotToken, listSlackUsers } from "@/lib/slack/client";

export const dynamic = "force-dynamic";

/**
 * GET /api/slack/users — list human (non-bot, non-deleted) users.
 *
 * Projection is locked down in lib/slack/client.ts#listSlackUsers: only
 * id, name, displayName, avatar. Emails, phones, titles, statuses are
 * dropped before leaving the server.
 */
export async function GET() {
  if (!hasSlackBotToken()) {
    return NextResponse.json(
      { error: "SLACK_BOT_TOKEN is not configured", users: [] },
      { status: 503 },
    );
  }
  try {
    const users = await listSlackUsers();
    return NextResponse.json({ users });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message, users: [] },
      { status: 500 },
    );
  }
}
