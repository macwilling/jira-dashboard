import crypto from "crypto";
import type { ReadAiWebhookPayload } from "@/lib/readai/types";
import {
  actionItemsMarkdown,
  meetingDate,
  renderTranscript,
} from "@/lib/readai/note";

/**
 * Enrichment handshake for the Read AI bridge.
 *
 * The webhook route writes the deterministic note, then fires the claude.ai
 * routine with a payload built here. The routine session analyzes the
 * transcript and POSTs its output to /api/readai/enrich, authenticated by an
 * HMAC token minted here — bound to the note's Drive file id and an expiry,
 * so a leaked payload can only edit that one note for a few hours.
 */

const TOKEN_TTL_SECONDS = 6 * 60 * 60;

/**
 * The routines /fire endpoint rejects `text` over 65,536 chars
 * ("maximum string length is 65536"). Budget with a safety margin; the
 * transcript gets whatever room the fixed sections leave (the vault
 * transcript file is never capped — only this fire payload is).
 */
const FIRE_TEXT_MAX_CHARS = 62_000;

function enrichKey(): Buffer | null {
  const signingKey = process.env.READAI_WEBHOOK_SIGNING_KEY;
  if (signingKey) return Buffer.from(signingKey, "base64");
  const secret = process.env.READAI_WEBHOOK_SECRET;
  if (secret) return Buffer.from(secret, "utf8");
  return null;
}

export function mintEnrichToken(
  noteFileId: string,
): { token: string; exp: number } | null {
  const key = enrichKey();
  if (!key) return null;
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const token = crypto
    .createHmac("sha256", key)
    .update(`${noteFileId}.${exp}`)
    .digest("hex");
  return { token, exp };
}

export function verifyEnrichToken(
  noteFileId: string,
  exp: number,
  token: string,
): boolean {
  const key = enrichKey();
  if (!key) return process.env.NODE_ENV !== "production"; // dev only
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) {
    return false;
  }
  const expected = crypto
    .createHmac("sha256", key)
    .update(`${noteFileId}.${exp}`)
    .digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(String(token).trim().toLowerCase());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Body accepted by POST /api/readai/enrich. */
export interface EnrichSubmission {
  noteFileId: string;
  exp: number;
  token: string;
  /** Markdown bullet list of key decisions. */
  decisions?: string;
  /** Full replacement action-items markdown (checkboxes, owners appended). */
  actionItems?: string;
  /** Markdown lines of related-note wikilinks. */
  related?: string;
}

export function buildEnrichmentFireText(args: {
  payload: ReadAiWebhookPayload;
  noteFileId: string;
  token: string;
  exp: number;
  vaultPaths: string[];
}): string {
  const { payload, noteFileId, token, exp, vaultPaths } = args;
  const lines: string[] = [];

  lines.push("MEETING NOTE ENRICHMENT REQUEST");
  lines.push("");
  lines.push(`meeting_title: ${payload.title}`);
  lines.push(`meeting_date: ${meetingDate(payload)}`);
  lines.push(`session_id: ${payload.session_id}`);
  lines.push(`note_file_id: ${noteFileId}`);
  lines.push(`callback_token: ${token}`);
  lines.push(`callback_exp: ${exp}`);
  lines.push("");
  lines.push("== CURRENT ACTION ITEMS (verbatim from the note) ==");
  lines.push(actionItemsMarkdown(payload));
  lines.push("");
  lines.push("== VAULT NOTES (the ONLY valid wikilink targets) ==");
  for (const path of vaultPaths) lines.push(path);
  lines.push("");
  lines.push("== TRANSCRIPT ==");

  const fixed = lines.join("\n").length + 1;
  const transcriptBudget = Math.max(FIRE_TEXT_MAX_CHARS - fixed, 2_000);
  lines.push(renderTranscript(payload, transcriptBudget));

  const text = lines.join("\n");
  // Belt and braces: never exceed the API limit even if the fixed sections
  // alone blow the budget (e.g. a runaway vault index).
  return text.length > 65_000 ? text.slice(0, 65_000) : text;
}
