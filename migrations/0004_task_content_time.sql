-- Richer task content: description (notes/body), and for calendar events,
-- a time of day + duration. Applied to both the template-side task rows
-- and the per-release instances.

ALTER TABLE release_template_tasks ADD COLUMN description TEXT;
ALTER TABLE release_template_tasks ADD COLUMN all_day INTEGER NOT NULL DEFAULT 1;
ALTER TABLE release_template_tasks ADD COLUMN start_time TEXT;         -- "HH:MM"
ALTER TABLE release_template_tasks ADD COLUMN duration_minutes INTEGER NOT NULL DEFAULT 30;

ALTER TABLE release_task_instances ADD COLUMN description TEXT;
ALTER TABLE release_task_instances ADD COLUMN all_day INTEGER NOT NULL DEFAULT 1;
ALTER TABLE release_task_instances ADD COLUMN start_time TEXT;
ALTER TABLE release_task_instances ADD COLUMN duration_minutes INTEGER NOT NULL DEFAULT 30;
