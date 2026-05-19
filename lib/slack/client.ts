/**
 * Slack bot client — posts to `chat.postMessage` with an `xoxb-…` bot token.
 *
 * Replaces the earlier incoming-webhook path. The bot token is server-only
 * (env var, never surfaced to the browser). Every helper here returns safe,
 * minimally-projected data so callers can hand it to the client without
 * leaking email/phone/workspace metadata.
 */

const SLACK_API = "https://slack.com/api";

export function hasSlackBotToken(): boolean {
  return !!process.env.SLACK_BOT_TOKEN;
}

function getBotToken(): string {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    throw new Error(
      "SLACK_BOT_TOKEN is not set. Add it to .env.local (local) or Vercel env (prod).",
    );
  }
  return token;
}

interface SlackApiResponse {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

async function slackFetch<T extends SlackApiResponse>(
  method: string,
  opts: {
    body?: Record<string, unknown>;
    query?: Record<string, string | number | undefined>;
  } = {},
): Promise<T> {
  const token = getBotToken();
  const url = new URL(`${SLACK_API}/${method}`);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== null && v !== "") {
        url.searchParams.set(k, String(v));
      }
    }
  }

  const res = await fetch(url, {
    method: opts.body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
  });

  // Never echo headers or request body in errors — would leak the token.
  if (res.status === 429) {
    const retryAfter = res.headers.get("retry-after") ?? "?";
    console.warn(`[slack] 429 rate-limited on ${method} (retry-after=${retryAfter}s)`);
    throw new Error(`Slack rate-limited ${method} (retry-after=${retryAfter}s)`);
  }

  let json: T;
  try {
    json = (await res.json()) as T;
  } catch {
    throw new Error(`Slack ${method} returned non-JSON (status ${res.status})`);
  }

  if (!json.ok) {
    throw new Error(`Slack ${method} failed: ${json.error ?? "unknown"}`);
  }
  return json;
}

// ─────────────────────────────────────────────────────────────────────────────
// chat.postMessage

export interface PostMessageArgs {
  /** Channel ID (C…, G…, D…) or user ID (U…) for a DM. Plain channel names
   *  like "#general" are deprecated and intentionally not supported. */
  channel: string;
  text: string;
  blocks?: unknown[];
}

export interface PostMessageResult {
  ts: string;
  channel: string;
}

export async function postSlackMessage(
  args: PostMessageArgs,
): Promise<PostMessageResult> {
  const body: Record<string, unknown> = {
    channel: args.channel,
    text: args.text,
  };
  if (args.blocks) body.blocks = args.blocks;

  const json = await slackFetch<
    SlackApiResponse & { ts: string; channel: string }
  >("chat.postMessage", { body });
  return { ts: json.ts, channel: json.channel };
}

// ─────────────────────────────────────────────────────────────────────────────
// chat.update — edit an existing message. Used to finalize approval requests
// ("✅ Approved by …") and mark superseded ones stale.

export interface UpdateMessageArgs {
  channel: string;
  ts: string;
  text: string;
  blocks?: unknown[];
}

export async function updateSlackMessage(args: UpdateMessageArgs): Promise<void> {
  const body: Record<string, unknown> = {
    channel: args.channel,
    ts: args.ts,
    text: args.text,
  };
  // Slack requires blocks to be explicit on update — if omitted, the old blocks
  // remain. We always pass (possibly empty) so the UI reflects the new state.
  body.blocks = args.blocks ?? [];
  await slackFetch<SlackApiResponse>("chat.update", { body });
}

// ─────────────────────────────────────────────────────────────────────────────
// views.open — opens a modal triggered by a slash command or shortcut

export async function openSlackModal(
  triggerId: string,
  view: unknown,
): Promise<void> {
  await slackFetch<SlackApiResponse>("views.open", {
    body: { trigger_id: triggerId, view },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// views.update — re-render an open modal in place. Used to pre-fill support
// modals once a Freshdesk ticket is chosen. `hash` guards against clobbering a
// view the user changed concurrently; it's optional and we pass it when known.

export async function updateSlackModal(
  viewId: string,
  view: unknown,
  hash?: string,
): Promise<void> {
  const body: Record<string, unknown> = { view_id: viewId, view };
  if (hash) body.hash = hash;
  await slackFetch<SlackApiResponse>("views.update", { body });
}

// ─────────────────────────────────────────────────────────────────────────────
// auth.test

export interface AuthTestResult {
  team: string;
  teamId: string;
  user: string;
  userId: string;
  botId?: string;
  url: string;
}

export async function slackAuthTest(): Promise<AuthTestResult> {
  const json = await slackFetch<
    SlackApiResponse & {
      team: string;
      team_id: string;
      user: string;
      user_id: string;
      bot_id?: string;
      url: string;
    }
  >("auth.test");
  return {
    team: json.team,
    teamId: json.team_id,
    user: json.user,
    userId: json.user_id,
    botId: json.bot_id,
    url: json.url,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// conversations.list — projected to minimal fields

export interface SlackChannel {
  id: string;
  name: string;
  isPrivate: boolean;
  isMember: boolean;
}

interface RawChannel {
  id: string;
  name?: string;
  is_private?: boolean;
  is_member?: boolean;
  is_archived?: boolean;
}

export async function listSlackChannels(): Promise<SlackChannel[]> {
  const out: SlackChannel[] = [];
  let cursor: string | undefined;

  // `channels:read` covers public channels only. Requesting private_channel
  // without `groups:read` errors with `missing_scope` — Slack rejects the
  // whole call rather than silently dropping the unscoped type. To add
  // private channels later, add `groups:read` to the Slack app and expand
  // the `types` param below to "public_channel,private_channel".
  do {
    const json = await slackFetch<
      SlackApiResponse & {
        channels?: RawChannel[];
        response_metadata?: { next_cursor?: string };
      }
    >("conversations.list", {
      query: {
        types: "public_channel",
        exclude_archived: "true",
        limit: 200,
        cursor,
      },
    });
    for (const c of json.channels ?? []) {
      if (c.is_archived || !c.name) continue;
      out.push({
        id: c.id,
        name: c.name,
        isPrivate: !!c.is_private,
        isMember: !!c.is_member,
      });
    }
    cursor = json.response_metadata?.next_cursor || undefined;
  } while (cursor);

  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// users.list — projected to strip emails/phones/titles

export interface SlackUser {
  id: string;
  name: string;
  displayName: string;
  avatar: string | null;
}

interface RawUser {
  id: string;
  name?: string;
  deleted?: boolean;
  is_bot?: boolean;
  is_app_user?: boolean;
  profile?: {
    real_name?: string;
    display_name?: string;
    image_48?: string;
    image_72?: string;
  };
}

export async function listSlackUsers(): Promise<SlackUser[]> {
  const out: SlackUser[] = [];
  let cursor: string | undefined;

  do {
    const json = await slackFetch<
      SlackApiResponse & {
        members?: RawUser[];
        response_metadata?: { next_cursor?: string };
      }
    >("users.list", { query: { limit: 200, cursor } });

    for (const u of json.members ?? []) {
      if (u.deleted || u.is_bot || u.is_app_user) continue;
      if (u.id === "USLACKBOT") continue;
      const profile = u.profile ?? {};
      // Explicit allow-list — do NOT spread the raw profile. email, phone,
      // status, and title would leak if we did.
      out.push({
        id: u.id,
        name: u.name ?? "",
        displayName: profile.display_name || profile.real_name || u.name || u.id,
        avatar: profile.image_48 ?? profile.image_72 ?? null,
      });
    }
    cursor = json.response_metadata?.next_cursor || undefined;
  } while (cursor);

  out.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return out;
}
