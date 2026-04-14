-- Rename release_template_notifications.webhook_url to `target`.
--
-- Slack integration migrated from incoming webhooks to chat.postMessage with a
-- bot token, so the column no longer stores a URL — it stores a channel ID
-- (C…), user ID (U…), or DM/group ID. Name reflects that.

ALTER TABLE release_template_notifications RENAME COLUMN webhook_url TO target;
