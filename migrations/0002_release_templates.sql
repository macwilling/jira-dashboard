-- Release workflow templates
CREATE TABLE IF NOT EXISTS release_templates (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  platform_prefix TEXT,                     -- e.g. "web", "android"; NULL = match all
  release_type    TEXT,                     -- "major" | "minor" | "patch"; NULL = match all
  priority        INTEGER NOT NULL DEFAULT 0, -- ascending; lower = higher priority
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

-- Ordered task definitions within a template
CREATE TABLE IF NOT EXISTS release_template_tasks (
  id            TEXT PRIMARY KEY,
  template_id   TEXT NOT NULL REFERENCES release_templates(id) ON DELETE CASCADE,
  label         TEXT NOT NULL,
  action_type   TEXT NOT NULL,  -- "manual" | "google_task" | "calendar_event" | "slack_message"
  day_offset    INTEGER NOT NULL DEFAULT 0, -- negative = before release date
  position      INTEGER NOT NULL DEFAULT 0, -- ordering within template
  action_config TEXT,           -- JSON blob for action-specific settings (optional)
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- Per-release task instances generated from a matched template
CREATE TABLE IF NOT EXISTS release_task_instances (
  id               TEXT PRIMARY KEY,
  release_id       TEXT NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  template_task_id TEXT NOT NULL,
  template_id      TEXT NOT NULL,
  label            TEXT NOT NULL,
  action_type      TEXT NOT NULL,
  day_offset       INTEGER NOT NULL,
  due_date         TEXT,  -- ISO date computed from release_date + day_offset; NULL if no release date
  status           TEXT NOT NULL DEFAULT 'pending', -- "pending" | "done" | "skipped"
  action_config    TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_template_tasks_template ON release_template_tasks(template_id, position);
CREATE INDEX IF NOT EXISTS idx_task_instances_release  ON release_task_instances(release_id);
