import { NextRequest, NextResponse } from "next/server";
import { fetchPRSummary } from "@/lib/github/client";

const REPOS = ["istrada-web", "istrada-api", "istrada-droid"];

/**
 * Wallboard aggregate: open PR count, avg open-PR age, opened/merged today
 * across the istrada repos. `since` (ISO) is the client's local start-of-day
 * so "today" follows the office clock rather than the server timezone.
 */
export async function GET(req: NextRequest) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return NextResponse.json({ configured: false });
  }

  const sinceParam = req.nextUrl.searchParams.get("since");
  const since = sinceParam ? new Date(sinceParam) : new Date();
  if (isNaN(since.getTime())) {
    return NextResponse.json({ error: "Invalid since param" }, { status: 400 });
  }

  try {
    const perRepo = await Promise.all(
      REPOS.map((repo) => fetchPRSummary(repo, since, token))
    );

    const totalOpen = perRepo.reduce((s, r) => s + r.openCount, 0);
    const weightedAge = perRepo.reduce(
      (s, r) => s + r.avgOpenAgeDays * r.openCount,
      0
    );

    return NextResponse.json({
      configured: true,
      openCount: totalOpen,
      avgOpenAgeDays: totalOpen === 0 ? 0 : weightedAge / totalOpen,
      openedToday: perRepo.reduce((s, r) => s + r.openedToday, 0),
      mergedToday: perRepo.reduce((s, r) => s + r.mergedToday, 0),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
