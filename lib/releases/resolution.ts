/**
 * Resolves a category-change freeze on a release. Shared by:
 *   - POST /api/releases/[id]/resolve  (in-app action)
 *   - Slack interactive handler        (button clicks from the admin alert)
 *
 * Three actions:
 *   keep_original   — stay on the old category/workflow. Snapshot pins the
 *                     category back to the old one in case the orchestrator
 *                     had already nulled it before freezing. Task list is
 *                     untouched.
 *   switch_workflow — delete remote Google resources for non-completed
 *                     instances, clear local non-dispatched instances, move
 *                     to the new category, re-generate against the new
 *                     workflow, re-apply the approval gate.
 *   discard         — delete remote Google resources for non-completed
 *                     instances, clear all non-dispatched instances, clear
 *                     the category (release becomes unmatched).
 *
 * Every path writes an audit event and clears resolution_required on success.
 */

import {
  clearResolution,
  getRelease,
  setReleaseCategory,
  clearApproval,
} from "./store";
import { getCategory } from "./categories";
import { getWorkflow } from "./workflows-store";
import {
  clearNonDispatchedInstances,
  generateTaskInstances,
  listTaskInstances,
} from "./task-instances-store";
import {
  autoDispatchPendingInstances,
} from "./dispatcher";
import { postApprovalRequest } from "./approval";
import { recordEvent } from "./events-store";
import {
  deleteGoogleTask,
  deleteCalendarEvent,
  getGoogleCredentials,
} from "@/lib/google/client";
import type { ReleaseTaskInstance, Release } from "./types";

export type ResolutionAction =
  | "keep_original"
  | "switch_workflow"
  | "discard";

export interface ResolveOptions {
  releaseId: string;
  action: ResolutionAction;
  /** Slack user ID or app user, logged to the audit trail. */
  actor?: string | null;
}

export interface ResolveResult {
  ok: boolean;
  action: ResolutionAction;
  /** Post-resolution state of the release. */
  release: Release;
  /** Remote-cleanup errors, if any. Never fatal. */
  googleErrors: { label: string; error: string }[];
}

function getTaskListId(instance: ReleaseTaskInstance): string {
  return (instance.actionConfig?.taskListId as string | undefined) ?? "@default";
}

function getCalendarId(instance: ReleaseTaskInstance): string {
  return (instance.actionConfig?.calendarId as string | undefined) ?? "primary";
}

/**
 * Best-effort remote cleanup for non-completed dispatched instances. Completed
 * (status === 'done') rows are preserved as history — their Google tasks are
 * already closed. Per-row errors are collected, never thrown.
 */
async function deleteNonCompletedGoogleArtifacts(
  instances: ReleaseTaskInstance[],
): Promise<{ label: string; error: string }[]> {
  const creds = await getGoogleCredentials().catch(() => null);
  const targets = instances.filter(
    (i) => !!i.externalId && i.status !== "done",
  );
  if (!creds || targets.length === 0) return [];

  const errors: { label: string; error: string }[] = [];
  for (const instance of targets) {
    try {
      if (instance.actionType === "google_task") {
        await deleteGoogleTask(getTaskListId(instance), instance.externalId!);
      } else if (instance.actionType === "calendar_event") {
        await deleteCalendarEvent(
          getCalendarId(instance),
          instance.externalId!,
        );
      }
    } catch (e) {
      errors.push({ label: instance.label, error: (e as Error).message });
    }
  }
  return errors;
}

export async function resolveRelease(
  opts: ResolveOptions,
): Promise<ResolveResult> {
  const { releaseId, action, actor = null } = opts;
  const release = await getRelease(releaseId);
  if (!release) {
    throw new Error("release not found");
  }
  if (!release.resolutionRequired) {
    throw new Error("release is not awaiting resolution");
  }

  const snapshot = release.resolutionSnapshot;
  if (!snapshot) {
    throw new Error("resolution snapshot missing");
  }

  let googleErrors: { label: string; error: string }[] = [];

  switch (action) {
    case "keep_original": {
      // Pin category back to the snapshot's old category, then clear the
      // freeze. Tasks are left untouched.
      if (snapshot.oldCategoryId) {
        await setReleaseCategory(releaseId, snapshot.oldCategoryId);
      }
      await clearResolution(releaseId);
      await recordEvent(
        releaseId,
        "resolution.keep_original",
        { snapshot },
        actor,
      );
      break;
    }

    case "switch_workflow": {
      if (!snapshot.newCategoryId || !snapshot.newWorkflowId) {
        throw new Error(
          "new category has no workflow — cannot switch; use keep_original or discard",
        );
      }
      const newCategory = await getCategory(snapshot.newCategoryId);
      const newWorkflow = await getWorkflow(snapshot.newWorkflowId);
      if (!newCategory || !newWorkflow) {
        throw new Error("new category or workflow has been removed");
      }

      const instances = await listTaskInstances(releaseId);
      googleErrors = await deleteNonCompletedGoogleArtifacts(instances);

      await clearNonDispatchedInstances(releaseId);
      await setReleaseCategory(releaseId, newCategory.id);
      await clearApproval(releaseId);
      await clearResolution(releaseId);
      await recordEvent(
        releaseId,
        "resolution.switch_workflow",
        {
          newCategoryKey: newCategory.key,
          newWorkflowId: newWorkflow.id,
          googleErrorCount: googleErrors.length,
        },
        actor,
      );

      // Re-read the release so generateTaskInstances sees the updated category.
      const updated = await getRelease(releaseId);
      if (updated && updated.releaseDate) {
        await generateTaskInstances(updated, newWorkflow.id);
        if (newWorkflow.approvalSlackTarget) {
          await postApprovalRequest({
            release: updated,
            target: newWorkflow.approvalSlackTarget,
          }).catch((err) =>
            console.warn(
              "[resolution] postApprovalRequest after switch failed",
              err,
            ),
          );
        } else {
          await autoDispatchPendingInstances(releaseId).catch((err) =>
            console.warn("[resolution] auto-dispatch after switch failed", err),
          );
        }
      }
      break;
    }

    case "discard": {
      const instances = await listTaskInstances(releaseId);
      googleErrors = await deleteNonCompletedGoogleArtifacts(instances);

      await clearNonDispatchedInstances(releaseId);
      await setReleaseCategory(releaseId, null);
      await clearApproval(releaseId);
      await clearResolution(releaseId);
      await recordEvent(
        releaseId,
        "resolution.discard",
        { googleErrorCount: googleErrors.length },
        actor,
      );
      break;
    }
  }

  const after = await getRelease(releaseId);
  if (!after) {
    throw new Error("release disappeared after resolution");
  }
  return {
    ok: true,
    action,
    release: after,
    googleErrors,
  };
}
