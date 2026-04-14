import { d1Query } from "@/lib/d1/client";
import type {
  NotificationButton,
  ReleaseEventType,
  ReleaseNotification,
} from "./types";

interface NotificationRow {
  id: string;
  template_id: string;
  event_type: string;
  message: string;
  target: string | null;
  buttons: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

function parseButtons(json: string | null): NotificationButton[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    // Defensive projection — only keep known fields so a manually-edited
    // blob can't smuggle arbitrary JSON through to the Slack payload.
    return parsed
      .filter(
        (b): b is NotificationButton =>
          b &&
          typeof b.label === "string" &&
          typeof b.url === "string",
      )
      .map((b) => ({ label: b.label, url: b.url }));
  } catch {
    return [];
  }
}

function serializeButtons(buttons: NotificationButton[] | undefined): string | null {
  if (!buttons || buttons.length === 0) return null;
  return JSON.stringify(
    buttons.map((b) => ({ label: b.label, url: b.url })),
  );
}

function rowToNotification(row: NotificationRow): ReleaseNotification {
  return {
    id: row.id,
    templateId: row.template_id,
    eventType: row.event_type as ReleaseEventType,
    message: row.message,
    target: row.target,
    buttons: parseButtons(row.buttons),
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
  target?: string | null;
  buttons?: NotificationButton[];
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
    const target =
      n.target && n.target.trim() ? n.target.trim() : null;
    // Drop empty / half-filled buttons at the store boundary so they never
    // make it into a Slack payload.
    const cleanButtons = (n.buttons ?? []).filter(
      (b) => b.label.trim() && b.url.trim(),
    );
    const buttonsJson = serializeButtons(cleanButtons);

    await d1Query(
      `INSERT INTO release_template_notifications
         (id, template_id, event_type, message, target, buttons, position,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, templateId, n.eventType, n.message, target, buttonsJson, i, now, now],
    );
    created.push({
      id,
      templateId,
      eventType: n.eventType,
      message: n.message,
      target,
      buttons: cleanButtons,
      position: i,
      createdAt: now,
      updatedAt: now,
    });
  }
  return created;
}
