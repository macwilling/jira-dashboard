import { NextRequest, NextResponse } from "next/server";
import { hasJiraCredentials } from "@/lib/jira/client";
import {
  computeBugMetrics,
  DEFAULT_CLEANUP_PREFIXES,
  OPEN_STATUSES,
  DONE_STATUSES,
  DEFAULT_PROJECT_KEY,
} from "@/lib/jira/bug-metrics";
import { getConfig, hasKvConfig } from "@/lib/config";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  if (!hasJiraCredentials()) {
    return NextResponse.json(
      { error: "Jira credentials are not configured" },
      { status: 503 }
    );
  }

  const { searchParams } = new URL(req.url);
  const start = searchParams.get("start") ?? "";
  const end = searchParams.get("end") ?? "";

  if (!DATE_RE.test(start) || !DATE_RE.test(end)) {
    return NextResponse.json(
      { error: "start and end are required as YYYY-MM-DD" },
      { status: 400 }
    );
  }
  if (end < start) {
    return NextResponse.json(
      { error: "end must be on or after start" },
      { status: 400 }
    );
  }

  // Configurable knobs live on the KV dashboard config; fall back to defaults.
  const config = hasKvConfig() ? await getConfig() : null;

  try {
    const metrics = await computeBugMetrics({
      start,
      end,
      projectKey: config?.bugProjectKey || DEFAULT_PROJECT_KEY,
      openStatuses: config?.bugOpenStatuses?.length
        ? config.bugOpenStatuses
        : OPEN_STATUSES,
      doneStatuses: config?.bugDoneStatuses?.length
        ? config.bugDoneStatuses
        : DONE_STATUSES,
      cleanupLabelPrefixes: config?.bugCleanupLabelPrefixes?.length
        ? config.bugCleanupLabelPrefixes
        : DEFAULT_CLEANUP_PREFIXES,
    });

    return NextResponse.json(metrics);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
