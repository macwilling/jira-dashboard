/**
 * Event-driven notification firing for release templates.
 *
 * Runs synchronously in response to a lifecycle event: release created, date
 * changed, released, or task dispatch failure. Each fire is best-effort — we
 * swallow errors so a flaky Slack call can't crash the caller's flow.
 *
 * Posts via Slack `chat.postMessage` with a bot token (SLACK_BOT_TOKEN env).
 * A rule's `target` is a channel ID (C…, G…) or user ID (U…) for a DM.
 */

import { listTemplates } from "./templates-store";
import { listNotificationsForEvent } from "./notifications-store";
import { matchTemplates } from "./matcher";
import {
  buildMergeContext,
  renderMergeFields,
  type EventContextOverride,
} from "./merge-fields";
import { hasSlackBotToken, postSlackMessage } from "@/lib/slack/client";
import { buildSlackMessage } from "./notification-blocks";
import type { Release, ReleaseEventType } from "./types";

export interface FireEventOptions {
  release: Pick<Release, "id" | "name" | "description" | "releaseDate">;
  eventType: ReleaseEventType;
  /** Event-specific context (old/new date, task label, error). */
  event?: EventContextOverride;
}

/** Slack target IDs: channel (C/G), DM (D), or user (U). Anything else skipped. */
function isValidTarget(target: string): boolean {
  return /^[CGDU][A-Z0-9]{5,}$/.test(target);
}

/**
 * Match the release against a template, look up notification rules for the
 * given event, and post each via chat.postMessage.
 *
 * Never throws — per-rule failures log to console so the calling webhook/handler
 * flow proceeds uninterrupted.
 */
export async function fireReleaseEvent(opts: FireEventOptions): Promise<void> {
  const { release, eventType, event } = opts;

  try {
    if (!hasSlackBotToken()) {
      console.warn(
        `[notifications] ${eventType} skipped — SLACK_BOT_TOKEN not set`,
      );
      return;
    }

    const templates = await listTemplates();
    const matched = matchTemplates(release.name, templates);
    if (matched.length === 0) return;

    // Layered templates: gather rules from every matched template. Each rule
    // fires independently — a release that matches both "Base" and "Mobile"
    // layers will get notifications from both if they both have rules for
    // this event type.
    const ruleLists = await Promise.all(
      matched.map((t) => listNotificationsForEvent(t.id, eventType)),
    );
    const rules = ruleLists.flat();
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
