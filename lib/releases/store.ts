import { d1Query } from "@/lib/d1/client";
import type {
  ApprovalStatus,
  JiraVersionPayload,
  Release,
  ResolutionReason,
  ResolutionSnapshot,
} from "./types";

interface ReleaseRow {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  release_date: string | null;
  start_date: string | null;
  released: number;
  archived: number;
  deleted_at: string | null;
  jira_raw: string;
  received_at: string;
  updated_at: string;
  ignored: number;
  category_id: string | null;
  resolution_required: number;
  resolution_reason: string | null;
  resolution_snapshot: string | null;
  approval_status: string | null;
  approval_version: number | null;
  approval_message_ts: string | null;
  approval_message_channel: string | null;
  approved_at: string | null;
  approved_by: string | null;
}

function parseSnapshot(raw: string | null): ResolutionSnapshot | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ResolutionSnapshot;
  } catch {
    return null;
  }
}

function rowToRelease(row: ReleaseRow): Release {
  let jiraRaw: unknown = null;
  try {
    jiraRaw = JSON.parse(row.jira_raw);
  } catch {
    jiraRaw = row.jira_raw;
  }
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    description: row.description,
    releaseDate: row.release_date,
    startDate: row.start_date,
    released: row.released === 1,
    archived: row.archived === 1,
    deletedAt: row.deleted_at ?? null,
    jiraRaw,
    receivedAt: row.received_at,
    updatedAt: row.updated_at,

    ignored: row.ignored === 1,
    categoryId: row.category_id,
    resolutionRequired: row.resolution_required === 1,
    resolutionReason: (row.resolution_reason as ResolutionReason | null) ?? null,
    resolutionSnapshot: parseSnapshot(row.resolution_snapshot),

    approvalStatus: (row.approval_status ?? "none") as ApprovalStatus,
    approvalVersion: row.approval_version ?? 0,
    approvalMessageTs: row.approval_message_ts,
    approvalMessageChannel: row.approval_message_channel,
    approvedAt: row.approved_at,
    approvedBy: row.approved_by,
  };
}

// ─── Approval state transitions ───────────────────────────────────────────────

export async function setApprovalPending(
  id: string,
  params: { version: number; messageTs: string; channel: string },
): Promise<void> {
  const now = new Date().toISOString();
  await d1Query(
    `UPDATE releases
        SET approval_status = 'pending',
            approval_version = ?,
            approval_message_ts = ?,
            approval_message_channel = ?,
            updated_at = ?
      WHERE id = ?`,
    [params.version, params.messageTs, params.channel, now, id],
  );
}

export async function bumpApprovalVersion(id: string): Promise<number> {
  const now = new Date().toISOString();
  const { results } = await d1Query<{ approval_version: number | null }>(
    `UPDATE releases
        SET approval_version = COALESCE(approval_version, 0) + 1,
            updated_at = ?
      WHERE id = ?
      RETURNING approval_version`,
    [now, id],
  );
  return results[0]?.approval_version ?? 1;
}

export async function setApprovalApproved(
  id: string,
  approvedBy: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  await d1Query(
    `UPDATE releases
        SET approval_status = 'approved',
            approved_at = ?,
            approved_by = ?,
            updated_at = ?
      WHERE id = ?`,
    [now, approvedBy, now, id],
  );
}

export async function setApprovalCancelled(id: string): Promise<void> {
  const now = new Date().toISOString();
  await d1Query(
    `UPDATE releases
        SET approval_status = 'cancelled',
            updated_at = ?
      WHERE id = ?`,
    [now, id],
  );
}

export async function clearApproval(id: string): Promise<void> {
  const now = new Date().toISOString();
  await d1Query(
    `UPDATE releases
        SET approval_status = 'none',
            approval_message_ts = NULL,
            approval_message_channel = NULL,
            updated_at = ?
      WHERE id = ?`,
    [now, id],
  );
}

// ─── Ignored flag ────────────────────────────────────────────────────────────

export async function setReleaseIgnored(
  id: string,
  ignored: boolean,
): Promise<void> {
  const now = new Date().toISOString();
  await d1Query(
    `UPDATE releases SET ignored = ?, updated_at = ? WHERE id = ?`,
    [ignored ? 1 : 0, now, id],
  );
}

export async function bulkSetReleasesIgnored(
  ids: string[],
  ignored: boolean,
): Promise<void> {
  if (ids.length === 0) return;
  const now = new Date().toISOString();
  const placeholders = ids.map(() => "?").join(",");
  await d1Query(
    `UPDATE releases SET ignored = ?, updated_at = ? WHERE id IN (${placeholders})`,
    [ignored ? 1 : 0, now, ...ids],
  );
}

// ─── Category + resolution state ──────────────────────────────────────────────

export async function setReleaseCategory(
  id: string,
  categoryId: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  await d1Query(
    `UPDATE releases SET category_id = ?, updated_at = ? WHERE id = ?`,
    [categoryId, now, id],
  );
}

export async function setResolutionRequired(
  id: string,
  reason: ResolutionReason,
  snapshot: ResolutionSnapshot,
): Promise<void> {
  const now = new Date().toISOString();
  await d1Query(
    `UPDATE releases
        SET resolution_required = 1,
            resolution_reason = ?,
            resolution_snapshot = ?,
            updated_at = ?
      WHERE id = ?`,
    [reason, JSON.stringify(snapshot), now, id],
  );
}

export async function clearResolution(id: string): Promise<void> {
  const now = new Date().toISOString();
  await d1Query(
    `UPDATE releases
        SET resolution_required = 0,
            resolution_reason = NULL,
            resolution_snapshot = NULL,
            updated_at = ?
      WHERE id = ?`,
    [now, id],
  );
}

// ─── Upsert + lifecycle ───────────────────────────────────────────────────────

/**
 * Insert or update a release from a Jira webhook payload. Does NOT touch the
 * category or resolution state — the orchestrator owns those. On insert,
 * category_id defaults to NULL (unmatched) until the orchestrator resolves it.
 */
export async function upsertRelease(
  version: JiraVersionPayload,
  rawPayload: unknown,
): Promise<void> {
  const now = new Date().toISOString();

  await d1Query(
    `INSERT INTO releases (
       id, project_id, name, description, release_date, start_date,
       released, archived, jira_raw, received_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       project_id   = excluded.project_id,
       name         = excluded.name,
       description  = excluded.description,
       release_date = excluded.release_date,
       start_date   = excluded.start_date,
       released     = excluded.released,
       archived     = excluded.archived,
       jira_raw     = excluded.jira_raw,
       updated_at   = excluded.updated_at`,
    [
      String(version.id),
      String(version.projectId),
      version.name,
      version.description ?? null,
      version.releaseDate ?? null,
      version.startDate ?? null,
      version.released ? 1 : 0,
      version.archived ? 1 : 0,
      JSON.stringify(rawPayload),
      now,
      now,
    ],
  );
}

export async function deleteRelease(id: string): Promise<void> {
  const now = new Date().toISOString();
  await d1Query(
    `UPDATE releases SET deleted_at = ?, updated_at = ? WHERE id = ?`,
    [now, now, id],
  );
}

export async function purgeRelease(id: string): Promise<void> {
  await d1Query(`DELETE FROM releases WHERE id = ?`, [id]);
}

export async function getRelease(id: string): Promise<Release | null> {
  const { results } = await d1Query<ReleaseRow>(
    `SELECT * FROM releases WHERE id = ? LIMIT 1`,
    [id],
  );
  return results[0] ? rowToRelease(results[0]) : null;
}

export async function listReleases(): Promise<Release[]> {
  const { results } = await d1Query<ReleaseRow>(
    `SELECT * FROM releases ORDER BY release_date IS NULL, release_date DESC`,
  );
  return results.map(rowToRelease);
}
