-- Event-driven notifications attached to release templates.
--
-- Unlike `release_template_tasks` (which are scheduled off a release_date and
-- dispatched to Google), notifications fire synchronously when a release/task
-- lifecycle event happens (created, date changed, released, task failed).
--
-- NOTE: the `webhook_url` column was later renamed to `target` (migration 0008)
-- after the Slack integration migrated to chat.postMessage with a bot token.
-- Target now stores a channel ID (C…/G…) or user ID (U…), not a URL.

CREATE TABLE IF NOT EXISTS release_template_notifications (
  id           TEXT PRIMARY KEY,
  template_id  TEXT NOT NULL REFERENCES release_templates(id) ON DELETE CASCADE,
  event_type   TEXT NOT NULL,   -- "release.created" | "release.date_changed" | "release.released" | "task.failed"
  message      TEXT NOT NULL,   -- merge-field text, rendered at fire time
  webhook_url  TEXT,            -- renamed to `target` in 0008
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_template_notifications_template
  ON release_template_notifications(template_id, position);
