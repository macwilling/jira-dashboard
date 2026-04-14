import { NextRequest, NextResponse } from "next/server";
import { getConfig, saveConfig, hasKvConfig, DashboardConfig } from "@/lib/config";
import { hasJiraCredentials, testConnection } from "@/lib/jira/client";

export async function GET() {
  const jiraConnected = hasJiraCredentials();
  const kvConnected = hasKvConfig();

  const config = kvConnected ? await getConfig() : null;

  // Test Jira connection
  let jiraStatus: { ok: boolean; user?: string; error?: string } = { ok: false };
  if (jiraConnected) {
    jiraStatus = await testConnection();
  }

  return NextResponse.json({
    jiraConnected,
    jiraStatus,
    kvConnected,
    config,
  });
}

export async function POST(request: NextRequest) {
  if (!hasKvConfig()) {
    return NextResponse.json(
      { error: "Cloudflare KV not configured" },
      { status: 503 }
    );
  }

  try {
    const body: DashboardConfig = await request.json();

    if (!body.jqlFilter || typeof body.jqlFilter !== "string") {
      return NextResponse.json(
        { error: "jqlFilter is required" },
        { status: 400 }
      );
    }

    await saveConfig({
      jqlFilter: body.jqlFilter,
      l2LabelPatterns: body.l2LabelPatterns || [],
      ...(body.sprintFieldId ? { sprintFieldId: body.sprintFieldId } : {}),
      ...(body.boardId ? { boardId: body.boardId } : {}),
      ...(body.standupTime ? { standupTime: body.standupTime } : {}),
      ...(body.standupTimezone ? { standupTimezone: body.standupTimezone } : {}),
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 }
    );
  }
}
