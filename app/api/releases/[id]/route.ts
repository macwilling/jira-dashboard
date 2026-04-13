import { NextRequest, NextResponse } from "next/server";
import { getRelease } from "@/lib/releases/store";
import { listTemplates, listTaskInstances } from "@/lib/releases/templates-store";
import { matchTemplate } from "@/lib/releases/matcher";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const [release, templates] = await Promise.all([
      getRelease(id),
      listTemplates(),
    ]);

    if (!release) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    const matched = matchTemplate(release.name, templates);
    const instances = await listTaskInstances(id);

    return NextResponse.json({
      release,
      matchedTemplate: matched ?? null,
      taskInstances: instances,
    });
  } catch (e) {
    console.error("[GET /api/releases/[id]]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
