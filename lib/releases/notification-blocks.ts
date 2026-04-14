/**
 * Shared builder for Slack `chat.postMessage` payloads used by both the
 * live firing path (fireReleaseEvent) and the template editor's test button.
 *
 * If no buttons are present we return `text` only — the fallback matches the
 * original simple-message behavior. When buttons exist we add a blocks array
 * with a mrkdwn section + an actions block of link buttons.
 */

import type { NotificationButton } from "./types";
import { renderMergeFields, type MergeContext } from "./merge-fields";

export interface SlackMessagePayload {
  text: string;
  blocks?: unknown[];
}

export function buildSlackMessage(args: {
  text: string;
  buttons: NotificationButton[];
  ctx: MergeContext;
}): SlackMessagePayload {
  const { text, ctx } = args;

  const renderedButtons = args.buttons
    .map((b) => ({
      label: (renderMergeFields(b.label, ctx) ?? b.label).trim(),
      url: (renderMergeFields(b.url, ctx) ?? b.url).trim(),
    }))
    .filter((b) => b.label && isSafeUrl(b.url))
    .slice(0, 5); // Slack caps actions blocks at 5 elements.

  if (renderedButtons.length === 0) {
    return { text };
  }

  return {
    text, // fallback for push/email notifications
    blocks: [
      { type: "section", text: { type: "mrkdwn", text } },
      {
        type: "actions",
        elements: renderedButtons.map((b, i) => ({
          type: "button",
          action_id: `cta_${i}`,
          text: { type: "plain_text", text: b.label.slice(0, 75) },
          url: b.url,
        })),
      },
    ],
  };
}

/**
 * Guard against non-http(s) URLs (mailto:, javascript:, file:, slack://, etc).
 * Slack rejects most of these server-side, but filtering here keeps the
 * payload clean and avoids surprising behavior.
 */
function isSafeUrl(url: string): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}
