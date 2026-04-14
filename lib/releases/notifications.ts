/**
 * Event-driven notification firing for release templates.
 *
 * Unlike the dispatcher (which creates Google resources on a schedule), this
 * runs synchronously in response to a lifecycle event: release created, date
 * changed, released, or task dispatch failure. Each fire is best-effort — we
 * swallow errors so a flaky Slack webhook can't crash the caller's flow.
 */

import { getConfig } from "@/lib/config";
import { listTemplates } from "./templates-store";
import { listNotificationsForEvent } from "./notifications-store";
import { matchTemplate } from "./matcher";
import {
  buildMergeContext,
  renderMergeFields,
  type EventContextOverride,
} from "./merge-fields";
import { sendSlackWebhook, type SlackWebhookPayload } from "@/lib/slack/client";
import type { Release, ReleaseEventType } from "./types";

export interface FireEventOptions {
  release: Pick<Release, "id" | "name" | "description" | "releaseDate">;
  eventType: ReleaseEventType;
  /** Event-specific context (old/new date, task label, error). */
  event?: EventContextOverride;
}

/**
 * Match the release against a template, look up notification rules for the
 * given event, and POST each to its configured webhook.
 *
 * Never throws — per-rule failures log to console so the calling webhook/handler
 * flow proceeds uninterrupted.
 */
export async function fireReleaseEvent(opts: FireEventOptions): Promise<void> {
  const { release, eventType, event } = opts;

  try {
    const templates = await listTemplates();
    const matched = matchTemplate(release.name, templates);
    if (!matched) return;

    const rules = await listNotificationsForEvent(matched.id, eventType);
    if (rules.length === 0) return;

    const config = await getConfig().catch(() => null);
    const globalWebhook = config?.slackWebhookUrl?.trim() || null;

    const ctx = buildMergeContext(release, null, 0, event);
    const renderedMessage = (msg: string) =>
      renderMergeFields(msg, ctx) ?? msg;

    // Flat payload — Workflow Builder's webhook schema only supports top-level
    // string/number/boolean keys.
    const basePayload: Omit<SlackWebhookPayload, "text"> = {
      event: eventType,
      release_id: ctx.release.id,
      release_name: ctx.release.name,
      release_platform: ctx.release.platform,
      release_version: ctx.release.version,
      release_type: ctx.release.releaseType,
      release_date: ctx.release.date,
      release_description: ctx.release.description,
      event_old_date: ctx.event.oldDate,
      event_new_date: ctx.event.newDate,
      event_task_label: ctx.event.taskLabel,
      event_error: ctx.event.error,
    };

    for (const rule of rules) {
      const url = rule.webhookUrl?.trim() || globalWebhook;
      if (!url) {
        console.warn(
          `[notifications] ${eventType} rule ${rule.id} has no webhook URL (no override, no global) — skipping`,
        );
        continue;
      }
      try {
        await sendSlackWebhook(url, {
          ...basePayload,
          text: renderedMessage(rule.message),
        });
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
