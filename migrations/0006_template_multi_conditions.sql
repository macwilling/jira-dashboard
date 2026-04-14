-- Multi-value template conditions: a template can match against a list of
-- platform prefixes AND/OR a list of release types instead of a single value.
-- Null / empty list = wildcard (match any). Values are stored as JSON arrays
-- of strings (e.g. '["web","android"]', '["minor","major"]').
--
-- The legacy `platform_prefix` / `release_type` columns stay around unused so
-- existing rows remain readable if we ever roll back — writes go to the new
-- columns only.
ALTER TABLE release_templates ADD COLUMN platform_prefixes TEXT;
ALTER TABLE release_templates ADD COLUMN release_types TEXT;

UPDATE release_templates
SET platform_prefixes = json_array(platform_prefix)
WHERE platform_prefix IS NOT NULL AND platform_prefix != '';

UPDATE release_templates
SET release_types = json_array(release_type)
WHERE release_type IS NOT NULL AND release_type != '';
