import { NextRequest, NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import {
  discoverSprintFieldId,
  fetchChangelog,
  hasJiraCredentials,
  searchAllIssues,
} from "@/lib/jira/client";
import {
  extractTeamMembers,
  mapChangelog,
  mapJiraIssue,
} from "@/lib/jira/mappers";
import { fetchRepoActivity, getDisplayName } from "@/lib/github/client";
import {
  buildTeamActivity,
  type TeamActivityInputs,
  type TeamActivityOptions,
} from "@/lib/wallboard/team-activity";

const REPOS = ["istrada-web", "istrada-api", "istrada-droid"];

/**
 * Per-developer activity for the wallboard Team Activity screen, scoped to
 * "today" (the client passes local midnight as ?dayStart). Merges Jira
 * comments + status transitions with GitHub PR opened/approved/merged.
 * Polled infrequently (the screen is only visible part of the rotation), so
 * the per-ticket changelog fan-out stays affordable.
 */
export async function GET(request: NextRequest) {
  const dayStartParam = request.nextUrl.searchParams.get("dayStart");
  const dayStart = dayStartParam
    ? new Date(dayStartParam)
    : new Date(Date.now() - 24 * 60 * 60 * 1000);
  const dayStartMs = dayStart.getTime();

  const jiraOn = hasJiraCredentials();
  const token = process.env.GITHUB_TOKEN;

  if (!jiraOn && !token) {
    return NextResponse.json({ configured: false, people: [] });
  }

  const comments: TeamActivityInputs["comments"] = [];
  const transitions: TeamActivityInputs["transitions"] = [];
  const prs: TeamActivityInputs["prs"] = [];
  // Jira accountId → identity, so mapped GitHub-only devs still show a name/avatar.
  const jiraRoster: NonNullable<TeamActivityOptions["jiraRoster"]> = {};

  // KV config drives both the sprint scope (jqlFilter) and the identity map.
  const config = await getConfig();

  try {
    // ---- Jira: comments + status transitions today ----
    if (jiraOn) {
      if (config?.jqlFilter) {
        const sprintFieldId =
          config.sprintFieldId || (await discoverSprintFieldId()) || undefined;
        const issues = await searchAllIssues(config.jqlFilter, sprintFieldId);
        const memberById = new Map(
          extractTeamMembers(issues).map((m) => [m.id, m])
        );
        for (const m of memberById.values()) {
          jiraRoster[m.id] = { name: m.name, avatarUrl: m.avatarUrl };
        }
        const tickets = issues
          .map((i) => mapJiraIssue(i, config.l2LabelPatterns || [], sprintFieldId))
          // Mirror the wallboard's sprint-only scope
          .filter((t) => t.inSprint ?? !t.isL2);

        for (const t of tickets) {
          for (const c of t.comments) {
            if (new Date(c.createdAt).getTime() < dayStartMs) continue;
            const m = memberById.get(c.authorId);
            if (m) {
              comments.push({
                accountId: m.id,
                name: m.name,
                avatarUrl: m.avatarUrl,
                at: c.createdAt,
              });
            }
          }
        }

        // Only tickets touched today can carry a transition today
        const activeToday = tickets.filter(
          (t) => new Date(t.lastActivityDate).getTime() >= dayStartMs
        );
        const logs = await Promise.all(
          activeToday.map((t) =>
            fetchChangelog(t.key)
              .then((r) => mapChangelog(r.values))
              .catch(() => [])
          )
        );
        for (const entries of logs) {
          for (const e of entries) {
            if (new Date(e.created).getTime() < dayStartMs) continue;
            if (!e.authorAccountId) continue;
            if (e.changes.some((ch) => ch.field === "Status")) {
              transitions.push({
                accountId: e.authorAccountId,
                name: e.authorName,
                avatarUrl: e.authorAvatarUrl,
                at: e.created,
              });
              jiraRoster[e.authorAccountId] ??= {
                name: e.authorName,
                avatarUrl: e.authorAvatarUrl,
              };
            }
          }
        }
      }
    }

    // ---- GitHub: PRs opened / approved / merged today ----
    if (token) {
      const perRepo = await Promise.all(
        REPOS.map((repo) =>
          fetchRepoActivity(repo, dayStart, token).catch(() => [])
        )
      );
      const events = perRepo.flat();
      const logins = [
        ...new Set(events.map((e) => e.actor).filter((a): a is string => !!a)),
      ];
      const nameByLogin = new Map<string, string>();
      await Promise.all(
        logins.map(async (l) => nameByLogin.set(l, await getDisplayName(l, token)))
      );

      for (const e of events) {
        if (!e.actor || new Date(e.at).getTime() < dayStartMs) continue;
        const kind =
          e.kind === "pr-open" || e.kind === "pr-draft"
            ? "opened"
            : e.kind === "pr-approved"
              ? "approved"
              : e.kind === "pr-merged"
                ? "merged"
                : null;
        if (!kind) continue;
        prs.push({
          login: e.actor,
          name: nameByLogin.get(e.actor) ?? e.actor,
          avatarUrl: `https://github.com/${e.actor}.png`,
          kind,
          at: e.at,
        });
      }
    }

    const people = buildTeamActivity(
      { comments, transitions, prs },
      { githubUserMap: config?.githubUserMap ?? {}, jiraRoster }
    );
    // Flat timestamped event list (source only) for the client's rhythm strip.
    const events: { at: number; source: "jira" | "github" }[] = [
      ...[...comments, ...transitions].map((e) => ({
        at: new Date(e.at!).getTime(),
        source: "jira" as const,
      })),
      ...prs.map((p) => ({
        at: new Date(p.at!).getTime(),
        source: "github" as const,
      })),
    ]
      .filter((e) => !Number.isNaN(e.at))
      .sort((a, b) => a.at - b.at);
    return NextResponse.json({
      configured: true,
      people,
      events,
      generatedAt: Date.now(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
