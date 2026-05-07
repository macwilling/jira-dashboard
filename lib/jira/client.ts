import { JiraSearchResponse, JiraSprint, JiraChangelogResponse } from "./types";

const BASE_FIELDS = [
  "summary",
  "status",
  "priority",
  "issuetype",
  "assignee",
  "labels",
  "description",
  "updated",
  "issuelinks",
  "comment",
  "attachment",
  "parent",
  "fixVersions",
  "customfield_10014", // Epic Link (classic)
  "customfield_10011", // Epic color
];

const DEFAULT_SPRINT_FIELD = "customfield_10020";

function buildFieldsList(sprintFieldId?: string): string {
  const sprintField = sprintFieldId || DEFAULT_SPRINT_FIELD;
  return [...BASE_FIELDS, sprintField].join(",");
}

function getCredentials() {
  const url = process.env.JIRA_URL;
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;

  if (!url || !email || !token) {
    return null;
  }

  return {
    baseUrl: url.replace(/\/$/, ""),
    auth: Buffer.from(`${email}:${token}`).toString("base64"),
  };
}

export function hasJiraCredentials(): boolean {
  return getCredentials() !== null;
}

/** Fetch epic color via Agile API. Returns a hex color or null. */
export async function fetchEpicColor(epicKey: string): Promise<string | null> {
  try {
    const data = await jiraFetch<{ color?: { key?: string } }>(
      `/rest/agile/1.0/epic/${epicKey}`
    );
    // Agile API returns color as { key: "color_1" } etc.
    return data.color?.key || null;
  } catch {
    return null;
  }
}

/** Batch-fetch epic colors for a set of epic keys. Returns a map of epicKey -> color name. */
export async function fetchEpicColors(epicKeys: string[]): Promise<Map<string, string>> {
  const colorMap = new Map<string, string>();
  // Fetch in parallel, max 10 concurrent
  const chunks: string[][] = [];
  for (let i = 0; i < epicKeys.length; i += 10) {
    chunks.push(epicKeys.slice(i, i + 10));
  }
  for (const chunk of chunks) {
    const results = await Promise.allSettled(
      chunk.map(async (key) => {
        const color = await fetchEpicColor(key);
        if (color) colorMap.set(key, color);
      })
    );
    void results; // consume
  }
  return colorMap;
}

async function jiraFetch<T>(
  path: string,
  params?: Record<string, string>
): Promise<T> {
  const creds = getCredentials();
  if (!creds) {
    throw new Error("Jira credentials not configured");
  }

  const url = new URL(`${creds.baseUrl}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Basic ${creds.auth}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Jira API error ${res.status}: ${body.slice(0, 200)}`);
  }

  return res.json();
}

export async function searchIssues(
  jql: string,
  maxResults = 100,
  nextPageToken?: string,
  sprintFieldId?: string
): Promise<JiraSearchResponse> {
  const params: Record<string, string> = {
    jql,
    fields: buildFieldsList(sprintFieldId),
    maxResults: String(maxResults),
  };
  if (nextPageToken) {
    params.nextPageToken = nextPageToken;
  }
  return jiraFetch<JiraSearchResponse>("/rest/api/3/search/jql", params);
}

export async function searchAllIssues(
  jql: string,
  sprintFieldId?: string
): Promise<JiraSearchResponse["issues"]> {
  const allIssues: JiraSearchResponse["issues"] = [];
  let nextPageToken: string | undefined;

  while (true) {
    const response = await searchIssues(jql, 100, nextPageToken, sprintFieldId);
    allIssues.push(...response.issues);

    if (response.isLast || !response.nextPageToken) {
      break;
    }
    nextPageToken = response.nextPageToken;
  }

  return allIssues;
}

export async function searchText(
  query: string,
  maxResults = 20
): Promise<JiraSearchResponse> {
  const jql = `text ~ "${query.replace(/"/g, '\\"')}" ORDER BY updated DESC`;
  return searchIssues(jql, maxResults);
}

// Discover the sprint custom field ID by querying Jira field metadata
export async function discoverSprintFieldId(): Promise<string | null> {
  try {
    const fields = await jiraFetch<Array<{ id: string; name: string; schema?: { custom?: string } }>>(
      "/rest/api/3/field"
    );
    const sprintField = fields.find(
      (f) => f.name.toLowerCase() === "sprint" || f.schema?.custom === "com.pyxis.greenhopper.jira:gh-sprint"
    );
    return sprintField?.id || null;
  } catch {
    return null;
  }
}

// Discover board IDs from the Jira Agile API
export async function discoverBoards(): Promise<Array<{ id: number; name: string }>> {
  try {
    const data = await jiraFetch<{ values: Array<{ id: number; name: string }> }>(
      "/rest/agile/1.0/board",
      { maxResults: "50" }
    );
    return data.values || [];
  } catch {
    return [];
  }
}

// Fetch the active sprint from the Jira Agile board API (fallback when the
// sprint custom field isn't populated in search results).
export async function fetchActiveSprint(boardId: string): Promise<JiraSprint | null> {
  try {
    const data = await jiraFetch<{ values: JiraSprint[] }>(
      `/rest/agile/1.0/board/${boardId}/sprint`,
      { state: "active" }
    );
    if (data.values && data.values.length > 0) {
      return data.values[0];
    }
    return null;
  } catch {
    // The Agile API may not be available on all Jira instances
    return null;
  }
}

/** Fetch changelog for a single issue. Returns raw Jira changelog response. */
export async function fetchChangelog(issueKey: string): Promise<JiraChangelogResponse> {
  return jiraFetch<JiraChangelogResponse>(
    `/rest/api/3/issue/${issueKey}/changelog`
  );
}

export interface CreateIssueParams {
  projectKey: string;
  issueType: string;
  summary: string;
  description?: AdfDoc;
  labels?: string[];
}

export interface CreateIssueResult {
  id: string;
  key: string;
  self: string;
}

interface AdfTextNode {
  type: "text";
  text: string;
  marks?: Array<{ type: string; attrs?: Record<string, string> }>;
}

interface AdfParagraph {
  type: "paragraph";
  content: AdfTextNode[];
}

interface AdfHeading {
  type: "heading";
  attrs: { level: number };
  content: AdfTextNode[];
}

export interface AdfDoc {
  type: "doc";
  version: 1;
  content: Array<AdfParagraph | AdfHeading>;
}

export function adfDoc(blocks: Array<AdfParagraph | AdfHeading>): AdfDoc {
  return { type: "doc", version: 1, content: blocks };
}

export function adfParagraph(text: string): AdfParagraph {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

export function adfHeading(text: string, level = 3): AdfHeading {
  return { type: "heading", attrs: { level }, content: [{ type: "text", text }] };
}

export function adfParagraphWithLink(
  linkText: string,
  href: string,
  suffix?: string,
): AdfParagraph {
  const content: AdfTextNode[] = [
    {
      type: "text",
      text: linkText,
      marks: [{ type: "link", attrs: { href } }],
    },
  ];
  if (suffix) content.push({ type: "text", text: suffix });
  return { type: "paragraph", content };
}

export async function createIssue(
  params: CreateIssueParams,
): Promise<CreateIssueResult> {
  const creds = getCredentials();
  if (!creds) throw new Error("Jira credentials not configured");

  const fields: Record<string, unknown> = {
    project: { key: params.projectKey },
    issuetype: { name: params.issueType },
    summary: params.summary,
    labels: params.labels ?? [],
  };
  if (params.description) fields.description = params.description;

  const res = await fetch(`${creds.baseUrl}/rest/api/3/issue`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${creds.auth}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ fields }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Jira createIssue failed ${res.status}: ${text.slice(0, 300)}`);
  }

  return res.json() as Promise<CreateIssueResult>;
}

export async function testConnection(): Promise<{
  ok: boolean;
  error?: string;
  user?: string;
}> {
  try {
    const creds = getCredentials();
    if (!creds) {
      return { ok: false, error: "Jira credentials not configured in environment variables" };
    }

    const res = await fetch(`${creds.baseUrl}/rest/api/3/myself`, {
      headers: {
        Authorization: `Basic ${creds.auth}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      return { ok: false, error: `Authentication failed (${res.status})` };
    }

    const user = await res.json();
    return { ok: true, user: user.displayName };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
