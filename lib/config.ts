export interface DashboardConfig {
  jqlFilter: string;
  l2LabelPatterns: string[];
  sprintFieldId?: string; // Custom field ID for sprint (defaults to "customfield_10020")
  boardId?: string; // Jira Agile board ID — used as fallback to fetch active sprint
  standupTime?: string; // HH:MM in 24h format, e.g. "09:45". Defaults to "09:00"
  standupTimezone?: string; // IANA timezone, e.g. "America/New_York". Defaults to browser local
}

const CONFIG_KEY = "dashboard-config";

function getCfKvConfig() {
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const namespaceId = process.env.CLOUDFLARE_KV_NAMESPACE_ID;
  if (!apiToken || !accountId || !namespaceId) return null;
  return { apiToken, accountId, namespaceId };
}

function kvUrl(accountId: string, namespaceId: string, key: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`;
}

export async function getConfig(): Promise<DashboardConfig | null> {
  const cf = getCfKvConfig();
  if (!cf) return null;

  try {
    const res = await fetch(kvUrl(cf.accountId, cf.namespaceId, CONFIG_KEY), {
      headers: { Authorization: `Bearer ${cf.apiToken}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text) as DashboardConfig;
  } catch {
    return null;
  }
}

export async function saveConfig(config: DashboardConfig): Promise<void> {
  const cf = getCfKvConfig();
  if (!cf) {
    throw new Error(
      "Cloudflare KV not configured — set CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, and CLOUDFLARE_KV_NAMESPACE_ID"
    );
  }

  const res = await fetch(kvUrl(cf.accountId, cf.namespaceId, CONFIG_KEY), {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${cf.apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(config),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Cloudflare KV write failed: ${res.status} ${body}`);
  }
}

export function hasKvConfig(): boolean {
  return !!(
    process.env.CLOUDFLARE_API_TOKEN &&
    process.env.CLOUDFLARE_ACCOUNT_ID &&
    process.env.CLOUDFLARE_KV_NAMESPACE_ID
  );
}
