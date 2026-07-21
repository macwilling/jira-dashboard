import { NextResponse } from "next/server";
import { fetchRepoActivity } from "@/lib/github/client";

const REPOS = ["istrada-web", "istrada-api", "istrada-droid"];
const WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * PR + deployment events across the istrada repos for the wallboard
 * activity feed (last 24h). Event ids are stable so the client can dedupe
 * across polls and toast only what's new.
 */
export async function GET() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return NextResponse.json({ configured: false, events: [] });
  }

  const since = new Date(Date.now() - WINDOW_MS);

  try {
    const perRepo = await Promise.all(
      REPOS.map((repo) => fetchRepoActivity(repo, since, token))
    );
    const events = perRepo
      .flat()
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 60);

    return NextResponse.json({ configured: true, events });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
