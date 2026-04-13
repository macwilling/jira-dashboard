-- Run this against the "jira-dashboard" D1 database.
-- Cloudflare D1 console → select database → Console → paste and run.

CREATE TABLE IF NOT EXISTS releases (
  id            TEXT PRIMARY KEY,      -- Jira version ID
  project_id    TEXT NOT NULL,         -- Jira numeric project ID (webhook doesn't include key)
  name          TEXT NOT NULL,
  description   TEXT,
  release_date  TEXT,                  -- ISO date (YYYY-MM-DD) or NULL
  start_date    TEXT,
  released      INTEGER NOT NULL DEFAULT 0,   -- boolean
  archived      INTEGER NOT NULL DEFAULT 0,   -- boolean
  jira_raw      TEXT NOT NULL,         -- full webhook payload JSON
  received_at   TEXT NOT NULL,         -- ISO timestamp of first webhook
  updated_at    TEXT NOT NULL          -- ISO timestamp of most recent webhook
);

CREATE INDEX IF NOT EXISTS idx_releases_project ON releases(project_id);
CREATE INDEX IF NOT EXISTS idx_releases_date ON releases(release_date);
