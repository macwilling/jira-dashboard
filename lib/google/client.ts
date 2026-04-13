/**
 * Google OAuth + API client.
 *
 * Setup (one-time, in Google Cloud Console):
 *   1. Create a project and enable the Tasks API and Calendar API.
 *   2. Create an OAuth 2.0 Client ID (type: Web Application).
 *   3. Add your Vercel domain's callback URL as an Authorized Redirect URI:
 *        https://<your-vercel-domain>/api/auth/google/callback
 *   4. Copy the Client ID and Client Secret into your env vars:
 *        GOOGLE_CLIENT_ID=...
 *        GOOGLE_CLIENT_SECRET=...
 *
 * After setup, visit /settings and click "Connect Google" to authorize.
 * The refresh token is stored in Cloudflare KV under the key "google-credentials".
 */

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const KV_CREDENTIALS_KEY = "google-credentials";

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/tasks",
  "https://www.googleapis.com/auth/calendar.events",
  "openid",
  "email",
].join(" ");

// ─── Credential types ──────────────────────────────────────────────────────────

export interface GoogleCredentials {
  refreshToken: string;
  email: string;
  connectedAt: string;
}

// ─── KV helpers (reuses existing Cloudflare KV config) ────────────────────────

function getCfKvConfig() {
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const namespaceId = process.env.CLOUDFLARE_KV_NAMESPACE_ID;
  if (!apiToken || !accountId || !namespaceId) return null;
  return { apiToken, accountId, namespaceId };
}

function kvUrl(accountId: string, namespaceId: string, key: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`;
}

export async function getGoogleCredentials(): Promise<GoogleCredentials | null> {
  const cf = getCfKvConfig();
  if (!cf) return null;
  try {
    const res = await fetch(kvUrl(cf.accountId, cf.namespaceId, KV_CREDENTIALS_KEY), {
      headers: { Authorization: `Bearer ${cf.apiToken}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text) as GoogleCredentials;
  } catch {
    return null;
  }
}

export async function saveGoogleCredentials(creds: GoogleCredentials): Promise<void> {
  const cf = getCfKvConfig();
  if (!cf) throw new Error("Cloudflare KV not configured");
  const res = await fetch(kvUrl(cf.accountId, cf.namespaceId, KV_CREDENTIALS_KEY), {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${cf.apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(creds),
  });
  if (!res.ok) throw new Error(`KV write failed: ${res.status}`);
}

export async function deleteGoogleCredentials(): Promise<void> {
  const cf = getCfKvConfig();
  if (!cf) return;
  await fetch(kvUrl(cf.accountId, cf.namespaceId, KV_CREDENTIALS_KEY), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${cf.apiToken}` },
  });
}

// ─── OAuth helpers ─────────────────────────────────────────────────────────────

export function hasGoogleConfig(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function buildAuthUrl(redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES,
    access_type: "offline",
    prompt: "consent", // force refresh_token on every auth
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  id_token?: string;
  token_type: string;
}

export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string
): Promise<TokenResponse> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${body}`);
  }
  return res.json();
}

/**
 * Uses the stored refresh token to get a fresh access token.
 * Throws if credentials are not stored or the refresh fails.
 */
export async function getAccessToken(): Promise<string> {
  const creds = await getGoogleCredentials();
  if (!creds) throw new Error("Google account not connected — visit /settings to connect");

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: creds.refreshToken,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token refresh failed: ${res.status} ${body}`);
  }

  const data = (await res.json()) as TokenResponse;
  return data.access_token;
}

/** Decode the email from a JWT id_token (no signature verification needed here). */
export function emailFromIdToken(idToken: string): string {
  try {
    const payload = idToken.split(".")[1];
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8")) as {
      email?: string;
    };
    return decoded.email ?? "unknown";
  } catch {
    return "unknown";
  }
}

// ─── Google Tasks API ──────────────────────────────────────────────────────────

export interface TaskList {
  id: string;
  title: string;
}

export async function listTaskLists(): Promise<TaskList[]> {
  const token = await getAccessToken();
  const res = await fetch(
    "https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=100",
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
  );
  if (!res.ok) throw new Error(`Tasks API error: ${res.status}`);
  const data = (await res.json()) as { items?: TaskList[] };
  return data.items ?? [];
}

/**
 * Creates a Google Task.
 * dueDate: ISO date string (YYYY-MM-DD). Google Tasks expects RFC3339 UTC midnight.
 */
export async function createGoogleTask(
  taskListId: string,
  title: string,
  dueDate: string | null
): Promise<string> {
  const token = await getAccessToken();

  const body: Record<string, string> = { title };
  if (dueDate) {
    // Google Tasks due dates must be RFC3339 UTC midnight
    body.due = `${dueDate}T00:00:00.000Z`;
  }

  const res = await fetch(
    `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(taskListId)}/tasks`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Create task failed: ${res.status} ${text}`);
  }

  const task = (await res.json()) as { id: string };
  return task.id;
}

// ─── Google Calendar API ───────────────────────────────────────────────────────

export interface CalendarListEntry {
  id: string;
  summary: string;
  primary?: boolean;
}

export async function listCalendars(): Promise<CalendarListEntry[]> {
  const token = await getAccessToken();
  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=writer",
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
  );
  if (!res.ok) throw new Error(`Calendar API error: ${res.status}`);
  const data = (await res.json()) as { items?: CalendarListEntry[] };
  return data.items ?? [];
}

/**
 * Creates an all-day calendar event on the given date.
 * Returns the event ID.
 */
export async function createCalendarEvent(
  calendarId: string,
  summary: string,
  date: string // YYYY-MM-DD
): Promise<string> {
  const token = await getAccessToken();

  const body = {
    summary,
    start: { date },
    end: { date },
  };

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Create event failed: ${res.status} ${text}`);
  }

  const event = (await res.json()) as { id: string };
  return event.id;
}
