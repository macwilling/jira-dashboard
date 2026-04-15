/**
 * Append-only audit log for release lifecycle events. Written by the
 * orchestrator, dispatcher, and resolution endpoints so the history of a
 * release is visible on the detail page without needing to tail server logs.
 */

import { d1Query } from "@/lib/d1/client";
import type { AuditEventType, ReleaseEvent } from "./types";

interface ReleaseEventRow {
  id: string;
  release_id: string;
  event_type: string;
  details: string | null;
  actor: string | null;
  created_at: string;
}

function rowToEvent(row: ReleaseEventRow): ReleaseEvent {
  let details: Record<string, unknown> | null = null;
  if (row.details) {
    try {
      const parsed = JSON.parse(row.details);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        details = parsed as Record<string, unknown>;
      }
    } catch {
      // leave details null
    }
  }
  return {
    id: row.id,
    releaseId: row.release_id,
    eventType: row.event_type as AuditEventType,
    details,
    actor: row.actor,
    createdAt: row.created_at,
  };
}

export async function recordEvent(
  releaseId: string,
  eventType: AuditEventType,
  details: Record<string, unknown> | null = null,
  actor: string | null = "system",
): Promise<void> {
  await d1Query(
    `INSERT INTO release_events (id, release_id, event_type, details, actor, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      crypto.randomUUID(),
      releaseId,
      eventType,
      details ? JSON.stringify(details) : null,
      actor,
      new Date().toISOString(),
    ],
  );
}

export async function listReleaseEvents(
  releaseId: string,
  limit = 100,
): Promise<ReleaseEvent[]> {
  const { results } = await d1Query<ReleaseEventRow>(
    `SELECT * FROM release_events
      WHERE release_id = ?
      ORDER BY created_at DESC
      LIMIT ?`,
    [releaseId, limit],
  );
  return results.map(rowToEvent);
}
