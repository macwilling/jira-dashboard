/**
 * Per-developer activity rollup for the wallboard's Team Activity screen.
 *
 * Identity is keyed by Jira accountId. Jira activity (comments, transitions)
 * carries the accountId directly. GitHub PR activity carries a login, which is
 * resolved to an accountId via an explicit `githubUserMap` (login → accountId,
 * configured on /settings) — no name-matching at runtime. A GitHub user with
 * no mapping shows as their own row under their GitHub identity until mapped.
 */

export interface DevActivity {
  /** Jira accountId, or `gh:{login}` for an unmapped GitHub user. */
  key: string;
  name: string;
  avatarUrl: string | null;
  commented: number;
  transitioned: number;
  prOpened: number;
  prApproved: number;
  prMerged: number;
  total: number;
  /** Epoch ms of this person's most recent activity, when inputs carry `at`. */
  lastAt: number | null;
}

export interface TeamActivityInputs {
  comments: { accountId: string; name: string; avatarUrl?: string | null; at?: string }[];
  transitions: { accountId: string; name: string; avatarUrl?: string | null; at?: string }[];
  prs: {
    login: string;
    name: string;
    avatarUrl?: string | null;
    kind: "opened" | "approved" | "merged";
    at?: string;
  }[];
}

export interface TeamActivityOptions {
  /** GitHub login → Jira accountId. */
  githubUserMap?: Record<string, string>;
  /** Jira accountId → display identity, for mapped devs with no Jira activity today. */
  jiraRoster?: Record<string, { name: string; avatarUrl: string | null }>;
}

/**
 * Merge Jira + GitHub activity into one row per person. Jira activity keys on
 * accountId; GitHub PRs resolve login → accountId through `githubUserMap`
 * (case-insensitive), falling back to a standalone GitHub-identity row when
 * unmapped. Rows with no activity are dropped; the rest sort by total desc.
 */
export function buildTeamActivity(
  inputs: TeamActivityInputs,
  { githubUserMap = {}, jiraRoster = {} }: TeamActivityOptions = {}
): DevActivity[] {
  // login (lowercased) → accountId
  const loginToAccount = new Map<string, string>();
  for (const [login, accountId] of Object.entries(githubUserMap)) {
    loginToAccount.set(login.toLowerCase(), accountId);
  }

  const byKey = new Map<string, DevActivity>();
  const ensure = (
    key: string,
    name: string,
    avatarUrl?: string | null
  ): DevActivity => {
    let d = byKey.get(key);
    if (!d) {
      d = {
        key,
        name,
        avatarUrl: avatarUrl ?? null,
        commented: 0,
        transitioned: 0,
        prOpened: 0,
        prApproved: 0,
        prMerged: 0,
        total: 0,
        lastAt: null,
      };
      byKey.set(key, d);
    }
    if (!d.avatarUrl && avatarUrl) d.avatarUrl = avatarUrl;
    return d;
  };
  const touch = (d: DevActivity, at?: string) => {
    if (!at) return d;
    const ms = new Date(at).getTime();
    if (!Number.isNaN(ms) && (d.lastAt === null || ms > d.lastAt)) d.lastAt = ms;
    return d;
  };

  // Jira first, so a person's row is created with their Jira identity.
  for (const c of inputs.comments) {
    touch(ensure(c.accountId, c.name, c.avatarUrl), c.at).commented++;
  }
  for (const t of inputs.transitions) {
    touch(ensure(t.accountId, t.name, t.avatarUrl), t.at).transitioned++;
  }

  for (const p of inputs.prs) {
    const accountId = loginToAccount.get(p.login.toLowerCase());
    let d: DevActivity;
    if (accountId) {
      // Mapped: attribute to the Jira person (roster fills name/avatar if this
      // dev had no Jira activity today).
      const jira = jiraRoster[accountId];
      d = ensure(accountId, jira?.name ?? p.name, jira?.avatarUrl ?? p.avatarUrl);
    } else {
      // Unmapped: show under the GitHub identity as-is.
      d = ensure(`gh:${p.login.toLowerCase()}`, p.name || p.login, p.avatarUrl);
    }
    touch(d, p.at);
    if (p.kind === "opened") d.prOpened++;
    else if (p.kind === "approved") d.prApproved++;
    else d.prMerged++;
  }

  for (const d of byKey.values()) {
    d.total =
      d.commented + d.transitioned + d.prOpened + d.prApproved + d.prMerged;
  }

  return [...byKey.values()]
    .filter((d) => d.total > 0)
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}
