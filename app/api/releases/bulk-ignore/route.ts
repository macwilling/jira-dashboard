import { NextRequest, NextResponse } from "next/server";
import { bulkSetReleasesIgnored } from "@/lib/releases/store";

/**
 * POST — bulk set/unset the ignored flag on releases.
 * Body: { ids: string[], ignored: boolean }
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      ids?: string[];
      ignored?: boolean;
    };
    if (!Array.isArray(body.ids) || body.ids.length === 0) {
      return NextResponse.json(
        { error: "ids array is required" },
        { status: 400 },
      );
    }
    const ignored = body.ignored !== false;
    await bulkSetReleasesIgnored(body.ids, ignored);
    return NextResponse.json({
      ok: true,
      count: body.ids.length,
      ignored,
    });
  } catch (e) {
    console.error("[POST /api/releases/bulk-ignore]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
