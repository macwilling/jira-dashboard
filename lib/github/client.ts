import { PRRecord } from "./types";

const GITHUB_ORG = "sysdynetechnologies";

interface GitHubPR {
  number: number;
  title: string;
  html_url: string;
  merged_at: string | null;
  updated_at: string;
  user: {
    login: string;
    name?: string | null;
  } | null;
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
