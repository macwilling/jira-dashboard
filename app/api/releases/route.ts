import { NextResponse } from "next/server";
import { listReleases } from "@/lib/releases/store";
import { listTemplates, listTaskInstances } from "@/lib/releases/templates-store";
import { matchTemplates } from "@/lib/releases/matcher";
import { summarizeSyncStates } from "@/lib/releases/sync-state";

// Hits Cloudflare D1 at request time — never prerender.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [releases, templates] = await Promise.all([
      listReleases(),
      listTemplates(),
    ]);

    const result = await Promise.all(
      releases.map(async (release) => {
        const matched = matchTemplates(release.name, templates);
        const instances = await listTaskInstances(release.id);
        return {
          ...release,
          matchedTemplates: matched.map((t) => ({ id: t.id, name: t.name })),
          syncSummary: summarizeSyncStates(instances),
        };
      })
    );

    return NextResponse.json({ releases: result });
  } catch (e) {
    console.error("[GET /api/releases]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
