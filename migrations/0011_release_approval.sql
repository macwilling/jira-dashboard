-- Release approval gate: when configured, the webhook materializes task
-- instances but withholds Google dispatch until a human clicks Approve on a
-- Slack interactive message.
--
-- Status model:
--   none      — no gate configured or approval not required (legacy behavior)
--   pending   — waiting for human click; dispatch blocked
--   approved  — clicked; dispatch happened (or failed per-row)
--   cancelled — clicked cancel; instances stay un-dispatched
--
-- `approval_version` is a monotonic counter bumped every time the release is
-- updated in Jira while still pending. The button's value carries this
-- version so a stale click (from a superseded message) can be rejected.
--
-- `approval_message_ts` + `approval_message_channel` identify the live Slack
-- message so we can chat.update it on approve/cancel/supersede.

ALTER TABLE releases ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE releases ADD COLUMN approval_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE releases ADD COLUMN approval_message_ts TEXT;
ALTER TABLE releases ADD COLUMN approval_message_channel TEXT;
ALTER TABLE releases ADD COLUMN approved_at TEXT;
ALTER TABLE releases ADD COLUMN approved_by TEXT;
