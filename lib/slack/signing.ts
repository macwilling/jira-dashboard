/**
 * Slack request signing verification.
 *
 * Every interactive payload from Slack includes an `X-Slack-Signature` header
 * and `X-Slack-Request-Timestamp`. The signature is HMAC-SHA256 of the string
 * `v0:{timestamp}:{raw body}` keyed with the app's signing secret. Verifying it
 * proves the request came from Slack (and wasn't replayed — we also reject
 * timestamps older than 5 minutes).
 *
 * The signing secret is separate from the bot token. It lives in the Slack app
 * config under Basic Information → App Credentials → Signing Secret.
 */

import crypto from "node:crypto";

const SKEW_SECONDS = 5 * 60;

export function hasSlackSigningSecret(): boolean {
  return !!process.env.SLACK_SIGNING_SECRET;
}

export interface VerifyArgs {
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
  /** Override for tests. Defaults to Date.now()/1000. */
  now?: number;
}

/**
 * Returns true if the signature is valid AND the timestamp is within the
 * 5-minute skew window. Constant-time comparison to avoid timing oracles.
 */
export function verifySlackSignature(args: VerifyArgs): boolean {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) return false;
  if (!args.signature || !args.timestamp) return false;

  const ts = Number(args.timestamp);
  if (!Number.isFinite(ts)) return false;
  const now = args.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > SKEW_SECONDS) return false;

  const base = `v0:${args.timestamp}:${args.rawBody}`;
  const expected =
    "v0=" +
    crypto.createHmac("sha256", secret).update(base).digest("hex");

  const a = Buffer.from(expected);
  const b = Buffer.from(args.signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
