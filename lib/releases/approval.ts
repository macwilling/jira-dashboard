/**
 * Approval gate orchestration. The gate's Slack target is sourced from the
 * workflow assigned to the release (via release.category_id → workflow.
 * approval_slack_target). The orchestrator decides when to call this module;
 * this module only owns "post + persist" and "supersede + repost."
 */

import {
  bumpApprovalVersion,
  clearApproval,
  setApprovalPending,
} from "./store";
import {
  listTaskInstances,
  regenerateTaskInstances,
} from "./task-instances-store";
import { postSlackMessage, updateSlackMessage } from "@/lib/slack/client";
import {
  buildApprovalBlocks,
  buildSupersededBlocks,
} from "./approval-message";
import type { Release, Workflow } from "./types";

function getAppBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
    "https://example.invalid"
  );
}

function releaseUrl(id: string): string {
  return `${getAppBaseUrl()}/releases/${id}`;
}

export interface PostApprovalOptions {
  release: Release;
  /** Pre-resolved Slack target (channel ID / user ID) from the workflow. */
  target: string;
}

/**
 * Post a fresh approval request for a release and persist the message ref.
 * Always bumps approval_version first so every message has a distinct version
 * (v0 reserved for "never requested"). Returns false (no-op) if there are no
 * task instances to approve.
 */
export async function postApprovalRequest(
  opts: PostApprovalOptions,
): Promise<boolean> {
  const { release, target } = opts;
  const instances = await listTaskInstances(release.id);
  if (instances.length === 0) return false;

  const newVersion = await bumpApprovalVersion(release.id);
  const { text, blocks } = buildApprovalBlocks({
    release,
    instances,
    approvalVersion: newVersion,
    releaseUrl: releaseUrl(release.id),
  });
  const result = await postSlackMessage({ channel: target, text, blocks });
  await setApprovalPending(release.id, {
    version: newVersion,
    messageTs: result.ts,
    channel: result.channel,
  });
  return true;
}

/**
 * Handle a Jira update on a release that's currently pending approval.
 *
 * Steps:
 *   1. Regenerate task instances against the workflow so the new approval
 *      message reflects the updated Jira state (nothing has dispatched yet).
 *   2. Edit the old Slack message in-place to show "superseded".
 *   3. Post a fresh approval message (postApprovalRequest bumps the version,
 *      which invalidates the old message's button values).
 */
export async function supersedeAndRepost(
  release: Release,
  workflow: Workflow,
  target: string,
): Promise<void> {
  await regenerateTaskInstances(release, workflow.id);

  if (release.approvalMessageChannel && release.approvalMessageTs) {
    try {
      const msg = buildSupersededBlocks({ release });
      await updateSlackMessage({
        channel: release.approvalMessageChannel,
        ts: release.approvalMessageTs,
        ...msg,
      });
    } catch (e) {
      console.warn("[approval] failed to mark old message superseded", e);
    }
  }

  await postApprovalRequest({ release, target });
}

/**
 * Reset a release's approval state. Useful when the Slack message couldn't
 * be posted (e.g. bot not in channel) — callers can clear state so the next
 * webhook tries again cleanly.
 */
export async function resetApproval(releaseId: string): Promise<void> {
  await clearApproval(releaseId);
}
