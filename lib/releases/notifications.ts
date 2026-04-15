/**
 * Event-driven notification firing for release workflows.
 *
 * Runs synchronously in response to a lifecycle event: release created, date
 * changed, released, or task dispatch failure. Each fire is best-effort —
 * errors are swallowed so a flaky Slack call can't crash the caller's flow.
 *
 * Notification rules live on the workflow that owns the release (via
 * release.category_id → category.workflow_id). Unmatched releases have no
 * workflow and therefore fire nothing — that's intentional, the admin alert
 * path handles those cases separately.
 *
 * Posts via Slack `chat.postMessage` with a bot token (SLACK_BOT_TOKEN env).
 * A rule's `target` is a channel ID (C…, G…) or user ID (U…) for a DM.
 */

import { getCategory } from "./categories";
import { listNotificationsForEvent } from "./workflows-store";
import { getRelease } from "./store";
import {
  buildMergeContext,
  renderMergeFields,
  type EventContextOverride,
} from "./merge-fields";
import { hasSlackBotToken, postSlackMessage } from "@/lib/slack/client";
import { buildSlackMessage } from "./notification-blocks";
import type { Release, ReleaseEventType } from "./types";

export interface FireEventOptions {
  release: Pick<
    Release,
    "id" | "name" | "description" | "releaseDate" | "categoryId"
  >;
  eventType: ReleaseEventType;
  /** Event-specific context (old/new date, task label, error). */
  event?: EventContextOverride;
}

/** Slack target IDs: channel (C/G), DM (D), or user (U). Anything else skipped. */
function isValidTarget(target: string): boolean {
  return /^[CGDU][A-Z0-9]{5,}$/.test(target);
}

/**
 * Resolve the workflow for a release by chasing
 * release → category → workflow. Callers that already have the workflowId can
 * skip this by calling listNotificationsForEvent directly.
 */
async function resolveWorkflowId(
  release: Pick<Release, "id" | "categoryId">,
): Promise<string | null> {
  if (!release.categoryId) return null;
  const cat = await getCategory(release.categoryId).catch(() => null);
  return cat?.workflowId ?? null;
}

export async function fireReleaseEvent(opts: FireEventOptions): Promise<void> {
  const { release, eventType, event } = opts;

  try {
    if (!hasSlackBotToken()) {
      console.warn(
        `[notifications] ${eventType} skipped — SLACK_BOT_TOKEN not set`,
      );
      return;
    }

    // If the caller passed a minimal release shape without categoryId, fetch.
    let categoryId = release.categoryId;
    if (categoryId === undefined) {
      const full = await getRelease(release.id).catch(() => null);
      categoryId = full?.categoryId ?? null;
    }

    const workflowId = categoryId
      ? await resolveWorkflowId({ id: release.id, categoryId })
      : null;
    if (!workflowId) return; // unmatched / no workflow → no notifications

    const rules = await listNotificationsForEvent(workflowId, eventType);
    if (rules.length === 0) return;

    const ctx = buildMergeContext(release, null, 0, event);
    const renderedMessage = (msg: string) =>
      renderMergeFields(msg, ctx) ?? msg;

    for (const rule of rules) {
      const target = rule.target?.trim();
      if (!target) {
        console.warn(
          `[notifications] ${eventType} rule ${rule.id} has no target — skipping`,
        );
        continue;
      }
      if (!isValidTarget(target)) {
        console.warn(
          `[notifications] ${eventType} rule ${rule.id} target ${target} is not a valid Slack channel/user ID — skipping`,
        );
        continue;
      }
      try {
        const payload = buildSlackMessage({
          text: renderedMessage(rule.message),
          buttons: rule.buttons,
          ctx,
        });
        await postSlackMessage({ channel: target, ...payload });
      } catch (e) {
        console.warn(
          `[notifications] ${eventType} rule ${rule.id} failed`,
          (e as Error).message,
        );
      }
    }
  } catch (e) {
    console.warn(`[notifications] fireReleaseEvent ${eventType} failed`, e);
  }
}
