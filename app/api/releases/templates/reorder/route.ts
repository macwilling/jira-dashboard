import { NextRequest, NextResponse } from "next/server";
import { reorderTemplates } from "@/lib/releases/templates-store";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { orderedIds?: string[] };

    if (!Array.isArray(body.orderedIds) || body.orderedIds.length === 0) {
      return NextResponse.json({ error: "orderedIds array required" }, { status: 400 });
    }

    await reorderTemplates(body.orderedIds);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
