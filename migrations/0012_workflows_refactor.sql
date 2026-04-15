-- Workflows refactor.
--
-- Collapses the "templates + matching + composition" model into a simpler
-- "one release → one workflow" model, and introduces an exhaustive
-- release_category lookup table so routing is deterministic.
--
-- DESTRUCTIVE: drops old release_templates / release_template_tasks /
-- release_template_notifications and recreates `releases` + task instances
-- with new foreign keys. Only safe because the release tables are not yet
-- in production use.
--
-- What we keep:
--   - release_task_definitions  (task library, unchanged)
--
-- What we drop:
--   - release_templates                 → replaced by `workflow`
--   - release_template_tasks            → replaced by `workflow_tasks`
--   - release_template_notifications    → replaced by `workflow_notifications`
--
-- What we recreate (fresh, incompatible FK):
--   - releases                          (adds category_id + resolution_*)
--   - release_task_instances            (workflow_task_id / workflow_id)
--
-- What we add:
--   - workflow
--   - workflow_tasks
--   - workflow_notifications
--   - release_category          (exhaustive lookup, UNIQUE on coverage)
--   - release_events            (audit log)
--
-- Category-change resolution: when a release's category changes after tasks
-- exist, the orchestrator sets resolution_required + resolution_reason and
-- freezes automation until the admin chooses keep_original / switch_workflow
-- / discard via Slack buttons or the in-app resolution banner.

-- ---------------------------------------------------------------------------
-- Drop old tables (cascade order)
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS release_task_instances;
DROP TABLE IF EXISTS release_template_notifications;
DROP TABLE IF EXISTS release_template_tasks;
DROP TABLE IF EXISTS release_templates;
DROP TABLE IF EXISTS releases;

-- ---------------------------------------------------------------------------
-- workflow: the single unit that owns approval target + notification rules
-- + task list for a release.
-- ---------------------------------------------------------------------------
CREATE TABLE workflow (
  id                      TEXT PRIMARY KEY,
  name                    TEXT NOT NULL,
  approval_slack_target   TEXT,                 -- channel/user ID; NULL = no approval gate
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- workflow_tasks: ordered task list for a workflow.
-- definition_id NULL   = inline one-off task (label/description/action live here)
-- definition_id NOT NULL = linked to a library task; locked fields come from
--                          the definition, configurable fields can be overridden
--                          via `overrides` (JSON map of field → value).
-- ---------------------------------------------------------------------------
CREATE TABLE workflow_tasks (
  id               TEXT PRIMARY KEY,
  workflow_id      TEXT NOT NULL REFERENCES workflow(id) ON DELETE CASCADE,
  definition_id    TEXT REFERENCES release_task_definitions(id) ON DELETE RESTRICT,
  label            TEXT NOT NULL,
  description      TEXT,
  action_type      TEXT NOT NULL,               -- "manual" | "google_task" | "calendar_event"
  day_offset       INTEGER NOT NULL DEFAULT 0,
  position         INTEGER NOT NULL DEFAULT 0,
  all_day          INTEGER NOT NULL DEFAULT 1,
  start_time       TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  action_config    TEXT,                        -- JSON
  overrides        TEXT,                        -- JSON map of configurable field → override value
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE INDEX idx_workflow_tasks_workflow   ON workflow_tasks(workflow_id, position);
CREATE INDEX idx_workflow_tasks_definition ON workflow_tasks(definition_id);

-- ---------------------------------------------------------------------------
-- workflow_notifications: event-driven Slack messages attached to a workflow.
-- Fires when the orchestrator emits release.created / release.date_changed /
-- release.released / task.failed / release.needs_resolution.
-- ---------------------------------------------------------------------------
CREATE TABLE workflow_notifications (
  id           TEXT PRIMARY KEY,
  workflow_id  TEXT NOT NULL REFERENCES workflow(id) ON DELETE CASCADE,
  event_type   TEXT NOT NULL,
  message      TEXT NOT NULL,
  target       TEXT NOT NULL,                   -- channel ID (C…/G…) or user ID (U…)
  buttons      TEXT,                            -- JSON array of { label, url }
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX idx_workflow_notifications_workflow
  ON workflow_notifications(workflow_id, position);

-- ---------------------------------------------------------------------------
-- release_category: exhaustive lookup of (platform, release_type) → workflow.
-- UNIQUE on (platform_prefix, release_type) means no release can match two.
-- workflow_id nullable: a category can be defined but unassigned; releases
-- matching it will sit in the "unmatched" state until you assign a workflow.
-- ---------------------------------------------------------------------------
CREATE TABLE release_category (
  id                TEXT PRIMARY KEY,
  key               TEXT NOT NULL UNIQUE,         -- e.g. "web-major", for UI/URL use
  platform_prefix   TEXT NOT NULL,                -- e.g. "web", "android"
  release_type      TEXT NOT NULL,                -- "major" | "minor" | "patch"
  workflow_id       TEXT REFERENCES workflow(id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  UNIQUE(platform_prefix, release_type)
);

CREATE INDEX idx_release_category_workflow ON release_category(workflow_id);

-- ---------------------------------------------------------------------------
-- releases: recreated with new columns.
--
-- category_id:           resolved at ingest; NULL = unmatched
-- resolution_required:   1 when category changed after tasks exist; freezes
--                        automation until resolved
-- resolution_reason:     'category_changed' for now; open enum for future
-- resolution_snapshot:   JSON with { oldCategoryId, newCategoryId, oldCategoryKey,
--                        newCategoryKey, oldWorkflowId, newWorkflowId, taskCounts }
-- ---------------------------------------------------------------------------
CREATE TABLE releases (
  id                        TEXT PRIMARY KEY,     -- Jira version ID
  project_id                TEXT NOT NULL,
  name                      TEXT NOT NULL,
  description               TEXT,
  release_date              TEXT,
  start_date                TEXT,
  released                  INTEGER NOT NULL DEFAULT 0,
  archived                  INTEGER NOT NULL DEFAULT 0,
  jira_raw                  TEXT NOT NULL,
  received_at               TEXT NOT NULL,
  updated_at                TEXT NOT NULL,
  deleted_at                TEXT,

  -- category + resolution state
  category_id               TEXT REFERENCES release_category(id) ON DELETE SET NULL,
  resolution_required       INTEGER NOT NULL DEFAULT 0,
  resolution_reason         TEXT,
  resolution_snapshot       TEXT,

  -- approval state (carried forward; target now sourced from workflow)
  approval_status           TEXT NOT NULL DEFAULT 'none',  -- 'none'|'pending'|'approved'|'cancelled'
  approval_version          INTEGER NOT NULL DEFAULT 0,
  approval_message_ts       TEXT,
  approval_message_channel  TEXT,
  approved_at               TEXT,
  approved_by               TEXT
);

CREATE INDEX idx_releases_project    ON releases(project_id);
CREATE INDEX idx_releases_date       ON releases(release_date);
CREATE INDEX idx_releases_deleted    ON releases(deleted_at);
CREATE INDEX idx_releases_category   ON releases(category_id);
CREATE INDEX idx_releases_resolution ON releases(resolution_required);

-- ---------------------------------------------------------------------------
-- release_task_instances: recreated with workflow FKs.
-- ---------------------------------------------------------------------------
CREATE TABLE release_task_instances (
  id                  TEXT PRIMARY KEY,
  release_id          TEXT NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  workflow_id         TEXT NOT NULL,
  workflow_task_id    TEXT NOT NULL,
  label               TEXT NOT NULL,
  description         TEXT,
  action_type         TEXT NOT NULL,
  day_offset          INTEGER NOT NULL,
  due_date            TEXT,
  all_day             INTEGER NOT NULL DEFAULT 1,
  start_time          TEXT,
  duration_minutes    INTEGER NOT NULL DEFAULT 30,
  action_config       TEXT,
  status              TEXT NOT NULL DEFAULT 'pending', -- 'pending'|'done'|'skipped'
  external_id         TEXT,
  external_url        TEXT,
  last_dispatch_error TEXT,
  last_dispatch_at    TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE INDEX idx_task_instances_release  ON release_task_instances(release_id);
CREATE INDEX idx_task_instances_workflow ON release_task_instances(workflow_id);

-- ---------------------------------------------------------------------------
-- release_events: append-only audit log of significant release-level events.
-- Entries include ingest, category assignment, category change detection,
-- resolution choices, approval transitions, and dispatch outcomes.
-- ---------------------------------------------------------------------------
CREATE TABLE release_events (
  id          TEXT PRIMARY KEY,
  release_id  TEXT NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,
  details     TEXT,                  -- JSON
  actor       TEXT,                  -- user ID / 'system' / 'cron'
  created_at  TEXT NOT NULL
);

CREATE INDEX idx_release_events_release ON release_events(release_id, created_at);

-- ---------------------------------------------------------------------------
-- Seed the 6 default release categories. workflow_id left NULL — you wire
-- each one to a workflow from the UI.
-- ---------------------------------------------------------------------------
INSERT INTO release_category (id, key, platform_prefix, release_type, workflow_id, created_at, updated_at) VALUES
  ('cat_web_major',     'web-major',     'web',     'major', NULL, datetime('now'), datetime('now')),
  ('cat_web_minor',     'web-minor',     'web',     'minor', NULL, datetime('now'), datetime('now')),
  ('cat_web_patch',     'web-patch',     'web',     'patch', NULL, datetime('now'), datetime('now')),
  ('cat_android_major', 'android-major', 'android', 'major', NULL, datetime('now'), datetime('now')),
  ('cat_android_minor', 'android-minor', 'android', 'minor', NULL, datetime('now'), datetime('now')),
  ('cat_android_patch', 'android-patch', 'android', 'patch', NULL, datetime('now'), datetime('now'));
