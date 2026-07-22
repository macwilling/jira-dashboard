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
  // calendar.events lets us create/update events but not list calendars —
  // we need the calendarlist.readonly scope for the picker in the template editor.
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  // Full Drive access: the Read AI bridge reads the Obsidian vault tree and
  // writes meeting notes/transcripts into it (drive.file wouldn't see
  // pre-existing vault files). Reconnect in /settings after scope changes.
  "https://www.googleapis.com/auth/drive",
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

export interface CreatedExternalRef {
  id: string;
  url: string;
}

export interface CreateGoogleTaskInput {
  taskListId: string;
  title: string;
  notes: string | null;
  dueDate: string | null;
}

/**
 * Creates a Google Task. Only the date portion of `dueDate` is retained —
 * the Tasks API explicitly discards any time component.
 */
export async function createGoogleTask(
  input: CreateGoogleTaskInput,
): Promise<CreatedExternalRef> {
  const token = await getAccessToken();

  const body: Record<string, string> = { title: input.title };
  if (input.notes) body.notes = input.notes;
  if (input.dueDate) body.due = `${input.dueDate}T00:00:00.000Z`;

  const res = await fetch(
    `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(input.taskListId)}/tasks`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Create task failed: ${res.status} ${text}`);
  }

  const task = (await res.json()) as { id: string; selfLink?: string };
  return { id: task.id, url: "https://tasks.google.com/embed/list/~default" };
}

export type GoogleTaskStatus = "needsAction" | "completed" | "missing";

/** Fetch the remote status of a Google Task. Returns "missing" if the task was deleted. */
export async function getGoogleTaskStatus(
  taskListId: string,
  taskId: string,
): Promise<GoogleTaskStatus> {
  const token = await getAccessToken();
  const res = await fetch(
    `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
  );
  if (res.status === 404) return "missing";
  if (!res.ok) throw new Error(`Get task failed: ${res.status}`);
  const data = (await res.json()) as { status?: string };
  return data.status === "completed" ? "completed" : "needsAction";
}

export interface GoogleTaskDetails {
  status: "needsAction" | "completed";
  /** YYYY-MM-DD or null. Google stores due as an ISO timestamp; we only use the date portion. */
  due: string | null;
}

/**
 * Fetch full details for drift detection. Returns null if the task was deleted.
 */
export async function getGoogleTaskDetails(
  taskListId: string,
  taskId: string,
): Promise<GoogleTaskDetails | null> {
  const token = await getAccessToken();
  const res = await fetch(
    `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Get task failed: ${res.status}`);
  const data = (await res.json()) as { status?: string; due?: string };
  return {
    status: data.status === "completed" ? "completed" : "needsAction",
    due: data.due ? data.due.slice(0, 10) : null,
  };
}

/** Update a Google Task's due date. `dueDate` is YYYY-MM-DD or null to clear. */
export async function updateGoogleTaskDue(
  taskListId: string,
  taskId: string,
  dueDate: string | null,
): Promise<void> {
  const token = await getAccessToken();
  const body: Record<string, string | null> = {
    due: dueDate ? `${dueDate}T00:00:00.000Z` : null,
  };
  const res = await fetch(
    `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Update task failed: ${res.status} ${text}`);
  }
}

/** Delete a Google Task. 404 is treated as success (already gone). */
export async function deleteGoogleTask(
  taskListId: string,
  taskId: string,
): Promise<void> {
  const token = await getAccessToken();
  const res = await fetch(
    `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
  );
  if (res.status === 404) return;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Delete task failed: ${res.status} ${text}`);
  }
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

export interface CreateCalendarEventInput {
  calendarId: string;
  summary: string;
  description: string | null;
  date: string;               // YYYY-MM-DD
  startTime: string | null;   // "HH:MM" — null for all-day
  durationMinutes: number;    // ignored for all-day
  timeZone: string;           // IANA, e.g. "America/New_York"
}

function buildCalendarEventBody(input: {
  summary: string;
  description: string | null;
  date: string;
  startTime: string | null;
  durationMinutes: number;
  timeZone: string;
}) {
  const base: Record<string, unknown> = { summary: input.summary };
  if (input.description) base.description = input.description;

  if (!input.startTime) {
    // All-day — Google treats end.date as exclusive so it must be the next day
    // for a single-day event. We stick with start=end=date to match existing
    // behavior; Google auto-adjusts single-day all-day events either way.
    base.start = { date: input.date };
    base.end = { date: input.date };
  } else {
    const [h, m] = input.startTime.split(":").map((n) => parseInt(n, 10));
    const startDate = new Date(`${input.date}T${input.startTime}:00`);
    const endDate = new Date(startDate.getTime() + input.durationMinutes * 60_000);
    const pad = (n: number) => n.toString().padStart(2, "0");
    const startStr = `${input.date}T${pad(h)}:${pad(m)}:00`;
    const endStr =
      `${endDate.getFullYear()}-${pad(endDate.getMonth() + 1)}-${pad(endDate.getDate())}` +
      `T${pad(endDate.getHours())}:${pad(endDate.getMinutes())}:00`;
    base.start = { dateTime: startStr, timeZone: input.timeZone };
    base.end = { dateTime: endStr, timeZone: input.timeZone };
  }
  return base;
}

export async function createCalendarEvent(
  input: CreateCalendarEventInput,
): Promise<CreatedExternalRef> {
  const token = await getAccessToken();
  const body = buildCalendarEventBody(input);

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Create event failed: ${res.status} ${text}`);
  }

  const event = (await res.json()) as { id: string; htmlLink?: string };
  return {
    id: event.id,
    url: event.htmlLink ?? `https://calendar.google.com/calendar/r/eventedit/${event.id}`,
  };
}

export type CalendarEventStatus = "confirmed" | "tentative" | "cancelled" | "missing";

export async function getCalendarEventStatus(
  calendarId: string,
  eventId: string,
): Promise<CalendarEventStatus> {
  const token = await getAccessToken();
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
  );
  if (res.status === 404) return "missing";
  if (!res.ok) throw new Error(`Get event failed: ${res.status}`);
  const data = (await res.json()) as { status?: CalendarEventStatus };
  return data.status ?? "confirmed";
}

export interface CalendarEventDetails {
  status: "confirmed" | "tentative" | "cancelled";
  /** Non-null iff all-day. YYYY-MM-DD. */
  startDate: string | null;
  /** Non-null iff timed. YYYY-MM-DD (local to the event's timezone). */
  startDateTimeDate: string | null;
  /** Non-null iff timed. "HH:MM" (local to the event's timezone). */
  startDateTimeTime: string | null;
  /** Raw ISO dateTime for display; null for all-day. */
  startDateTimeIso: string | null;
}

/**
 * Fetch full calendar event details for drift detection. Returns null if missing.
 *
 * The start.dateTime from Google arrives as "YYYY-MM-DDTHH:MM:SS±HH:MM" — already
 * in the event's timezone — so we slice rather than parsing (which would convert
 * to the server's local tz and corrupt the comparison).
 */
export async function getCalendarEventDetails(
  calendarId: string,
  eventId: string,
): Promise<CalendarEventDetails | null> {
  const token = await getAccessToken();
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Get event failed: ${res.status}`);
  const data = (await res.json()) as {
    status?: "confirmed" | "tentative" | "cancelled";
    start?: { date?: string; dateTime?: string };
  };
  const status = data.status ?? "confirmed";
  const startDate = data.start?.date ?? null;
  const startDateTimeIso = data.start?.dateTime ?? null;
  return {
    status,
    startDate,
    startDateTimeIso,
    startDateTimeDate: startDateTimeIso ? startDateTimeIso.slice(0, 10) : null,
    startDateTimeTime: startDateTimeIso ? startDateTimeIso.slice(11, 16) : null,
  };
}

/**
 * Update a calendar event's date — preserves the event's timed vs all-day
 * shape based on the flags passed in. For timed events, recomputes the end
 * from `durationMinutes` so a moved start doesn't leave a dangling duration.
 */
export async function updateCalendarEventDate(
  calendarId: string,
  eventId: string,
  params: {
    date: string;
    startTime: string | null;
    durationMinutes: number;
    timeZone: string;
  },
): Promise<void> {
  const token = await getAccessToken();
  const body = buildCalendarEventBody({
    summary: "", // ignored on PATCH unless explicitly set
    description: null,
    ...params,
  });
  // Remove summary so we don't overwrite it on PATCH.
  delete (body as Record<string, unknown>).summary;

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Update event failed: ${res.status} ${text}`);
  }
}

/** Delete a Calendar event. 404 / 410 are treated as success (already gone). */
export async function deleteCalendarEvent(
  calendarId: string,
  eventId: string,
): Promise<void> {
  const token = await getAccessToken();
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
  );
  if (res.status === 404 || res.status === 410) return;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Delete event failed: ${res.status} ${text}`);
  }
}
