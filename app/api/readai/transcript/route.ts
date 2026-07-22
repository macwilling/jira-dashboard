import { NextRequest, NextResponse } from "next/server";
import { verifyEnrichToken } from "@/lib/readai/enrich";
import { getTextFile } from "@/lib/google/drive";

/**
 * Signed transcript fetch for the Read AI enrichment routine.
 *
 * When a meeting transcript is too long for the routine fire payload (the
 * routines API caps `text` at 65,536 chars), the payload carries a signed
 * URL to this endpoint instead. The routine curls it once to get the full
 * transcript; the app serves it from Google Drive using its own OAuth, so
 * the routine needs no Drive access.
 *
 * Auth: the same HMAC scheme as /api/readai/enrich — token bound to
 * (fileId, exp), minted only by our webhook route at fire time.
 */
export async function GET(req: NextRequest) {
  const fileId = req.nextUrl.searchParams.get("fileId");
  const exp = Number(req.nextUrl.searchParams.get("exp"));
  const token = req.nextUrl.searchParams.get("token");

  if (!fileId || !token || !Number.isFinite(exp)) {
    return NextResponse.json(
      { error: "missing fileId, exp, or token" },
      { status: 400 },
    );
  }
  if (!verifyEnrichToken(fileId, exp, token)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const content = await getTextFile(fileId);
    return new NextResponse(content, {
      headers: { "Content-Type": "text/markdown; charset=utf-8" },
    });
  } catch (e) {
    console.error("[readai transcript] fetch failed", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
