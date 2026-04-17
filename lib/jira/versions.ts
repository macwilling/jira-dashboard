/**
 * Fetch Jira project versions (Fix Versions) for cron-based drift recovery.
 *
 * Used by the recovery endpoint to diff against the app's D1 state and replay
 * any missed webhooks. Not wired into the dashboard because the standup UI
 * deals with issues, not releases.
 */

export interface JiraProjectVersion {
  id: string;
  projectId: number;
  name: string;
  description?: string;
  releaseDate?: string;
  startDate?: string;
  released?: boolean;
  archived?: boolean;
}

function getCredentials() {
  const url = process.env.JIRA_URL;
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!url || !email || !token) return null;
  return {
    baseUrl: url.replace(/\/$/, ""),
    auth: Buffer.from(`${email}:${token}`).toString("base64"),
  };
}

/**
 * List all versions for a project. Jira returns both released and unreleased;
 * the recovery code filters as needed. Uses the v3 REST API.
 */
export async function listProjectVersions(
  projectKey: string,
): Promise<JiraProjectVersion[]> {
  const creds = getCredentials();
  if (!creds) {
    throw new Error(
      "Jira credentials missing — set JIRA_URL, JIRA_EMAIL, JIRA_API_TOKEN",
    );
  }
  const res = await fetch(
    `${creds.baseUrl}/rest/api/3/project/${encodeURIComponent(projectKey)}/versions`,
    {
      headers: {
        Authorization: `Basic ${creds.auth}`,
        Accept: "application/json",
      },
      cache: "no-store",
    },
  );
  if (!res.ok) {
    throw new Error(
      `Jira versions fetch failed: ${res.status} ${await res.text().catch(() => "")}`,
    );
  }
  const data = (await res.json()) as JiraProjectVersion[];
  return Array.isArray(data) ? data : [];
}
