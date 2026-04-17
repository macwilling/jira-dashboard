/**
 * Scheduled Worker: calls /api/cron/recover on the Next.js deploy to replay
 * any missed Jira version webhooks. The Next.js handler owns all diff logic;
 * this worker is just the schedule + auth header.
 *
 * Also exposes a GET endpoint so you can manually trigger a run from a
 * browser (handy for ad-hoc recovery or debugging).
 */

export interface Env {
  APP_URL: string;
  CRON_RECOVERY_SECRET: string;
}

async function runRecovery(env: Env): Promise<{
  status: number;
  body: unknown;
}> {
  if (!env.APP_URL || !env.CRON_RECOVERY_SECRET) {
    return {
      status: 500,
      body: { error: "APP_URL or CRON_RECOVERY_SECRET not set" },
    };
  }

  const url = `${env.APP_URL.replace(/\/$/, "")}/api/cron/recover`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.CRON_RECOVERY_SECRET}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });

  const body = await res.json().catch(() => ({ error: "non-JSON response" }));
  return { status: res.status, body };
}

export default {
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(
      runRecovery(env).then((r) => {
        if (r.status !== 200) {
          console.error("[recovery cron] non-200", r.status, r.body);
        } else {
          console.log("[recovery cron] ok", r.body);
        }
      }),
    );
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/run" && req.method === "POST") {
      const { status, body } = await runRecovery(env);
      return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(
      JSON.stringify({
        ok: true,
        endpoint: "release recovery cron",
        appUrlConfigured: !!env.APP_URL,
        secretConfigured: !!env.CRON_RECOVERY_SECRET,
        usage: "POST /run to trigger a manual recovery; scheduled every 5 minutes",
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  },
};
