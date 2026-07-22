import { NextRequest, NextResponse } from "next/server";
import { verifyReadAiSignature } from "@/lib/readai/verify";
import {
  buildMeetingNote,
  buildTranscriptNote,
  findPreviousInSeries,
} from "@/lib/readai/note";
import {
  buildEnrichmentFireText,
  mintEnrichToken,
} from "@/lib/readai/enrich";
import {
  fireMeetingNotesRoutine,
  hasRoutineConfig,
} from "@/lib/readai/routine";
import { kvGet, kvPut } from "@/lib/readai/kv";
import {
  getVaultIndex,
  meetingNotesFolderId,
  transcriptsFolderId,
} from "@/lib/readai/vault";
import { createTextFile, updateTextFile } from "@/lib/google/drive";
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
 * Flow (deterministic write + async enrichment):
 *   1. verify → dedupe (KV on request_id) → skip meeting_start
 *   2. build the meeting note + companion transcript file in code and write
 *      them to the vault's Drive folders (update in place when a note for
 *      this session_id already exists — mapping kept in KV)
 *   3. fire the claude.ai enrichment routine (Sonnet) with the transcript, a
 *      menu of vault note paths, and an HMAC callback token; the routine
 *      POSTs decisions/owners/related-links to /api/readai/enrich, which
 *      patches the note's marker blocks
 *
 * The note write is the critical path: failures return 502 so Read AI
 * retries (up to 5 retries, exponential backoff). A failed enrichment fire
 * only logs — the note is already in the vault.
 *
 * Env: READAI_WEBHOOK_SIGNING_KEY (or READAI_WEBHOOK_SECRET fallback),
 * CLAUDE_ROUTINE_ID + CLAUDE_ROUTINE_TOKEN (enrichment routine), Google
 * OAuth connected in /settings with the Drive scope, and optionally
 * DRIVE_*_FOLDER_ID overrides (see lib/readai/vault.ts).
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

interface NoteMapping {
  noteFileId: string;
  transcriptFileId: string;
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

  if (!payload.session_id || !payload.title || !payload.start_time) {
    return NextResponse.json(
      { error: "missing session_id, title, or start_time" },
      { status: 400 },
    );
  }

  // meeting_start payloads (workspace webhooks) have no report yet.
  if (payload.trigger === "meeting_start") {
    return NextResponse.json({ ok: true, skipped: "meeting_start" });
  }

  const dedupeKey = payload.request_id
    ? `readai-request:${payload.request_id}`
    : null;
  if (dedupeKey && (await kvGet(dedupeKey)) !== null) {
    return NextResponse.json({ ok: true, skipped: "duplicate" });
  }

  // ── Deterministic write ──────────────────────────────────────────────────
  let mapping: NoteMapping;
  let vaultPaths: string[] = [];
  try {
    try {
      vaultPaths = await getVaultIndex();
    } catch (e) {
      // Index failure shouldn't block the note write — it only costs the
      // previous-in-series link and shrinks the enrichment link menu.
      console.error("[readai webhook] vault index failed", e);
    }

    const note = buildMeetingNote(payload, {
      previousInSeries: findPreviousInSeries(vaultPaths, payload),
    });
    const transcript = buildTranscriptNote(payload);

    const mappingKey = `readai-note:${payload.session_id}`;
    const existingRaw = await kvGet(mappingKey);
    const existing = existingRaw
      ? (JSON.parse(existingRaw) as NoteMapping)
      : null;

    if (existing) {
      await updateTextFile(existing.noteFileId, note.content);
      await updateTextFile(existing.transcriptFileId, transcript.content);
      mapping = existing;
    } else {
      const noteFileId = await createTextFile(
        meetingNotesFolderId(),
        note.fileName,
        note.content,
      );
      const transcriptFileId = await createTextFile(
        transcriptsFolderId(),
        transcript.fileName,
        transcript.content,
      );
      mapping = { noteFileId, transcriptFileId };
      await kvPut(mappingKey, JSON.stringify(mapping));
    }
  } catch (e) {
    console.error("[readai webhook] note write failed", e);
    // 502 → Read AI retries with backoff.
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }

  if (dedupeKey) await kvPut(dedupeKey, "1", DEDUPE_TTL_SECONDS);

  // ── Async enrichment (best-effort) ───────────────────────────────────────
  let enrichmentFired = false;
  const minted = mintEnrichToken(mapping.noteFileId);
  if (hasRoutineConfig() && minted) {
    try {
      const result = await fireMeetingNotesRoutine(
        buildEnrichmentFireText({
          payload,
          noteFileId: mapping.noteFileId,
          token: minted.token,
          exp: minted.exp,
          vaultPaths,
        }),
      );
      enrichmentFired = true;
      console.log(
        `[readai webhook] "${payload.title}" (${payload.session_id}) written; enrichment session ${result.sessionId ?? "?"}`,
      );
    } catch (e) {
      console.error("[readai webhook] enrichment fire failed", e);
    }
  }

  return NextResponse.json({
    ok: true,
    noteFileId: mapping.noteFileId,
    enrichmentFired,
  });
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
