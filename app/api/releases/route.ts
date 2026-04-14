import { NextResponse } from "next/server";
import { listReleases } from "@/lib/releases/store";
import { listTemplates, listTaskInstances } from "@/lib/releases/templates-store";
import { matchTemplate } from "@/lib/releases/matcher";
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
        const matched = matchTemplate(release.name, templates);
        const instances = await listTaskInstances(release.id);
        return {
          ...release,
          matchedTemplate: matched
            ? { id: matched.id, name: matched.name }
            : null,
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
