import { PRRecord, PRSummary, RepoEvent } from "./types";

const GITHUB_ORG = "sysdynetechnologies";

interface GitHubPR {
  number: number;
  title: string;
  html_url: string;
  created_at: string;
  merged_at: string | null;
  closed_at: string | null;
  updated_at: string;
  draft?: boolean;
  labels?: { name: string }[];
  user: {
    login: string;
    name?: string | null;
  } | null;
}

/**
 * PRs labeled "on hold" are excluded from the wallboard stats (open counts,
 * age, opened/merged today) — they'd distort averages while parked. They
 * still appear in the activity feed.
 */
function isOnHold(pr: GitHubPR): boolean {
  return !!pr.labels?.some((l) => l.name.toLowerCase() === "on hold");
}

interface GitHubReview {
  id: number;
  state: string; // APPROVED | CHANGES_REQUESTED | COMMENTED | DISMISSED | PENDING
  submitted_at?: string;
  user: { login: string } | null;
}

interface GitHubUser {
  name: string | null;
  login: string;
}

const userNameCache = new Map<string, string>();

async function getDisplayName(login: string, token: string): Promise<string> {
  if (userNameCache.has(login)) return userNameCache.get(login)!;
  try {
    const res = await fetch(`https://api.github.com/users/${login}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (res.ok) {
      const data: GitHubUser = await res.json();
      const name = data.name || login;
      userNameCache.set(login, name);
      return name;
    }
  } catch {
    // fall through to login
  }
  userNameCache.set(login, login);
  return login;
}

export async function fetchMergedPRs(
  repo: string,
  since: Date,
  token: string
): Promise<PRRecord[]> {
  const results: PRRecord[] = [];
  let page = 1;
  let done = false;

  while (!done) {
    const url = `https://api.github.com/repos/${GITHUB_ORG}/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=${page}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!res.ok) {
      throw new Error(
        `GitHub API error for ${repo}: ${res.status} ${res.statusText}`
      );
    }

    const prs: GitHubPR[] = await res.json();

    if (prs.length === 0) break;

    for (const pr of prs) {
      const updatedAt = new Date(pr.updated_at);
      if (updatedAt < since) {
        done = true;
        break;
      }
      if (!pr.merged_at) continue;
      const mergedAt = new Date(pr.merged_at);
      if (mergedAt < since) continue;

      const login = pr.user?.login ?? "unknown";
      results.push({
        number: pr.number,
        title: pr.title,
        author: login,
        authorName: login, // resolved below
        repo,
        mergedAt: pr.merged_at,
        url: pr.html_url,
      });
    }

    page++;
    if (!done && prs.length < 100) break;
  }

  // Resolve display names (deduplicated)
  const logins = [...new Set(results.map((r) => r.author))];
  const nameMap = new Map<string, string>();
  await Promise.all(
    logins.map(async (login) => {
      nameMap.set(login, await getDisplayName(login, token));
    })
  );

  return results.map((r) => ({ ...r, authorName: nameMap.get(r.author) ?? r.author }));
}

async function listPRs(
  repo: string,
  params: string,
  token: string
): Promise<GitHubPR[]> {
  const url = `https://api.github.com/repos/${GITHUB_ORG}/${repo}/pulls?${params}`;
  const res = await fetch(url, {
    // Live activity feed — the URL is static (time filtering happens in JS),
    // so without this Next.js caches the first response and every poll goes
    // stale. Must stay uncached to reflect new PRs/reviews.
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    throw new Error(
      `GitHub API error for ${repo}: ${res.status} ${res.statusText}`
    );
  }
  return res.json();
}

async function ghGet<T>(url: string, token: string): Promise<T> {
  const full = url.startsWith("https://") ? url : `https://api.github.com${url}`;
  const res = await fetch(full, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status} ${res.statusText} (${url})`);
  }
  return res.json();
}

interface GitHubDeployment {
  id: number;
  environment: string;
  created_at: string;
  description: string | null;
  ref: string;
  statuses_url: string;
  creator: { login: string } | null;
}

interface GitHubDeploymentStatus {
  state: string; // success | failure | error | in_progress | queued | pending | inactive
  created_at: string;
}

/**
 * PR + deployment events for one repo since `since`, for the wallboard
 * activity feed. Deployments require the pipeline to create GitHub
 * Deployment records — repos that deploy another way simply yield none.
 */
export async function fetchRepoActivity(
  repo: string,
  since: Date,
  token: string
): Promise<RepoEvent[]> {
  const sinceMs = since.getTime();
  const short = repo.replace(/^istrada-/, "");
  const events: RepoEvent[] = [];

  const [prs, deployments] = await Promise.all([
    listPRs(repo, "state=all&sort=updated&direction=desc&per_page=50", token),
    ghGet<GitHubDeployment[]>(
      `/repos/${GITHUB_ORG}/${repo}/deployments?per_page=10`,
      token
    ).catch(() => [] as GitHubDeployment[]),
  ]);

  for (const pr of prs) {
    const base = {
      repo,
      label: `${short}#${pr.number}`,
      title: pr.title,
      actor: pr.user?.login ?? null,
    };
    if (new Date(pr.created_at).getTime() >= sinceMs) {
      // `draft` reflects the PR's current state — a draft later marked ready
      // shows as a regular open on the next poll (no timestamp for the flip)
      events.push({
        ...base,
        id: `${repo}#${pr.number}-open`,
        kind: pr.draft && !pr.closed_at ? "pr-draft" : "pr-open",
        at: pr.created_at,
      });
    }
    if (pr.merged_at && new Date(pr.merged_at).getTime() >= sinceMs) {
      events.push({ ...base, id: `${repo}#${pr.number}-merged`, kind: "pr-merged", at: pr.merged_at });
    } else if (
      pr.closed_at &&
      !pr.merged_at &&
      new Date(pr.closed_at).getTime() >= sinceMs
    ) {
      events.push({ ...base, id: `${repo}#${pr.number}-closed`, kind: "pr-closed", at: pr.closed_at });
    }
  }

  // Approval events: chase reviews only for PRs updated inside the window,
  // capped so each poll stays cheap against the rate limit
  const recentlyUpdated = prs
    .filter((pr) => new Date(pr.updated_at).getTime() >= sinceMs)
    .slice(0, 20);
  await Promise.all(
    recentlyUpdated.map(async (pr) => {
      const reviews = await ghGet<GitHubReview[]>(
        `/repos/${GITHUB_ORG}/${repo}/pulls/${pr.number}/reviews?per_page=30`,
        token
      ).catch(() => [] as GitHubReview[]);
      for (const review of reviews) {
        if (review.state !== "APPROVED" || !review.submitted_at) continue;
        if (new Date(review.submitted_at).getTime() < sinceMs) continue;
        events.push({
          repo,
          label: `${short}#${pr.number}`,
          title: pr.title,
          actor: review.user?.login ?? null,
          id: `${repo}#${pr.number}-approved-${review.id}`,
          kind: "pr-approved",
          at: review.submitted_at,
        });
      }
    })
  );

  // Only chase statuses for recent deployments to keep the call count low
  const recentDeploys = deployments
    .filter((d) => new Date(d.created_at).getTime() >= sinceMs - 6 * 3_600_000)
    .slice(0, 5);
  await Promise.all(
    recentDeploys.map(async (d) => {
      const base = {
        repo,
        label: `${short} · ${d.environment}`,
        title: d.description || `${repo} deploy of ${d.ref}`,
        actor: d.creator?.login ?? null,
      };
      if (new Date(d.created_at).getTime() >= sinceMs) {
        events.push({ ...base, id: `deploy-${d.id}-start`, kind: "deploy-start", at: d.created_at });
      }
      const statuses = await ghGet<GitHubDeploymentStatus[]>(
        `${d.statuses_url}?per_page=10`,
        token
      ).catch(() => [] as GitHubDeploymentStatus[]);
      const terminal = statuses.find(
        (s) => s.state === "success" || s.state === "failure" || s.state === "error"
      );
      if (terminal && new Date(terminal.created_at).getTime() >= sinceMs) {
        events.push({
          ...base,
          id: `deploy-${d.id}-${terminal.state}`,
          kind: terminal.state === "success" ? "deploy-ok" : "deploy-fail",
          at: terminal.created_at,
        });
      }
    })
  );

  return events;
}

/**
 * Aggregates the wallboard PR stats for one repo: open count, average open-PR
 * age, opened since `since`, merged since `since`. `since` is the viewer's
 * local start-of-day so "today" matches the office clock, not UTC.
 */
export async function fetchPRSummary(
  repo: string,
  since: Date,
  token: string
): Promise<PRSummary> {
  const [allOpen, recentlyCreated, recentlyClosed] = await Promise.all([
    listPRs(repo, "state=open&per_page=100", token),
    listPRs(repo, "state=all&sort=created&direction=desc&per_page=100", token),
    listPRs(repo, "state=closed&sort=updated&direction=desc&per_page=100", token),
  ]);

  const sinceMs = since.getTime();
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const open = allOpen.filter((pr) => !isOnHold(pr));
  const ageDays = (pr: GitHubPR) =>
    (now - new Date(pr.created_at).getTime()) / dayMs;

  return {
    openCount: open.length,
    avgOpenAgeDays:
      open.length === 0
        ? 0
        : open.reduce((sum, pr) => sum + ageDays(pr), 0) / open.length,
    oldestOpenAgeDays:
      open.length === 0 ? 0 : Math.max(...open.map(ageDays)),
    openedToday: recentlyCreated.filter(
      (pr) => new Date(pr.created_at).getTime() >= sinceMs && !isOnHold(pr)
    ).length,
    mergedToday: recentlyClosed.filter(
      (pr) =>
        pr.merged_at &&
        new Date(pr.merged_at).getTime() >= sinceMs &&
        !isOnHold(pr)
    ).length,
  };
}
