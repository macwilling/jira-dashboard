import { NextRequest, NextResponse } from "next/server";
import {
  deleteRelease,
  upsertRelease,
  getRelease,
} from "@/lib/releases/store";
import {
  cascadeTaskDates,
  maybeGenerateInstances,
} from "@/lib/releases/templates-store";
import type {
  JiraVersionPayload,
  JiraVersionWebhookEvent,
} from "@/lib/releases/types";

/**
 * Receiver for Jira "version" webhooks (Fix Versions).
 *
 * Jira webhook setup:
 *   URL:    https://<your-vercel-domain>/api/webhooks/jira/version
 *   Events: Version created, updated, released, unreleased, deleted, moved, merged
 *   Header: X-Webhook-Secret: <value of JIRA_WEBHOOK_SECRET>
 *
 * Note: Jira's native webhook UI doesn't let you set custom headers. Options:
 *   - Use an automation rule ("Send web request" action) which supports headers
 *   - Or embed the secret in the URL as a query param (?secret=...) — less clean
 *   - Or skip verification for now (not recommended for production)
 *
 * This handler accepts the secret via either `X-Webhook-Secret` header OR
 * `?secret=` query param so you can use whichever fits your Jira setup.
 */

interface VersionWebhookBody {
  webhookEvent?: JiraVersionWebhookEvent;
  version?: JiraVersionPayload;
}

function verifySecret(req: NextRequest): boolean {
  const expected = process.env.JIRA_WEBHOOK_SECRET;
  if (!expected) return true; // not configured → skip verification (dev mode)

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
      { status: 400 }
    );
  }

  if (!version || !version.id) {
    return NextResponse.json(
      { error: "missing version payload" },
      { status: 400 }
    );
  }

  try {
    if (webhookEvent === "jira:version_deleted") {
      await deleteRelease(String(version.id));
      return NextResponse.json({ ok: true, action: "deleted", id: version.id });
    }

    // Capture old release_date before upserting
    const previousRelease = await getRelease(String(version.id)).catch(() => null);
    const previousDate = previousRelease?.releaseDate ?? null;
    const isNew = previousRelease === null;

    await upsertRelease(version, body);

    const newDate = version.releaseDate ?? null;
    if (isNew) {
      // New release: try to generate task instances from a matched template
      await maybeGenerateInstances(String(version.id), version.name, newDate).catch(
        (err) => console.warn("[webhook] maybeGenerateInstances failed", err)
      );
    } else if (newDate !== previousDate) {
      // Existing release with a changed release date: cascade due dates
      await cascadeTaskDates(String(version.id), newDate).catch(
        (err) => console.warn("[webhook] cascadeTaskDates failed", err)
      );
    }

    return NextResponse.json({
      ok: true,
      action: "upserted",
      id: version.id,
      event: webhookEvent,
    });
  } catch (e) {
    console.error("[webhook jira version] failed", e);
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 }
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
