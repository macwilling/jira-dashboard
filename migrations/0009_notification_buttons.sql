-- Per-rule CTA buttons for release notifications.
--
-- Stored as a JSON array of { label, url } objects. Both fields support
-- merge fields (e.g. {{release.id}}), rendered at fire time. Slack caps
-- actions blocks at 5 buttons, enforced in the UI.
--
-- NULL / missing = no buttons; the rule sends plain text like before.

ALTER TABLE release_template_notifications ADD COLUMN buttons TEXT;
