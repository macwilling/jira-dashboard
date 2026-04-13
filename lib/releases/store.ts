import { d1Query } from "@/lib/d1/client";
import type { JiraVersionPayload, Release } from "./types";

interface ReleaseRow {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  release_date: string | null;
  start_date: string | null;
  released: number;
  archived: number;
  jira_raw: string;
  received_at: string;
  updated_at: string;
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
    jiraRaw,
    receivedAt: row.received_at,
    updatedAt: row.updated_at,
  };
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

export async function deleteRelease(id: string): Promise<void> {
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
