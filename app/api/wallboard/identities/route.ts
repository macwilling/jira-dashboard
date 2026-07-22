import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import {
  discoverSprintFieldId,
  hasJiraCredentials,
  searchAllIssues,
} from "@/lib/jira/client";
import { extractTeamMembers } from "@/lib/jira/mappers";
import { fetchRepoActivity, getDisplayName } from "@/lib/github/client";

const REPOS = ["istrada-web", "istrada-api", "istrada-droid"];
const WINDOW_MS = 90 * 24 * 60 * 60 * 1000; // enumerate contributors over ~90 days

/** Loose normalizer for name-based pre-fill suggestions only (never at render). */
function norm(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l")
    .replace(/\s+/g, " ");
}

/**
 * Feeds the /settings identity mapper: the Jira board's users (dropdown
 * targets) and the GitHub users seen in recent PR activity (rows to map),
 * each with a best-guess Jira match to pre-select the dropdown.
 */
export async function GET() {
  const jiraUsers: { accountId: string; name: string; avatarUrl: string | null }[] =
    [];
  const githubUsers: {
    login: string;
    name: string;
    avatarUrl: string;
    suggestedAccountId: string | null;
  }[] = [];

  try {
    if (hasJiraCredentials()) {
      const config = await getConfig();
      if (config?.jqlFilter) {
        const sprintFieldId =
          config.sprintFieldId || (await discoverSprintFieldId()) || undefined;
        const issues = await searchAllIssues(config.jqlFilter, sprintFieldId);
        for (const m of extractTeamMembers(issues)) {
          jiraUsers.push({ accountId: m.id, name: m.name, avatarUrl: m.avatarUrl });
        }
      }
    }
    jiraUsers.sort((a, b) => a.name.localeCompare(b.name));

    const token = process.env.GITHUB_TOKEN;
    if (token) {
      const since = new Date(Date.now() - WINDOW_MS);
      const perRepo = await Promise.all(
        REPOS.map((repo) => fetchRepoActivity(repo, since, token).catch(() => []))
      );
      const events = perRepo.flat();
      const prKinds = new Set([
        "pr-open",
        "pr-draft",
        "pr-approved",
        "pr-merged",
        "pr-closed",
      ]);
      const logins = [
        ...new Set(
          events
            .filter((e) => prKinds.has(e.kind) && e.actor)
            .map((e) => e.actor as string)
        ),
      ];
      const byNormName = new Map(jiraUsers.map((u) => [norm(u.name), u.accountId]));
      await Promise.all(
        logins.map(async (login) => {
          const name = await getDisplayName(login, token);
          githubUsers.push({
            login,
            name,
            avatarUrl: `https://github.com/${login}.png`,
            suggestedAccountId: byNormName.get(norm(name)) ?? null,
          });
        })
      );
      githubUsers.sort((a, b) => a.login.localeCompare(b.login));
    }

    return NextResponse.json({ jiraUsers, githubUsers });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
