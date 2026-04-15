/**
 * Slack message builder for release approval requests.
 *
 * The message lists every task that will be dispatched (label + due date) and
 * carries Approve / Cancel buttons. The button values encode
 * `{releaseId}:{approvalVersion}` so a stale click (from a superseded message)
 * can be rejected at the interactive endpoint without relying on the message ts.
 */

import type { Release, ReleaseTaskInstance } from "./types";

export const APPROVE_ACTION_ID = "release_approve";
export const CANCEL_ACTION_ID = "release_cancel";
// Distinct action_ids for the settings-page round-trip test so a misdirected
// click on a test message can never affect a real release.
export const TEST_APPROVE_ACTION_ID = "approval_test_approve";
export const TEST_CANCEL_ACTION_ID = "approval_test_cancel";

/** Encode the release + version into a button value. 8-char-safe. */
export function encodeButtonValue(releaseId: string, version: number): string {
  return `${releaseId}:${version}`;
}

export function decodeButtonValue(
  raw: string,
): { releaseId: string; version: number } | null {
  const idx = raw.lastIndexOf(":");
  if (idx < 0) return null;
  const releaseId = raw.slice(0, idx);
  const version = Number(raw.slice(idx + 1));
  if (!releaseId || !Number.isFinite(version)) return null;
  return { releaseId, version };
}

function fmtDueDate(iso: string | null): string {
  if (!iso) return "no date";
  // Render MM/DD so the message is compact. Users who need the year can cross-ref in Jira.
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (isNaN(d.getTime())) return iso;
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

function fmtActionTypeIcon(t: string): string {
  if (t === "calendar_event") return "📅";
  if (t === "google_task") return "☑️";
  return "•";
}

export interface ApprovalMessageArgs {
  release: Pick<Release, "id" | "name" | "releaseDate">;
  instances: ReleaseTaskInstance[];
  approvalVersion: number;
  /** Absolute URL to the release detail page, e.g. https://…/releases/abc. */
  releaseUrl: string;
}

/**
 * Compose the blocks for a pending-approval message. Called on initial post
 * and on supersede (new version after a Jira update).
 */
export function buildApprovalBlocks(args: ApprovalMessageArgs): {
  text: string;
  blocks: unknown[];
} {
  const { release, instances, approvalVersion, releaseUrl } = args;
  const dateLabel = release.releaseDate
    ? release.releaseDate.slice(0, 10)
    : "no release date";

  const fallbackText =
    `Approve tasks for ${release.name} (${dateLabel}) — ${instances.length} task${instances.length === 1 ? "" : "s"}`;

  // Slack caps a section block's mrkdwn text at 3000 chars. Long lists get
  // truncated with a "… +N more" line at the end. Each line is < 100 chars in
  // practice so 25 rows fits comfortably.
  const MAX_LINES = 25;
  const lines: string[] = instances.slice(0, MAX_LINES).map((i) => {
    const icon = fmtActionTypeIcon(i.actionType);
    const when = fmtDueDate(i.dueDate);
    return `${icon} *${escapeMrkdwn(i.label)}* — _${when}_`;
  });
  if (instances.length > MAX_LINES) {
    lines.push(`…and ${instances.length - MAX_LINES} more`);
  }

  const header = `:rocket: *Approve release tasks*\n*${escapeMrkdwn(release.name)}* · ${dateLabel} · ${instances.length} task${instances.length === 1 ? "" : "s"}`;

  const value = encodeButtonValue(release.id, approvalVersion);

  return {
    text: fallbackText,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: header } },
      { type: "divider" },
      {
        type: "section",
        text: { type: "mrkdwn", text: lines.join("\n") || "_No tasks_" },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            action_id: APPROVE_ACTION_ID,
            style: "primary",
            text: { type: "plain_text", text: "Approve & dispatch" },
            value,
          },
          {
            type: "button",
            action_id: CANCEL_ACTION_ID,
            style: "danger",
            text: { type: "plain_text", text: "Cancel" },
            value,
          },
          {
            type: "button",
            action_id: "release_view",
            text: { type: "plain_text", text: "View in app" },
            url: releaseUrl,
          },
        ],
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `v${approvalVersion} · If the Jira release changes, this request will be superseded.`,
          },
        ],
      },
    ],
  };
}

/** Message rendered in-place when the user clicks Approve. */
export function buildApprovedBlocks(args: {
  release: Pick<Release, "name">;
  approvedByUserId: string | null;
  approvedAt: string;
  taskCount: number;
  releaseUrl: string;
}): { text: string; blocks: unknown[] } {
  const who = args.approvedByUserId ? `<@${args.approvedByUserId}>` : "someone";
  const when = formatTime(args.approvedAt);
  const text = `Approved tasks for ${args.release.name}`;
  return {
    text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:white_check_mark: *Approved* · *${escapeMrkdwn(args.release.name)}* · ${args.taskCount} task${args.taskCount === 1 ? "" : "s"} dispatching\nApproved by ${who} at ${when}`,
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            action_id: "release_view",
            text: { type: "plain_text", text: "View in app" },
            url: args.releaseUrl,
          },
        ],
      },
    ],
  };
}

/** Message rendered in-place when the user clicks Cancel. */
export function buildCancelledBlocks(args: {
  release: Pick<Release, "name">;
  cancelledByUserId: string | null;
  releaseUrl: string;
}): { text: string; blocks: unknown[] } {
  const who = args.cancelledByUserId ? `<@${args.cancelledByUserId}>` : "someone";
  return {
    text: `Cancelled approval for ${args.release.name}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:no_entry: *Cancelled* · *${escapeMrkdwn(args.release.name)}* · tasks not dispatched\nCancelled by ${who}`,
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            action_id: "release_view",
            text: { type: "plain_text", text: "View in app" },
            url: args.releaseUrl,
          },
        ],
      },
    ],
  };
}

/** Edit the OLD message when a newer approval request supersedes it. */
export function buildSupersededBlocks(args: {
  release: Pick<Release, "name">;
}): { text: string; blocks: unknown[] } {
  return {
    text: `Superseded approval request for ${args.release.name}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:fast_forward: *Superseded* · *${escapeMrkdwn(args.release.name)}* was updated in Jira — see the newer approval request below.`,
        },
      },
    ],
  };
}

/**
 * Initial test message — mirrors the real approval message's button layout so
 * the round-trip exercises the same Slack → signing → endpoint → chat.update path.
 */
export function buildTestInitialBlocks(args: {
  /** Who requested the test, for display. Typically the current app user or empty. */
  requester?: string;
  /** Randomly-generated test session token. Carried in button value to disambiguate
   *  concurrent tests and confirm the click matches the most-recently-sent test. */
  token: string;
}): { text: string; blocks: unknown[] } {
  const who = args.requester ? ` by ${args.requester}` : "";
  return {
    text: "Approval gate test — click Approve to verify the round-trip",
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:test_tube: *Approval gate test*\nThis is a round-trip check${who} — no release is affected. Click *Approve* to confirm the Slack → app path works.`,
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            action_id: TEST_APPROVE_ACTION_ID,
            style: "primary",
            text: { type: "plain_text", text: "Approve (test)" },
            value: args.token,
          },
          {
            type: "button",
            action_id: TEST_CANCEL_ACTION_ID,
            style: "danger",
            text: { type: "plain_text", text: "Cancel (test)" },
            value: args.token,
          },
        ],
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Test session \`${args.token}\` — if you click a stale test message, you'll see "expired."`,
          },
        ],
      },
    ],
  };
}

export function buildTestConfirmedBlocks(args: {
  clickedByUserId: string | null;
  when: string;
}): { text: string; blocks: unknown[] } {
  const who = args.clickedByUserId ? `<@${args.clickedByUserId}>` : "someone";
  const when = formatTime(args.when);
  return {
    text: "Approval gate test — round-trip confirmed",
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:white_check_mark: *Test successful* — Slack → app round-trip works.\nConfirmed by ${who} at ${when}.`,
        },
      },
    ],
  };
}

export function buildTestCancelledBlocks(args: {
  clickedByUserId: string | null;
}): { text: string; blocks: unknown[] } {
  const who = args.clickedByUserId ? `<@${args.clickedByUserId}>` : "someone";
  return {
    text: "Approval gate test — cancelled",
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:no_entry: *Test cancelled* by ${who}. The round-trip still worked — you just chose Cancel.`,
        },
      },
    ],
  };
}

function escapeMrkdwn(s: string): string {
  // Slack mrkdwn treats &, <, > specially. Escape to avoid breaking user_mention/link parsing.
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
