/**
 * Slack webhook sender.
 *
 * Target audience is both:
 *   - Classic Incoming Webhooks — consume the `text` field directly.
 *   - Workflow Builder webhook triggers — pick individual flat fields from the
 *     schema to compose richer messages.
 *
 * We always send both: a fully-rendered `text` plus every raw release/task/event
 * field as a flat top-level key. Workflow Builder doesn't support nested objects
 * in webhook variables, so nesting would force users into JSON-parsing hacks.
 */

export interface SlackWebhookPayload {
  text: string;
  [key: string]: string | number | boolean | null;
}

export async function sendSlackWebhook(
  webhookUrl: string,
  payload: SlackWebhookPayload,
): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Slack webhook returned ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
    );
  }
}
