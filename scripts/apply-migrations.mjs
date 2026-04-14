#!/usr/bin/env node
/**
 * One-shot: apply any missing additive migrations (0003-0007) to the remote D1.
 * Idempotent — checks PRAGMA table_info before each ALTER so it's safe to rerun.
 *
 * Run: node --env-file=.env.local scripts/apply-migrations.mjs
 */

const { CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID } = process.env;
if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_D1_DATABASE_ID) {
  console.error("Missing Cloudflare D1 env vars");
  process.exit(1);
}

const URL = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database/${CLOUDFLARE_D1_DATABASE_ID}/query`;

async function d1(sql, params = []) {
  const res = await fetch(URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql, params }),
  });
  const body = await res.json();
  if (!body.success) {
    const msg = body.errors?.map((e) => e.message).join("; ") ?? `HTTP ${res.status}`;
    throw new Error(`D1: ${msg}`);
  }
  return body.result[0];
}

async function columns(table) {
  const r = await d1(`PRAGMA table_info(${table})`);
  return new Set(r.results.map((c) => c.name));
}

async function addColumnIfMissing(table, name, def) {
  const cols = await columns(table);
  if (cols.has(name)) {
    console.log(`  · ${table}.${name} already exists`);
    return;
  }
  await d1(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
  console.log(`  ✓ added ${table}.${name}`);
}

async function main() {
  console.log("0003 — external refs on release_task_instances");
  await addColumnIfMissing("release_task_instances", "external_id", "TEXT");
  await addColumnIfMissing("release_task_instances", "external_url", "TEXT");
  await addColumnIfMissing("release_task_instances", "last_dispatch_error", "TEXT");
  await addColumnIfMissing("release_task_instances", "last_dispatch_at", "TEXT");

  console.log("0004 — content + time fields");
  await addColumnIfMissing("release_template_tasks", "description", "TEXT");
  await addColumnIfMissing("release_template_tasks", "all_day", "INTEGER NOT NULL DEFAULT 1");
  await addColumnIfMissing("release_template_tasks", "start_time", "TEXT");
  await addColumnIfMissing("release_template_tasks", "duration_minutes", "INTEGER NOT NULL DEFAULT 30");
  await addColumnIfMissing("release_task_instances", "description", "TEXT");
  await addColumnIfMissing("release_task_instances", "all_day", "INTEGER NOT NULL DEFAULT 1");
  await addColumnIfMissing("release_task_instances", "start_time", "TEXT");
  await addColumnIfMissing("release_task_instances", "duration_minutes", "INTEGER NOT NULL DEFAULT 30");

  console.log("0005 — releases.deleted_at + index");
  await addColumnIfMissing("releases", "deleted_at", "TEXT");
  await d1(`CREATE INDEX IF NOT EXISTS idx_releases_deleted_at ON releases(deleted_at)`);
  console.log("  ✓ idx_releases_deleted_at ensured");

  console.log("0006 — multi-condition templates");
  await addColumnIfMissing("release_templates", "platform_prefixes", "TEXT");
  await addColumnIfMissing("release_templates", "release_types", "TEXT");
  // Backfill JSON arrays from legacy single-value columns if they exist.
  const tplCols = await columns("release_templates");
  if (tplCols.has("platform_prefix")) {
    await d1(
      `UPDATE release_templates
         SET platform_prefixes = json_array(platform_prefix)
       WHERE platform_prefix IS NOT NULL
         AND platform_prefix != ''
         AND platform_prefixes IS NULL`,
    );
    console.log("  ✓ backfilled platform_prefixes from platform_prefix");
  }
  if (tplCols.has("release_type")) {
    await d1(
      `UPDATE release_templates
         SET release_types = json_array(release_type)
       WHERE release_type IS NOT NULL
         AND release_type != ''
         AND release_types IS NULL`,
    );
    console.log("  ✓ backfilled release_types from release_type");
  }

  console.log("0007 — release notifications table");
  await d1(`
    CREATE TABLE IF NOT EXISTS release_template_notifications (
      id           TEXT PRIMARY KEY,
      template_id  TEXT NOT NULL REFERENCES release_templates(id) ON DELETE CASCADE,
      event_type   TEXT NOT NULL,
      message      TEXT NOT NULL,
      webhook_url  TEXT,
      position     INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    )
  `);
  console.log("  ✓ release_template_notifications table ensured");
  await d1(`
    CREATE INDEX IF NOT EXISTS idx_template_notifications_template
      ON release_template_notifications(template_id, position)
  `);
  console.log("  ✓ idx_template_notifications_template ensured");

  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
