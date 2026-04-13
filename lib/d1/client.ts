/**
 * Cloudflare D1 REST API client.
 *
 * Used when the app runs outside Cloudflare (e.g. Vercel) where a native D1
 * binding isn't available. For our scale (low single-digit queries/min) the
 * ~50-100ms REST latency is fine.
 *
 * Env vars required:
 *   CLOUDFLARE_API_TOKEN      (must include D1:Edit permission)
 *   CLOUDFLARE_ACCOUNT_ID
 *   CLOUDFLARE_D1_DATABASE_ID
 */

export type D1Value = string | number | boolean | null;

interface D1QueryResult<T> {
  results: T[];
  success: boolean;
  meta: {
    changes?: number;
    last_row_id?: number;
    rows_read?: number;
    rows_written?: number;
  };
}

interface D1ApiResponse<T> {
  success: boolean;
  errors?: Array<{ code: number; message: string }>;
  result: Array<D1QueryResult<T>>;
}

function getD1Config() {
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
  if (!apiToken || !accountId || !databaseId) return null;
  return { apiToken, accountId, databaseId };
}

export function hasD1Config(): boolean {
  return getD1Config() !== null;
}

export async function d1Query<T = Record<string, unknown>>(
  sql: string,
  params: D1Value[] = []
): Promise<D1QueryResult<T>> {
  const cf = getD1Config();
  if (!cf) {
    throw new Error(
      "Cloudflare D1 not configured — set CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, and CLOUDFLARE_D1_DATABASE_ID"
    );
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${cf.accountId}/d1/database/${cf.databaseId}/query`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cf.apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql, params }),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`D1 HTTP ${res.status}: ${text}`);
  }

  const body = (await res.json()) as D1ApiResponse<T>;

  if (!body.success) {
    const msg = body.errors?.map((e) => e.message).join("; ") ?? "unknown";
    throw new Error(`D1 query failed: ${msg}`);
  }

  // D1 returns an array of results (one per statement). We only send one.
  const first = body.result[0];
  if (!first) {
    throw new Error("D1 query returned no result");
  }
  return first;
}
