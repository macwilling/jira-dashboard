import { NextRequest, NextResponse } from "next/server";
import { fetchInsights, hasDatadogCredentials } from "@/lib/datadog/client";

/**
 * Wallboard product insights, proxied server-side so Datadog keys never
 * reach the browser. `dayStart` (ISO) is the client's local start-of-day.
 */
export async function GET(req: NextRequest) {
  if (!hasDatadogCredentials()) {
    return NextResponse.json({ configured: false });
  }

  const dayStartParam = req.nextUrl.searchParams.get("dayStart");
  const dayStart = dayStartParam ? new Date(dayStartParam) : null;
  if (!dayStart || isNaN(dayStart.getTime())) {
    return NextResponse.json({ error: "Invalid dayStart param" }, { status: 400 });
  }

  try {
    const insights = await fetchInsights(dayStart.toISOString());
    return NextResponse.json({ configured: true, ...insights });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
