import { d1Query } from "@/lib/d1/client";
import type { ApprovalStatus, JiraVersionPayload, Release } from "./types";

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
  approval_status: string | null;
  approval_version: number | null;
  approval_message_ts: string | null;
  approval_message_channel: string | null;
  approved_at: string | null;
  approved_by: string | null;
}

function rowToRelease(row: ReleaseRow): Release {
  let jiraRaw: unknown = null;
  try {
    jiraRaw = JSON.parse(row.jira_raw);
  } catch {
    jiraRaw = row.jira_raw;
  }
  const status = (row.approval_status ?? "none") as ApprovalStatus;
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
    approvalStatus: status,
    approvalVersion: row.approval_version ?? 0,
    approvalMessageTs: row.approval_message_ts,
    approvalMessageChannel: row.approval_message_channel,
    approvedAt: row.approved_at,
    approvedBy: row.approved_by,
  };
}

/**
 * Record that an approval request was posted to Slack. Called after the
 * webhook successfully posts the message — ties this release to that message
 * so later clicks can be routed back here.
 */
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

/** Increments the approval_version counter. Use when superseding a stale
 *  pending message (release updated in Jira while waiting for approval). */
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

/**
 * Insert or update a release based on a Jira version webhook payload.
 * The full payload is preserved in `jira_raw` for later reference.
 */
export async function upsertRelease(
  version: JiraVersionPayload,
  rawPayload: unknown
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
    ]
  );
}

/**
 * Soft-delete: marks the release as deleted but keeps the row (and its task
 * instances) so the user can review and purge Google side-effects on their own
 * schedule. Call `purgeRelease` to hard-delete.
 */
export async function deleteRelease(id: string): Promise<void> {
  const now = new Date().toISOString();
  await d1Query(
    `UPDATE releases SET deleted_at = ?, updated_at = ? WHERE id = ?`,
    [now, now, id],
  );
}

/**
 * Hard-delete: removes the release row. Task instances cascade-delete via FK.
 * Any Google-side artifacts (Tasks, Calendar events) must be cleaned up by the
 * caller before purging — once the task instance rows are gone, their
 * external_id refs are too.
 */
export async function purgeRelease(id: string): Promise<void> {
  await d1Query(`DELETE FROM releases WHERE id = ?`, [id]);
}

export async function getRelease(id: string): Promise<Release | null> {
  const { results } = await d1Query<ReleaseRow>(
    `SELECT * FROM releases WHERE id = ? LIMIT 1`,
    [id]
  );
  const row = results[0];
  return row ? rowToRelease(row) : null;
}

export async function listReleases(): Promise<Release[]> {
  const { results } = await d1Query<ReleaseRow>(
    `SELECT * FROM releases ORDER BY release_date IS NULL, release_date DESC`
  );
  return results.map(rowToRelease);
}
