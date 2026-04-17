# jira-release-recovery

Cloudflare cron worker. Runs every 5 minutes, calls the Next.js app's
`/api/cron/recover` endpoint, which reconciles Jira's view of project
versions against D1 and replays any missed `jira:version_*` webhook events.

## Why it exists

The primary ingestion path is a Jira webhook (`/api/webhooks/jira/version`).
Webhooks can be dropped — Jira occasionally misses deliveries, the app may be
redeploying, or the network between the two blips. Without a recovery loop,
those misses silently desync the app from Jira (e.g., a release deleted in
Jira still shows up, or a new release never gets tasks generated).

The recovery endpoint:

1. Fetches all versions from Jira (`GET /rest/api/3/project/{key}/versions`).
2. Lists all non-deleted releases from D1.
3. For every Jira version with any material difference vs. D1 → replays a
   `jira:version_updated` event through `handleVersionEvent`.
4. For every D1 release whose ID is missing from Jira's list → replays a
   `jira:version_deleted` event.

`handleVersionEvent` is idempotent, so replaying a still-accurate event is a
no-op beyond a few reads.

## Setup

1. In the Next.js app, set these env vars:
   - `CRON_RECOVERY_SECRET` — a shared secret (generate with `openssl rand -hex 32`)
   - `JIRA_PROJECT_KEY` — e.g. `IST`
2. In this worker's `wrangler.toml` or via dashboard vars:
   - `APP_URL` = public HTTPS URL of the Next.js deploy (no trailing slash)
3. Set the secret:
   ```
   wrangler secret put CRON_RECOVERY_SECRET
   ```
4. Deploy:
   ```
   wrangler deploy
   ```

## Local test

```
wrangler dev
# in another terminal:
curl -X POST http://localhost:8787/run
```

## Manual trigger in prod

```
curl -X POST https://jira-release-recovery.<your-subdomain>.workers.dev/run
```

This path is unauthenticated — it only triggers the recovery, which is
authenticated to the Next.js side. If you'd rather lock it down too, add a
secondary check in the worker's `fetch` handler.
