/**
 * Posts admin-level alerts that sit outside any workflow's notification rules
 * — currently just the "release needs resolution" message for category-change
 * conflicts. Target is the global `releaseAdminSlackTarget` in KV config.
 *
 * Kept separate from `notifications.ts` because notifications.ts fans out
 * against workflow rules, and resolution alerts fire precisely when the
 * workflow mapping is what's in question.
 */

import { getConfig } from "@/lib/config";
import { hasSlackBotToken, postSlackMessage } from "@/lib/slack/client";
import type { Release, ResolutionSnapshot } from "./types";

export const RESOLUTION_KEEP_ORIGINAL_ACTION = "release_resolve_keep_original";
export const RESOLUTION_SWITCH_WORKFLOW_ACTION = "release_resolve_switch";
export const RESOLUTION_DISCARD_ACTION = "release_resolve_discard";
export const RESOLUTION_VIEW_ACTION = "release_resolve_view";

function getAppBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
    "https://example.invalid"
  );
}

export interface PostNeedsResolutionOpts {
  release: Release;
  snapshot: ResolutionSnapshot;
}

/**
 * Post a Slack message to the admin target announcing a release that needs
 * manual resolution (category changed while tasks exist). Includes three
 * action buttons + a "view in app" link. Button values encode the release ID
 * so the interactive handler can route back. Safe to call when admin target
 * isn't configured — it logs a warning and skips.
 */
export async function postAdminNeedsResolution(
  opts: PostNeedsResolutionOpts,
): Promise<void> {
  const { release, snapshot } = opts;

  if (!hasSlackBotToken()) {
    console.warn(
      "[admin-notifier] SLACK_BOT_TOKEN not set — resolution alert skipped",
    );
    return;
  }

  const cfg = await getConfig().catch(() => null);
  const target = cfg?.releaseAdminSlackTarget?.trim();
  if (!target) {
    console.warn(
      "[admin-notifier] releaseAdminSlackTarget not set — resolution alert skipped",
    );
    return;
  }

  const releaseUrl = `${getAppBaseUrl()}/releases/${release.id}`;
  const { taskCounts, oldWorkflowName, newWorkflowName, oldCategoryKey, newCategoryKey } = snapshot;

  const text = `⚠️ Release *${release.name}* needs resolution — category changed from \`${oldCategoryKey ?? "unknown"}\` to \`${newCategoryKey ?? "unmatched"}\` after tasks were generated.`;

  const summary =
    `*Old workflow:* ${oldWorkflowName ?? "(none)"}\n` +
    `*New workflow:* ${newWorkflowName ?? "(none — unmatched)"}\n` +
    `*Task state:* ${taskCounts.pending} pending · ${taskCounts.dispatched} dispatched · ${taskCounts.completed} completed`;

  const blocks = [
    { type: "section", text: { type: "mrkdwn", text } },
    { type: "section", text: { type: "mrkdwn", text: summary } },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Keep original workflow" },
          action_id: RESOLUTION_KEEP_ORIGINAL_ACTION,
          value: release.id,
        },
        ...(snapshot.newWorkflowId
          ? [
              {
                type: "button",
                text: { type: "plain_text", text: "Switch to new workflow" },
                style: "primary",
                action_id: RESOLUTION_SWITCH_WORKFLOW_ACTION,
                value: release.id,
                confirm: {
                  title: { type: "plain_text", text: "Switch workflow?" },
                  text: {
                    type: "mrkdwn",
                    text: `This will delete ${taskCounts.pending + taskCounts.dispatched} tasks from *${oldWorkflowName ?? "the old workflow"}* (Google Tasks / Calendar events included) and generate fresh ones from *${newWorkflowName ?? "the new workflow"}*. Completed tasks are preserved as history.`,
                  },
                  confirm: { type: "plain_text", text: "Switch" },
                  deny: { type: "plain_text", text: "Cancel" },
                },
              },
            ]
          : []),
        {
          type: "button",
          text: { type: "plain_text", text: "Discard all" },
          style: "danger",
          action_id: RESOLUTION_DISCARD_ACTION,
          value: release.id,
          confirm: {
            title: { type: "plain_text", text: "Discard all tasks?" },
            text: {
              type: "mrkdwn",
              text: `This removes all ${taskCounts.pending + taskCounts.dispatched} non-completed tasks (Google Tasks / Calendar events included). Release will be marked unmatched.`,
            },
            confirm: { type: "plain_text", text: "Discard" },
            deny: { type: "plain_text", text: "Cancel" },
          },
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Open in app" },
          action_id: RESOLUTION_VIEW_ACTION,
          url: releaseUrl,
        },
      ],
    },
  ];

  try {
    await postSlackMessage({ channel: target, text, blocks });
  } catch (e) {
    console.warn(
      "[admin-notifier] failed to post resolution alert",
      (e as Error).message,
    );
  }
}
