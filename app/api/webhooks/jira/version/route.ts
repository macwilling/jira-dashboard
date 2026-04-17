import { NextRequest, NextResponse } from "next/server";
import { handleVersionEvent } from "@/lib/releases/orchestrator";
import type {
  JiraVersionPayload,
  JiraVersionWebhookEvent,
} from "@/lib/releases/types";

/**
 * Receiver for Jira "version" webhooks (Fix Versions).
 *
 * Jira webhook setup:
 *   URL:    https://<your-domain>/api/webhooks/jira/version
 *   Events: Version created, updated, released, unreleased, deleted, moved, merged
 *   Header: X-Webhook-Secret: <value of JIRA_WEBHOOK_SECRET>
 *
 * This handler accepts the secret via either `X-Webhook-Secret` header OR
 * `?secret=` query param so you can use whichever fits your Jira setup.
 *
 * All real work lives in lib/releases/orchestrator.ts so the cron recovery
 * worker can share the same pipeline.
 */

interface VersionWebhookBody {
  webhookEvent?: JiraVersionWebhookEvent;
  version?: JiraVersionPayload;
}

function verifySecret(req: NextRequest): boolean {
  const expected = process.env.JIRA_WEBHOOK_SECRET;
  if (!expected) {
    if (process.env.NODE_ENV === "production") {
      console.error(
        "[jira/version webhook] JIRA_WEBHOOK_SECRET is not set — rejecting request",
      );
      return false;
    }
    return true; // dev only: skip verification
  }

  const headerSecret = req.headers.get("x-webhook-secret");
  const querySecret = req.nextUrl.searchParams.get("secret");
  return headerSecret === expected || querySecret === expected;
}

export async function POST(req: NextRequest) {
  if (!verifySecret(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: VersionWebhookBody;
  try {
    body = (await req.json()) as VersionWebhookBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const { webhookEvent, version } = body;

  if (!webhookEvent || !webhookEvent.startsWith("jira:version_")) {
    return NextResponse.json(
      { error: `unexpected webhookEvent: ${webhookEvent ?? "missing"}` },
      { status: 400 },
    );
  }
  if (!version || !version.id) {
    return NextResponse.json(
      { error: "missing version payload" },
      { status: 400 },
    );
  }

  try {
    const result = await handleVersionEvent({
      payload: version,
      webhookEvent,
      rawBody: body,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("[webhook jira version] failed", e);
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 },
    );
  }
}

// Health check — useful when setting up the webhook in Jira.
export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "jira version webhook receiver",
    secretConfigured: !!process.env.JIRA_WEBHOOK_SECRET,
  });
}
