import { d1Query } from "@/lib/d1/client";
import { parseReleaseName } from "./matcher";
import type { ReleaseCategory, ReleaseType } from "./types";

interface CategoryRow {
  id: string;
  key: string;
  platform_prefix: string;
  release_type: string;
  workflow_id: string | null;
  created_at: string;
  updated_at: string;
}

function rowToCategory(row: CategoryRow): ReleaseCategory {
  return {
    id: row.id,
    key: row.key,
    platformPrefix: row.platform_prefix,
    releaseType: row.release_type as ReleaseType,
    workflowId: row.workflow_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listCategories(): Promise<ReleaseCategory[]> {
  const { results } = await d1Query<CategoryRow>(
    `SELECT * FROM release_category ORDER BY platform_prefix, release_type`,
  );
  return results.map(rowToCategory);
}

export async function getCategory(id: string): Promise<ReleaseCategory | null> {
  const { results } = await d1Query<CategoryRow>(
    `SELECT * FROM release_category WHERE id = ? LIMIT 1`,
    [id],
  );
  return results[0] ? rowToCategory(results[0]) : null;
}

/**
 * Resolve the category a release belongs to from its Jira name.
 * Returns null when the name doesn't parse or no category exists for that
 * (platform, release type) combo — caller treats the release as "unmatched".
 */
export async function resolveCategoryForName(
  releaseName: string,
): Promise<ReleaseCategory | null> {
  const { platform, releaseType } = parseReleaseName(releaseName);
  if (!platform || !releaseType) return null;

  const { results } = await d1Query<CategoryRow>(
    `SELECT * FROM release_category
      WHERE platform_prefix = ? AND release_type = ?
      LIMIT 1`,
    [platform, releaseType],
  );
  return results[0] ? rowToCategory(results[0]) : null;
}

/**
 * Assign (or clear) a workflow for a category. Used from the categories UI.
 * workflowId = null leaves the category defined but unassigned.
 */
export async function setCategoryWorkflow(
  categoryId: string,
  workflowId: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  await d1Query(
    `UPDATE release_category
        SET workflow_id = ?, updated_at = ?
      WHERE id = ?`,
    [workflowId, now, categoryId],
  );
}
