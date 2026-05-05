-- Add an app-side "ignored" flag to releases. Ignored releases are hidden
-- from the UI and skipped by the orchestrator. The cron job still sees the
-- row (so it won't re-import it), but nothing fires for it.
ALTER TABLE releases ADD COLUMN ignored INTEGER NOT NULL DEFAULT 0;
