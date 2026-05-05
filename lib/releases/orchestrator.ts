/**
 * Orchestrator for release lifecycle events. Single entry point used by:
 *   - `POST /api/webhooks/jira/version` (live events from Jira)
 *   - Cloudflare cron recovery (synthesizes events from Jira polling)
 *
 * Responsibilities:
 *   1. Upsert the release from the Jira payload.
 *   2. Resolve category from the release name.
 *   3. Detect category-change conflicts and freeze the release when one is found.
 *   4. Generate task instances (idempotent) if matched to a workflow.
 *   5. Cascade date changes to already-created Google resources.
 *   6. Apply the approval gate, or auto-dispatch.
 *   7. Fire lifecycle notifications (release.created / release.date_changed /
 *      release.released / release.needs_resolution).
 *
 * Never throws at the top level — per-step failures are logged and persisted to
 * the release_events audit log so the caller (webhook/cron) can return 200
 * without worrying about partial state.
 */

import {
  getRelease,
  upsertRelease,
  deleteRelease,
  setReleaseCategory,
  setResolutionRequired,
} from "./store";
import {
  autoDispatchPendingInstances,
  cascadeReleaseDateChange,
} from "./dispatcher";
import { fireReleaseEvent } from "./notifications";
import {
  postApprovalRequest,
  supersedeAndRepost,
} from "./approval";
import { resolveCategoryForName, getCategory } from "./categories";
import { getWorkflow } from "./workflows-store";
import {
  generateTaskInstances,
  countInstancesByState,
} from "./task-instances-store";
import { recordEvent } from "./events-store";
import { postAdminNeedsResolution } from "./admin-notifier";
import type {
  JiraVersionPayload,
  JiraVersionWebhookEvent,
  Release,
  ReleaseCategory,
  ResolutionSnapshot,
  Workflow,
} from "./types";

export interface HandleVersionEventInput {
  payload: JiraVersionPayload;
  webhookEvent: JiraVersionWebhookEvent;
  rawBody: unknown;
}

export interface HandleVersionEventResult {
  action: "deleted" | "upserted" | "frozen" | "unmatched";
  id: string;
  event: JiraVersionWebhookEvent;
  categoryKey?: string | null;
  workflowId?: string | null;
  tasksGenerated?: number;
}

export async function handleVersionEvent(
  input: HandleVersionEventInput,
): Promise<HandleVersionEventResult> {
  const { payload, webhookEvent, rawBody } = input;
  const id = String(payload.id);

  // ── 1. Delete path ─────────────────────────────────────────────────────────
  if (webhookEvent === "jira:version_deleted") {
    await deleteRelease(id);
    await recordEvent(id, "release.deleted", { webhookEvent });
    return { action: "deleted", id, event: webhookEvent };
  }

  // ── 2. Upsert and snapshot previous state ──────────────────────────────────
  const normalized: JiraVersionPayload = {
    ...payload,
    releaseDate: payload.releaseDate || undefined,
    startDate: payload.startDate || undefined,
  };
  const previous = await getRelease(id).catch(() => null);

  await upsertRelease(normalized, rawBody);

  const release = await getRelease(id);
  if (!release) {
    // Shouldn't happen right after upsert — return gracefully.
    return { action: "upserted", id, event: webhookEvent };
  }

  const isNew = !previous;
  if (isNew) await recordEvent(id, "release.ingested", { webhookEvent });

  const newDate = release.releaseDate;
  const dateChanged =
    !!previous && previous.releaseDate !== release.releaseDate;

  // ── 3. Respect soft-delete, ignored, and existing resolution freeze ────────
  if (release.deletedAt || release.ignored) {
    return { action: "upserted", id, event: webhookEvent };
  }
  if (release.resolutionRequired) {
    await fireLifecycleNotifications(release, previous, webhookEvent);
    return { action: "frozen", id, event: webhookEvent };
  }

  // ── 4. Category resolution ─────────────────────────────────────────────────
  const newCategory = await resolveCategoryForName(release.name);
  const oldCategory = release.categoryId
    ? await getCategory(release.categoryId).catch(() => null)
    : null;

  const hasInstances = await releaseHasInstances(id);
  const categoryChanged =
    !!oldCategory && (!newCategory || newCategory.id !== oldCategory.id);

  // Detect a conflicting category change AFTER tasks exist. This is the only
  // case that triggers resolution-required; everything else flows normally.
  if (categoryChanged && hasInstances) {
    const snapshot = await buildResolutionSnapshot(
      id,
      oldCategory,
      newCategory,
    );
    await setResolutionRequired(id, "category_changed", snapshot);
    await recordEvent(id, "resolution.required", { snapshot });

    // Admin notification (separate from workflow notification rules — the
    // workflow mapping is exactly what's in question here).
    await postAdminNeedsResolution({
      release,
      snapshot,
    }).catch((err) =>
      console.warn("[orchestrator] postAdminNeedsResolution failed", err),
    );

    return {
      action: "frozen",
      id,
      event: webhookEvent,
      categoryKey: oldCategory.key,
      workflowId: oldCategory.workflowId,
    };
  }

  // Normal category transitions (no freeze): update release.category_id.
  if (!oldCategory || !newCategory || newCategory.id !== oldCategory.id) {
    await setReleaseCategory(id, newCategory?.id ?? null);
    if (newCategory && !oldCategory) {
      await recordEvent(id, "category.assigned", {
        categoryId: newCategory.id,
        categoryKey: newCategory.key,
      });
    } else if (newCategory && oldCategory && newCategory.id !== oldCategory.id) {
      await recordEvent(id, "category.changed", {
        oldCategoryId: oldCategory.id,
        oldCategoryKey: oldCategory.key,
        newCategoryId: newCategory.id,
        newCategoryKey: newCategory.key,
      });
    }
  }

  // ── 5. Unmatched releases: fire lifecycle events only ──────────────────────
  const workflow = newCategory?.workflowId
    ? await getWorkflow(newCategory.workflowId).catch(() => null)
    : null;

  if (!workflow) {
    await fireLifecycleNotifications(release, previous, webhookEvent);
    return {
      action: "unmatched",
      id,
      event: webhookEvent,
      categoryKey: newCategory?.key ?? null,
      workflowId: null,
    };
  }

  // ── 6. Generate tasks (idempotent) + cascade date changes ─────────────────
  let generatedCount = 0;
  if (newDate) {
    try {
      const instances = await generateTaskInstances(release, workflow.id);
      generatedCount = instances.length;
      if (instances.length > 0 && !hasInstances) {
        await recordEvent(release.id, "task.generated", {
          count: instances.length,
          workflowId: workflow.id,
        });
      }
    } catch (err) {
      console.warn("[orchestrator] generateTaskInstances failed", err);
    }

    if (dateChanged) {
      await cascadeReleaseDateChange(release.id, newDate).catch((err) =>
        console.warn("[orchestrator] cascadeReleaseDateChange failed", err),
      );
    }
  }

  // ── 7. Approval gate or auto-dispatch ──────────────────────────────────────
  if (newDate && workflow) {
    await applyApprovalOrDispatch(release, workflow);
  }

  // ── 8. Lifecycle notifications ─────────────────────────────────────────────
  await fireLifecycleNotifications(release, previous, webhookEvent);

  return {
    action: "upserted",
    id,
    event: webhookEvent,
    categoryKey: newCategory?.key ?? null,
    workflowId: workflow.id,
    tasksGenerated: generatedCount,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function releaseHasInstances(releaseId: string): Promise<boolean> {
  const counts = await countInstancesByState(releaseId);
  return counts.pending + counts.dispatched + counts.completed > 0;
}

async function buildResolutionSnapshot(
  releaseId: string,
  oldCategory: ReleaseCategory,
  newCategory: ReleaseCategory | null,
): Promise<ResolutionSnapshot> {
  const taskCounts = await countInstancesByState(releaseId);
  const oldWorkflow = oldCategory.workflowId
    ? await getWorkflow(oldCategory.workflowId).catch(() => null)
    : null;
  const newWorkflow = newCategory?.workflowId
    ? await getWorkflow(newCategory.workflowId).catch(() => null)
    : null;

  return {
    oldCategoryId: oldCategory.id,
    oldCategoryKey: oldCategory.key,
    oldWorkflowId: oldWorkflow?.id ?? null,
    oldWorkflowName: oldWorkflow?.name ?? null,
    newCategoryId: newCategory?.id ?? null,
    newCategoryKey: newCategory?.key ?? null,
    newWorkflowId: newWorkflow?.id ?? null,
    newWorkflowName: newWorkflow?.name ?? null,
    taskCounts,
    detectedAt: new Date().toISOString(),
  };
}

async function applyApprovalOrDispatch(
  release: Release,
  workflow: Workflow,
): Promise<void> {
  const target = workflow.approvalSlackTarget;

  // No gate configured on this workflow → auto-dispatch everything pending.
  if (!target) {
    await autoDispatchPendingInstances(release.id).catch((err) =>
      console.warn("[orchestrator] autoDispatchPendingInstances failed", err),
    );
    return;
  }

  // Gate active; behavior depends on current approval status.
  switch (release.approvalStatus) {
    case "approved":
      await autoDispatchPendingInstances(release.id).catch((err) =>
        console.warn("[orchestrator] autoDispatchPendingInstances failed", err),
      );
      return;
    case "none":
      await postApprovalRequest({ release, target }).catch((err) =>
        console.warn("[orchestrator] postApprovalRequest failed", err),
      );
      return;
    case "pending":
      await supersedeAndRepost(release, workflow, target).catch((err) =>
        console.warn("[orchestrator] supersedeAndRepost failed", err),
      );
      return;
    case "cancelled":
      // User explicitly said no; stay silent. They can re-trigger from the app.
      return;
  }
}

async function fireLifecycleNotifications(
  release: Release,
  previous: Release | null,
  webhookEvent: JiraVersionWebhookEvent,
): Promise<void> {
  const wasNew = !previous;
  const previousDate = previous?.releaseDate ?? null;
  const newDate = release.releaseDate;
  const releasedTransitioned =
    !!previous && !previous.released && release.released;

  const events: Promise<void>[] = [];

  if (wasNew || webhookEvent === "jira:version_created") {
    events.push(
      fireReleaseEvent({ release, eventType: "release.created" }),
    );
  }
  if (!wasNew && previousDate !== newDate) {
    events.push(
      fireReleaseEvent({
        release,
        eventType: "release.date_changed",
        event: { oldDate: previousDate, newDate },
      }),
    );
  }
  if (releasedTransitioned || webhookEvent === "jira:version_released") {
    events.push(
      fireReleaseEvent({ release, eventType: "release.released" }),
    );
  }

  await Promise.all(events);
}
