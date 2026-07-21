/**
 * Minimal server-side Datadog RUM analytics client for the wallboard.
 * Uses the RUM aggregate endpoint (POST /api/v2/rum/analytics/aggregate).
 * Never import this from client components.
 *
 * Auth (either works; token wins when both are set):
 * - DATADOG_ACCESS_TOKEN — a Personal Access Token (scoped, standalone,
 *   sent as `Authorization: Bearer`). Needs a RUM read scope. NOTE: PATs
 *   have a mandatory expiry (max 1 year) — rotate before it lapses.
 * - DATADOG_API_KEY + DATADOG_APP_KEY — the legacy key pair.
 *
 * Other env:
 * - DATADOG_SITE — optional, defaults to datadoghq.com (e.g. us5.datadoghq.com)
 * - DATADOG_RUM_APP_ID — optional @application.id filter; omit to aggregate
 *   across all RUM applications in the org
 * - DATADOG_RUM_USER_FIELD — optional facet for unique-user counts,
 *   defaults to @usr.id (use @session.id if users aren't identified)
 */

export function hasDatadogCredentials(): boolean {
  return Boolean(
    process.env.DATADOG_ACCESS_TOKEN ||
      (process.env.DATADOG_API_KEY && process.env.DATADOG_APP_KEY)
  );
}

function authHeaders(): Record<string, string> {
  const token = process.env.DATADOG_ACCESS_TOKEN;
  if (token) {
    return { Authorization: `Bearer ${token}` };
  }
  return {
    "DD-API-KEY": process.env.DATADOG_API_KEY!,
    "DD-APPLICATION-KEY": process.env.DATADOG_APP_KEY!,
  };
}

function appFilter(): string {
  const appId = process.env.DATADOG_RUM_APP_ID;
  return appId ? ` @application.id:${appId}` : "";
}

interface RumCompute {
  aggregation: "count" | "cardinality";
  metric?: string;
  type?: "total" | "timeseries";
  interval?: string;
}

interface RumAggregateResponse {
  data?: {
    buckets?: {
      computes?: Record<
        string,
        number | { time: string; value: number | null }[] | null
      >;
    }[];
  };
}

async function rumAggregate(
  query: string,
  from: string,
  to: string,
  compute: RumCompute
): Promise<number | number[]> {
  const site = process.env.DATADOG_SITE || "datadoghq.com";
  const res = await fetch(`https://api.${site}/api/v2/rum/analytics/aggregate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify({
      compute: [compute],
      filter: { query: query + appFilter(), from, to },
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Datadog API error ${res.status}: ${body.slice(0, 200)}`);
  }

  const json: RumAggregateResponse = await res.json();
  const c0 = json.data?.buckets?.[0]?.computes?.c0;

  if (compute.type === "timeseries") {
    if (!Array.isArray(c0)) return [];
    return c0.map((p) => p?.value ?? 0);
  }
  return typeof c0 === "number" ? c0 : 0;
}

export interface DatadogInsights {
  activeUsers: number;
  activeUsersSpark: number[];
  pageViews: number;
  pageViewsSpark: number[];
  clicks: number;
  clicksSpark: number[];
  errorRate: number; // percent, errors per 100 views today
}

/** `dayStart` is the viewer's local start-of-day (ISO) so "today" follows the office clock. */
export async function fetchInsights(dayStart: string): Promise<DatadogInsights> {
  const userField = process.env.DATADOG_RUM_USER_FIELD || "@usr.id";

  const [
    activeUsers,
    activeUsersSpark,
    pageViews,
    pageViewsSpark,
    clicks,
    clicksSpark,
    errors,
  ] = await Promise.all([
    rumAggregate("@type:session", "now-1h", "now", {
      aggregation: "cardinality",
      metric: userField,
    }),
    rumAggregate("@type:session", "now-6h", "now", {
      aggregation: "cardinality",
      metric: userField,
      type: "timeseries",
      interval: "30m",
    }),
    rumAggregate("@type:view", dayStart, "now", { aggregation: "count" }),
    rumAggregate("@type:view", "now-24h", "now", {
      aggregation: "count",
      type: "timeseries",
      interval: "2h",
    }),
    rumAggregate("@type:action", dayStart, "now", { aggregation: "count" }),
    rumAggregate("@type:action", "now-24h", "now", {
      aggregation: "count",
      type: "timeseries",
      interval: "2h",
    }),
    rumAggregate("@type:error", dayStart, "now", { aggregation: "count" }),
  ]);

  const views = pageViews as number;
  return {
    activeUsers: activeUsers as number,
    activeUsersSpark: activeUsersSpark as number[],
    pageViews: views,
    pageViewsSpark: pageViewsSpark as number[],
    clicks: clicks as number,
    clicksSpark: clicksSpark as number[],
    errorRate: views === 0 ? 0 : ((errors as number) / views) * 100,
  };
}
