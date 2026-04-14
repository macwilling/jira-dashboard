import { NextRequest, NextResponse } from "next/server";
import {
  buildSampleMergeContext,
  renderMergeFields,
} from "@/lib/releases/merge-fields";
import { buildSlackMessage } from "@/lib/releases/notification-blocks";
import { hasSlackBotToken, postSlackMessage } from "@/lib/slack/client";
import type {
  NotificationButton,
  ReleaseEventType,
} from "@/lib/releases/types";

/**
 * POST — fire a sample Slack message for a draft notification rule.
 *
 * Used by the "Send test" button in the template editor so users can verify
 * their Slack integration end-to-end without waiting for a real release event.
 * The rendered text is prefixed with `[TEST]` so receivers can tell real fires
 * from tests. Any CTA buttons on the rule are rendered too.
 */
export async function POST(req: NextRequest) {
  try {
    if (!hasSlackBotToken()) {
      return NextResponse.json(
        {
          error:
            "SLACK_BOT_TOKEN is not configured. Add it to the server env and redeploy.",
        },
        { status: 503 },
      );
    }

    const body = (await req.json()) as {
      eventType?: ReleaseEventType;
      message?: string;
      target?: string | null;
      buttons?: NotificationButton[];
    };

    if (!body.eventType || !body.message) {
      return NextResponse.json(
        { error: "eventType and message are required" },
        { status: 400 },
      );
    }

    const target = body.target?.trim() || "";
    if (!target) {
      return NextResponse.json(
        { error: "Pick a Slack channel or user for this rule before testing." },
        { status: 400 },
      );
    }
    if (!/^[CGDU][A-Z0-9]{5,}$/.test(target)) {
      return NextResponse.json(
        {
          error: `"${target}" is not a valid Slack channel or user ID (expected C…, G…, D…, or U…).`,
        },
        { status: 400 },
      );
    }

    const ctx = buildSampleMergeContext();
    const rendered = renderMergeFields(body.message, ctx) ?? body.message;
    const text = `[TEST] ${rendered}`;

    const payload = buildSlackMessage({
      text,
      buttons: body.buttons ?? [],
      ctx,
    });

    await postSlackMessage({ channel: target, ...payload });

    return NextResponse.json({ ok: true, renderedText: text });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 },
    );
  }
}
