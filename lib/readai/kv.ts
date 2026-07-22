/**
 * Minimal Cloudflare KV helpers for the Read AI bridge (dedup, note-id
 * mapping, vault-index cache). Best-effort by design — callers treat a null
 * as a cache miss; signature verification is the real security gate.
 */

function kvUrl(key: string): string | null {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const namespaceId = process.env.CLOUDFLARE_KV_NAMESPACE_ID;
  if (!accountId || !namespaceId || !process.env.CLOUDFLARE_API_TOKEN) {
    return null;
  }
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`;
}

export async function kvGet(key: string): Promise<string | null> {
  const url = kvUrl(key);
  if (!url) return null;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export async function kvPut(
  key: string,
  value: string,
  ttlSeconds?: number,
): Promise<void> {
  const base = kvUrl(key);
  if (!base) return;
  const url = ttlSeconds ? `${base}?expiration_ttl=${ttlSeconds}` : base;
  try {
    await fetch(url, {
      method: "PUT",
      headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` },
      body: value,
    });
  } catch {
    // best-effort
  }
}
