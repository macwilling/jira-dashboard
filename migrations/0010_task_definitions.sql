-- Task definition library: reusable action definitions that template tasks can
-- link to. Enables one canonical "Create calendar event for deploy" definition
-- that many templates reuse, with locks on fields that should stay consistent
-- and configurable fields that use-sites can override per template.

CREATE TABLE IF NOT EXISTS release_task_definitions (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,            -- Library display name
  label                TEXT NOT NULL,            -- Task/event title template
  description          TEXT,
  action_type          TEXT NOT NULL,            -- "google_task" | "calendar_event"
  day_offset           INTEGER NOT NULL DEFAULT 0,
  all_day              INTEGER NOT NULL DEFAULT 1,
  start_time           TEXT,
  duration_minutes     INTEGER NOT NULL DEFAULT 30,
  action_config        TEXT,                     -- JSON
  configurable_fields  TEXT NOT NULL DEFAULT '[]', -- JSON array of field names that use-sites can override
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

-- Link template tasks back to the library. NULL definition_id = inline task
-- (unchanged behavior). When definition_id is set, locked fields on the
-- definition win at materialize time regardless of what's in the template row;
-- configurable fields use the template row's value as an override, or the
-- definition's default if the override matches the default.
ALTER TABLE release_template_tasks ADD COLUMN definition_id TEXT;
ALTER TABLE release_template_tasks ADD COLUMN overrides TEXT; -- JSON of field → override value

CREATE INDEX IF NOT EXISTS idx_template_tasks_definition
  ON release_template_tasks(definition_id);
