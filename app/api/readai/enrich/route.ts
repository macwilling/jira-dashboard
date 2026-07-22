import { NextRequest, NextResponse } from "next/server";
import { verifyEnrichToken, type EnrichSubmission } from "@/lib/readai/enrich";
import { patchEnrichSection, type EnrichSection } from "@/lib/readai/note";
import { getTextFile, updateTextFile } from "@/lib/google/drive";

/**
 * Enrichment callback for the Read AI bridge.
 *
 * The claude.ai routine session (fired by /api/webhooks/readai) POSTs its
 * analysis here — key decisions, action items with owners, related-note
 * wikilinks — and this route patches the meeting note's marker-delimited
 * blocks in Google Drive. The routine itself has no Drive write access; this
 * endpoint is its only pen.
 *
 * Auth: HMAC token minted at fire time, bound to (noteFileId, exp). See
 * lib/readai/enrich.ts.
 */

const SECTION_CHAR_LIMIT = 20_000;

const SECTION_FIELDS: { field: "decisions" | "actionItems" | "related"; section: EnrichSection }[] = [
  { field: "decisions", section: "decisions" },
  { field: "actionItems", section: "actionitems" },
  { field: "related", section: "related" },
];

export async function POST(req: NextRequest) {
  let body: EnrichSubmission;
  try {
    body = (await req.json()) as EnrichSubmission;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const { noteFileId, exp, token } = body;
  if (!noteFileId || typeof noteFileId !== "string" || !token) {
    return NextResponse.json(
      { error: "missing noteFileId or token" },
      { status: 400 },
    );
  }
  if (!verifyEnrichToken(noteFileId, Number(exp), String(token))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const updates = SECTION_FIELDS.filter(
    ({ field }) => typeof body[field] === "string" && body[field]!.trim(),
  );
  if (updates.length === 0) {
    return NextResponse.json({ error: "no sections provided" }, { status: 400 });
  }
  for (const { field } of updates) {
    if (body[field]!.length > SECTION_CHAR_LIMIT) {
      return NextResponse.json(
        { error: `${field} exceeds ${SECTION_CHAR_LIMIT} chars` },
        { status: 400 },
      );
    }
  }

  try {
    let content = await getTextFile(noteFileId);
    const patched: string[] = [];
    const missing: string[] = [];

    for (const { field, section } of updates) {
      const next = patchEnrichSection(content, section, body[field]!);
      if (next === null) {
        missing.push(field);
      } else {
        content = next;
        patched.push(field);
      }
    }

    if (patched.length === 0) {
      return NextResponse.json(
        { error: "no enrichment markers found in note", missing },
        { status: 409 },
      );
    }

    await updateTextFile(noteFileId, content);
    return NextResponse.json({ ok: true, patched, missing });
  } catch (e) {
    console.error("[readai enrich] patch failed", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
