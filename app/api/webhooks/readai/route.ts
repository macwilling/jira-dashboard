import { NextRequest, NextResponse } from "next/server";
import { verifyReadAiSignature } from "@/lib/readai/verify";
import { buildMeetingDigest } from "@/lib/readai/prompt";
import {
  fireMeetingNotesRoutine,
  hasRoutineConfig,
} from "@/lib/readai/routine";
import type { ReadAiWebhookPayload } from "@/lib/readai/types";

/**
 * Receiver for Read AI meeting webhooks.
 *
 * Read AI webhook setup (Integrations → Webhooks → Create webhook):
 *   URL: https://<your-domain>/api/webhooks/readai
 *   — Read AI sends no custom headers or body, so authentication uses the
 *     HMAC signature Read AI attaches to every delivery (preferred), or a
 *     `?secret=` query param embedded in the URL as a fallback.
 *
 * Flow: verify → dedupe (Cloudflare KV, best-effort) → skip meeting_start →
 * flatten payload to a markdown digest → fire the claude.ai "Meeting Notes"
 * routine, whose Claude session writes the note to the Obsidian vault.
 *
 * Read AI retries on any non-2xx (up to 5 retries, exponential backoff;
 * 25 consecutive failures disable the webhook) — so forwarding failures
 * return 502 to get a retry, and duplicates/skips return 200.
 *
 * Env:
 *   READAI_WEBHOOK_SIGNING_KEY — base64 signing key from the webhook config
 *   READAI_WEBHOOK_SECRET      — fallback shared secret for ?secret=
 *   CLAUDE_ROUTINE_ID          — trig_… id of the Meeting Notes routine
 *   CLAUDE_ROUTINE_TOKEN       — sk-ant-oat01-… API token for that routine
 */

const DEDUPE_TTL_SECONDS = 7 * 24 * 60 * 60;

function verifyRequest(req: NextRequest, rawBody: string): boolean {
  const signingKey = process.env.READAI_WEBHOOK_SIGNING_KEY;
  if (signingKey) {
    return verifyReadAiSignature(
      rawBody,
      req.headers.get("x-read-signature"),
      signingKey,
    );
  }

  const expected = process.env.READAI_WEBHOOK_SECRET;
  if (expected) {
    return req.nextUrl.searchParams.get("secret") === expected;
  }

  if (process.env.NODE_ENV === "production") {
    console.error(
      "[readai webhook] no READAI_WEBHOOK_SIGNING_KEY or READAI_WEBHOOK_SECRET set — rejecting request",
    );
    return false;
  }
  return true; // dev only: skip verification
}

// Best-effort replay protection keyed on Read AI's request_id. Returns true
// if this delivery was already processed. Skips silently when KV isn't
// configured — signature verification is the real gate.
async function isDuplicate(requestId: string): Promise<boolean> {
  const url = dedupeKvUrl(requestId);
  if (!url) return false;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` },
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function markProcessed(requestId: string): Promise<void> {
  const url = dedupeKvUrl(requestId);
  if (!url) return;
  try {
    await fetch(`${url}?expiration_ttl=${DEDUPE_TTL_SECONDS}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` },
      body: "1",
    });
  } catch {
    // best-effort
  }
}

function dedupeKvUrl(requestId: string): string | null {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const namespaceId = process.env.CLOUDFLARE_KV_NAMESPACE_ID;
  if (!accountId || !namespaceId || !process.env.CLOUDFLARE_API_TOKEN) {
    return null;
  }
  const key = encodeURIComponent(`readai-request:${requestId}`);
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${key}`;
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  if (!verifyRequest(req, rawBody)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: ReadAiWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as ReadAiWebhookPayload;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  if (!payload.session_id || !payload.title) {
    return NextResponse.json(
      { error: "missing session_id or title" },
      { status: 400 },
    );
  }

  // meeting_start payloads (workspace webhooks) have no report yet.
  if (payload.trigger === "meeting_start") {
    return NextResponse.json({ ok: true, skipped: "meeting_start" });
  }

  if (payload.request_id && (await isDuplicate(payload.request_id))) {
    return NextResponse.json({ ok: true, skipped: "duplicate" });
  }

  if (!hasRoutineConfig()) {
    console.error(
      "[readai webhook] CLAUDE_ROUTINE_ID / CLAUDE_ROUTINE_TOKEN not set — dropping meeting",
      payload.session_id,
    );
    return NextResponse.json(
      { error: "routine not configured" },
      { status: 500 },
    );
  }

  try {
    const digest = buildMeetingDigest(payload);
    const result = await fireMeetingNotesRoutine(digest);
    // Mark processed only after a successful forward so Read AI's retries
    // still go through if the routine fire fails.
    if (payload.request_id) await markProcessed(payload.request_id);
    console.log(
      `[readai webhook] forwarded "${payload.title}" (${payload.session_id}) → session ${result.sessionId ?? "?"}`,
    );
    return NextResponse.json({ ok: true, sessionUrl: result.sessionUrl });
  } catch (e) {
    console.error("[readai webhook] forward failed", e);
    // 502 → Read AI retries with backoff.
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 502 },
    );
  }
}

// Health check — useful when setting up the webhook in Read AI.
export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "Read AI meeting webhook receiver",
    signatureConfigured: !!process.env.READAI_WEBHOOK_SIGNING_KEY,
    fallbackSecretConfigured: !!process.env.READAI_WEBHOOK_SECRET,
    routineConfigured: hasRoutineConfig(),
  });
}
