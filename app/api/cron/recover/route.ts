import { NextRequest, NextResponse } from "next/server";
import { listProjectVersions } from "@/lib/jira/versions";
import { listReleases } from "@/lib/releases/store";
import { handleVersionEvent } from "@/lib/releases/orchestrator";
import type {
  JiraVersionPayload,
  JiraVersionWebhookEvent,
} from "@/lib/releases/types";

/**
 * Drift recovery endpoint. Intended to be called from a Cloudflare cron
 * worker every few minutes. Diffs Jira's view of the project's versions
 * against the app's D1 release table and replays webhook events for any
 * discrepancies. Safe to call repeatedly — `handleVersionEvent` is idempotent.
 *
 * Auth: expects `Authorization: Bearer <CRON_RECOVERY_SECRET>` OR a matching
 * `?secret=…` query param so the worker can pass it either way.
 *
 * Config:
 *   CRON_RECOVERY_SECRET — required (auth)
 *   JIRA_PROJECT_KEY     — project to poll (e.g. "IST")
 *   JIRA_URL / JIRA_EMAIL / JIRA_API_TOKEN — the usual
 */

export const dynamic = "force-dynamic";

function verifySecret(req: NextRequest): boolean {
  const expected = process.env.CRON_RECOVERY_SECRET;
  if (!expected) {
    // Dev-only: unconfigured → block to prevent accidental exposure.
    return false;
  }
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const querySecret = req.nextUrl.searchParams.get("secret");
  return bearer === expected || querySecret === expected;
}

function toWebhookPayload(v: {
  id: string;
  projectId: number;
  name: string;
  description?: string;
  releaseDate?: string;
  startDate?: string;
  released?: boolean;
  archived?: boolean;
}): JiraVersionPayload {
  return {
    id: String(v.id),
    projectId: v.projectId,
    name: v.name,
    description: v.description,
    releaseDate: v.releaseDate,
    startDate: v.startDate,
    released: v.released,
    archived: v.archived,
  };
}

async function replay(
  payload: JiraVersionPayload,
  webhookEvent: JiraVersionWebhookEvent,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await handleVersionEvent({
      payload,
      webhookEvent,
      rawBody: { webhookEvent, version: payload, source: "cron-recover" },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function POST(req: NextRequest) {
  if (!verifySecret(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const projectKey = process.env.JIRA_PROJECT_KEY;
  if (!projectKey) {
    return NextResponse.json(
      { error: "JIRA_PROJECT_KEY not configured" },
      { status: 500 },
    );
  }

  try {
    const [jiraVersions, appReleases] = await Promise.all([
      listProjectVersions(projectKey),
      listReleases(),
    ]);

    const jiraById = new Map(jiraVersions.map((v) => [String(v.id), v]));
    const appById = new Map(appReleases.map((r) => [r.id, r]));

    let upsertedCount = 0;
    let deletedCount = 0;
    let unchangedCount = 0;
    const errors: { id: string; name?: string; error: string }[] = [];

    // Pass 1: replay every Jira version as "updated". handleVersionEvent will
    // no-op in terms of Slack/dispatch if nothing material changed, but we
    // still call it so category resolution + task generation are kept in
    // sync for anything the app missed.
    for (const v of jiraVersions) {
      const app = appById.get(String(v.id));
      // If the app row is identical, skip the replay to avoid redundant work.
      if (
        app &&
        !app.deletedAt &&
        app.name === v.name &&
        (app.releaseDate ?? null) === (v.releaseDate ?? null) &&
        (app.startDate ?? null) === (v.startDate ?? null) &&
        app.released === !!v.released &&
        app.archived === !!v.archived
      ) {
        unchangedCount++;
        continue;
      }
      const result = await replay(
        toWebhookPayload(v),
        "jira:version_updated",
      );
      if (result.ok) upsertedCount++;
      else errors.push({ id: String(v.id), name: v.name, error: result.error! });
    }

    // Pass 2: any app release (not already soft-deleted) whose Jira ID is
    // missing from the server's list → replay a "deleted" event. Guards
    // against missed version_deleted webhooks.
    for (const r of appReleases) {
      if (r.deletedAt) continue;
      if (jiraById.has(r.id)) continue;
      const payload: JiraVersionPayload = {
        id: r.id,
        projectId: r.projectId as unknown as number,
        name: r.name,
        description: r.description ?? undefined,
        releaseDate: r.releaseDate ?? undefined,
        startDate: r.startDate ?? undefined,
        released: r.released,
        archived: r.archived,
      };
      const result = await replay(payload, "jira:version_deleted");
      if (result.ok) deletedCount++;
      else
        errors.push({ id: r.id, name: r.name, error: result.error! });
    }

    return NextResponse.json({
      ok: true,
      projectKey,
      jiraVersionCount: jiraVersions.length,
      appReleaseCount: appReleases.length,
      upserted: upsertedCount,
      deleted: deletedCount,
      unchanged: unchangedCount,
      errors,
      checkedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[cron recover] failed", e);
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 },
    );
  }
}

/** Health check. Returns 200 iff the required env is present. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "cron recovery",
    secretConfigured: !!process.env.CRON_RECOVERY_SECRET,
    projectKeyConfigured: !!process.env.JIRA_PROJECT_KEY,
    jiraConfigured:
      !!process.env.JIRA_URL &&
      !!process.env.JIRA_EMAIL &&
      !!process.env.JIRA_API_TOKEN,
  });
}
