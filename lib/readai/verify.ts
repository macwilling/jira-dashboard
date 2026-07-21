import crypto from "crypto";

/**
 * Verifies a Read AI webhook signature.
 *
 * Read AI signs each delivery with HMAC-SHA256 over the raw request body,
 * keyed by the base64-decoded signing key shown in the webhook's settings,
 * and sends the hex digest in the `X-Read-Signature` header.
 */
export function verifyReadAiSignature(
  rawBody: string,
  headerSignature: string | null,
  signingKey: string,
): boolean {
  if (!headerSignature) return false;

  const keyBytes = Buffer.from(signingKey, "base64");
  const digest = crypto
    .createHmac("sha256", keyBytes)
    .update(rawBody, "utf8")
    .digest("hex");

  const expected = Buffer.from(digest);
  const received = Buffer.from(headerSignature.trim().toLowerCase());
  if (expected.length !== received.length) return false;
  return crypto.timingSafeEqual(expected, received);
}
