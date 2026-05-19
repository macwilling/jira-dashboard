import { NextRequest, NextResponse } from "next/server";
import { fetchMergedPRs } from "@/lib/github/client";
import { PRStats } from "@/lib/github/types";

const REPOS = ["istrada-web", "istrada-api", "istrada-droid"];

export async function GET(req: NextRequest) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "GITHUB_TOKEN is not configured" },
      { status: 503 }
    );
  }

  const { searchParams } = new URL(req.url);
  const days = Math.min(Math.max(parseInt(searchParams.get("days") ?? "30", 10), 7), 90);

  const since = new Date();
  since.setDate(since.getDate() - days);
  since.setHours(0, 0, 0, 0);

  try {
    const perRepo = await Promise.all(
      REPOS.map((repo) => fetchMergedPRs(repo, since, token))
    );

    const allPRs = perRepo.flat();

    const authorTotals = new Map<string, number>();
    for (const pr of allPRs) {
      authorTotals.set(pr.authorName, (authorTotals.get(pr.authorName) ?? 0) + 1);
    }
    const contributors = [...authorTotals.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name);

    const activeDays = new Set(
      allPRs.map((pr) => pr.mergedAt.slice(0, 10))
    ).size;

    const from = since.toISOString().slice(0, 10);
    const to = new Date().toISOString().slice(0, 10);

    const stats: PRStats = {
      prs: allPRs,
      totalPRs: allPRs.length,
      contributors,
      activeDays,
      dateRange: { from, to },
    };

    return NextResponse.json(stats);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
