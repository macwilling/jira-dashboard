import { d1Query } from "@/lib/d1/client";
import type { ReleaseEventType, ReleaseNotification } from "./types";

interface NotificationRow {
  id: string;
  template_id: string;
  event_type: string;
  message: string;
  webhook_url: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

function rowToNotification(row: NotificationRow): ReleaseNotification {
  return {
    id: row.id,
    templateId: row.template_id,
    eventType: row.event_type as ReleaseEventType,
    message: row.message,
    webhookUrl: row.webhook_url,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function newId(): string {
  return crypto.randomUUID();
}

export async function listTemplateNotifications(
  templateId: string,
): Promise<ReleaseNotification[]> {
  const { results } = await d1Query<NotificationRow>(
    `SELECT * FROM release_template_notifications
     WHERE template_id = ?
     ORDER BY position ASC`,
    [templateId],
  );
  return results.map(rowToNotification);
}

export async function listNotificationsForEvent(
  templateId: string,
  eventType: ReleaseEventType,
): Promise<ReleaseNotification[]> {
  const { results } = await d1Query<NotificationRow>(
    `SELECT * FROM release_template_notifications
     WHERE template_id = ? AND event_type = ?
     ORDER BY position ASC`,
    [templateId, eventType],
  );
  return results.map(rowToNotification);
}

export interface TemplateNotificationInput {
  eventType: ReleaseEventType;
  message: string;
  webhookUrl?: string | null;
}

/**
 * Replace all notifications for a template in one shot (matches the
 * replaceTemplateTasks pattern used by the editor's Save).
 */
export async function replaceTemplateNotifications(
  templateId: string,
  notifications: TemplateNotificationInput[],
): Promise<ReleaseNotification[]> {
  await d1Query(
    `DELETE FROM release_template_notifications WHERE template_id = ?`,
    [templateId],
  );
  const now = new Date().toISOString();
  const created: ReleaseNotification[] = [];
  for (let i = 0; i < notifications.length; i++) {
    const n = notifications[i];
    const id = newId();
    const webhookUrl =
      n.webhookUrl && n.webhookUrl.trim() ? n.webhookUrl.trim() : null;
    await d1Query(
      `INSERT INTO release_template_notifications
         (id, template_id, event_type, message, webhook_url, position,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, templateId, n.eventType, n.message, webhookUrl, i, now, now],
    );
    created.push({
      id,
      templateId,
      eventType: n.eventType,
      message: n.message,
      webhookUrl,
      position: i,
      createdAt: now,
      updatedAt: now,
    });
  }
  return created;
}
