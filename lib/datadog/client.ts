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
  aggregation: "count" | "cardinality" | "pc75";
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
  /** Yesterday's page views up to the same time of day (for the delta). */
  pageViewsPrev: number;
  rageClicks: number;
  rageClicksSpark: number[];
  rageClicksPrev: number;
  /** p75 Largest Contentful Paint today, in ms; null when no data. */
  lcpP75Ms: number | null;
  lcpP75PrevMs: number | null;
  /** Percent of today's sessions that hit at least one error. */
  errorSessionPct: number;
  errorSessionPctPrev: number;
}

/** All queries exclude Synthetics/CI bot traffic. */
const USER = " @session.type:user";
const NS_PER_MS = 1e6;

/** `dayStart` is the viewer's local start-of-day (ISO) so "today" follows the office clock. */
export async function fetchInsights(dayStart: string): Promise<DatadogInsights> {
  const userField = process.env.DATADOG_RUM_USER_FIELD || "@usr.id";
  // Yesterday's equivalent window: same start-of-day and "now", shifted -24h
  const prevDayStart = new Date(
    new Date(dayStart).getTime() - 24 * 3_600_000
  ).toISOString();

  const RAGE = "@type:action @action.frustration.type:rage_click" + USER;
  const LCP: RumCompute = {
    aggregation: "pc75",
    metric: "@view.largest_contentful_paint",
  };

  const [
    activeUsers,
    activeUsersSpark,
    pageViews,
    pageViewsSpark,
    pageViewsPrev,
    rageClicks,
    rageClicksSpark,
    rageClicksPrev,
    lcpP75,
    lcpP75Prev,
    errorSessions,
    totalSessions,
    errorSessionsPrev,
    totalSessionsPrev,
  ] = await Promise.all([
    rumAggregate("@type:session" + USER, "now-1h", "now", {
      aggregation: "cardinality",
      metric: userField,
    }),
    rumAggregate("@type:session" + USER, "now-6h", "now", {
      aggregation: "cardinality",
      metric: userField,
      type: "timeseries",
      interval: "30m",
    }),
    rumAggregate("@type:view" + USER, dayStart, "now", { aggregation: "count" }),
    rumAggregate("@type:view" + USER, "now-24h", "now", {
      aggregation: "count",
      type: "timeseries",
      interval: "2h",
    }),
    rumAggregate("@type:view" + USER, prevDayStart, "now-24h", {
      aggregation: "count",
    }),
    rumAggregate(RAGE, dayStart, "now", { aggregation: "count" }),
    rumAggregate(RAGE, "now-24h", "now", {
      aggregation: "count",
      type: "timeseries",
      interval: "2h",
    }),
    rumAggregate(RAGE, prevDayStart, "now-24h", { aggregation: "count" }),
    rumAggregate("@type:view" + USER, dayStart, "now", LCP),
    rumAggregate("@type:view" + USER, prevDayStart, "now-24h", LCP),
    rumAggregate("@type:error" + USER, dayStart, "now", {
      aggregation: "cardinality",
      metric: "@session.id",
    }),
    rumAggregate("@type:session" + USER, dayStart, "now", {
      aggregation: "cardinality",
      metric: "@session.id",
    }),
    rumAggregate("@type:error" + USER, prevDayStart, "now-24h", {
      aggregation: "cardinality",
      metric: "@session.id",
    }),
    rumAggregate("@type:session" + USER, prevDayStart, "now-24h", {
      aggregation: "cardinality",
      metric: "@session.id",
    }),
  ]);

  const pct = (part: number, whole: number) =>
    whole === 0 ? 0 : (part / whole) * 100;
  const lcpMs = (ns: number) => (ns > 0 ? ns / NS_PER_MS : null);
  // The final timeseries bucket is the in-progress interval — a partial count
  // that reads as a plunge to zero. Show complete buckets only.
  const trim = (spark: number[]) =>
    spark.length > 2 ? spark.slice(0, -1) : spark;

  return {
    activeUsers: activeUsers as number,
    activeUsersSpark: trim(activeUsersSpark as number[]),
    pageViews: pageViews as number,
    pageViewsSpark: trim(pageViewsSpark as number[]),
    pageViewsPrev: pageViewsPrev as number,
    rageClicks: rageClicks as number,
    rageClicksSpark: trim(rageClicksSpark as number[]),
    rageClicksPrev: rageClicksPrev as number,
    lcpP75Ms: lcpMs(lcpP75 as number),
    lcpP75PrevMs: lcpMs(lcpP75Prev as number),
    errorSessionPct: pct(errorSessions as number, totalSessions as number),
    errorSessionPctPrev: pct(
      errorSessionsPrev as number,
      totalSessionsPrev as number
    ),
  };
}
