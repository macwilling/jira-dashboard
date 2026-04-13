-- Soft-delete for releases. Jira "version_deleted" webhook now sets deleted_at
-- instead of hard-deleting, so users can decide when (and whether) to purge
-- associated Google Tasks / Calendar events. A later purge action clears the
-- row and cascade-removes task instances.
ALTER TABLE releases ADD COLUMN deleted_at TEXT;
CREATE INDEX IF NOT EXISTS idx_releases_deleted_at ON releases(deleted_at);
