-- Track the external resource created by a dispatch (Google Task id, Calendar event id, etc.),
-- a URL to open it, and the last dispatch attempt outcome so errors are visible in the UI.
ALTER TABLE release_task_instances ADD COLUMN external_id TEXT;
ALTER TABLE release_task_instances ADD COLUMN external_url TEXT;
ALTER TABLE release_task_instances ADD COLUMN last_dispatch_error TEXT;
ALTER TABLE release_task_instances ADD COLUMN last_dispatch_at TEXT;
