/**
 * Orchestrates Google Tasks / Calendar side-effects for release task instances.
 *
 * Two entry points:
 *   autoDispatchPending — called after generate/regenerate. Creates Google resources
 *     for pending dispatchable tasks and marks them done.
 *   cascadeReleaseDateChange — called when a release's release_date changes.
 *     Updates remote due dates, but skips anything already completed locally or remotely
 *     so we never re-schedule finished work.
 *
 * Both are idempotent and never throw at the top level — per-task failures are persisted
 * to `last_dispatch_error` so the UI surfaces them without needing to tail server logs.
 */

import {
  listTaskInstances,
  setTaskInstanceExternalRef,
  setTaskInstanceDispatchError,
  clearTaskInstanceDispatchError,
  clearTaskInstanceExternalRef,
  setTaskInstanceDueDate,
  updateTaskInstanceStatus,
} from "./templates-store";
import {
  createGoogleTask,
  createCalendarEvent,
  getGoogleTaskStatus,
  getGoogleTaskDetails,
  updateGoogleTaskDue,
  getCalendarEventStatus,
  getCalendarEventDetails,
  updateCalendarEventDate,
  getGoogleCredentials,
} from "@/lib/google/client";
import type { CalendarEventDetails } from "@/lib/google/client";
import { getConfig } from "@/lib/config";
import { addDays } from "./matcher";
import { getRelease } from "./store";
import { fireReleaseEvent } from "./notifications";
import type { ReleaseTaskInstance } from "./types";

const DEFAULT_TIMEZONE = "America/New_York";

async function resolveTimeZone(): Promise<string> {
  const config = await getConfig().catch(() => null);
  return config?.standupTimezone || DEFAULT_TIMEZONE;
}

function getTaskListId(instance: ReleaseTaskInstance): string {
  return (instance.actionConfig?.taskListId as string | undefined) ?? "@default";
}

function getCalendarId(instance: ReleaseTaskInstance): string {
  return (instance.actionConfig?.calendarId as string | undefined) ?? "primary";
}

function isDispatchable(i: ReleaseTaskInstance): boolean {
  return i.actionType === "google_task" || i.actionType === "calendar_event";
}

async function fireTaskFailed(
  instance: ReleaseTaskInstance,
  error: string,
): Promise<void> {
  const release = await getRelease(instance.releaseId).catch(() => null);
  if (!release) return;
  await fireReleaseEvent({
    release,
    eventType: "task.failed",
    event: { taskLabel: instance.label, error },
  });
}

/**
 * Dispatch a single pending task instance. Persists external ref on success
 * and last_dispatch_error on failure. Safe to call concurrently; never throws.
 */
export async function dispatchInstance(
  instance: ReleaseTaskInstance,
): Promise<{ ok: boolean; error?: string }> {
  // Already dispatched — don't duplicate the Google resource.
  if (instance.externalId) return { ok: true };
  if (!isDispatchable(instance)) return { ok: true };

  try {
    if (instance.actionType === "google_task") {
      const ref = await createGoogleTask({
        taskListId: getTaskListId(instance),
        title: instance.label,
        notes: instance.description,
        dueDate: instance.dueDate,
      });
      await setTaskInstanceExternalRef(instance.id, ref.id, ref.url);
      await updateTaskInstanceStatus(instance.id, "done");
      return { ok: true };
    }
    if (instance.actionType === "calendar_event") {
      if (!instance.dueDate) {
        const err = "No due date — calendar event needs a date";
        await setTaskInstanceDispatchError(instance.id, err);
        await fireTaskFailed(instance, err);
        return { ok: false, error: err };
      }
      const timeZone = await resolveTimeZone();
      const ref = await createCalendarEvent({
        calendarId: getCalendarId(instance),
        summary: instance.label,
        description: instance.description,
        date: instance.dueDate,
        startTime: instance.allDay ? null : instance.startTime,
        durationMinutes: instance.durationMinutes,
        timeZone,
      });
      await setTaskInstanceExternalRef(instance.id, ref.id, ref.url);
      await updateTaskInstanceStatus(instance.id, "done");
      return { ok: true };
    }
    return { ok: true };
  } catch (e) {
    const err = (e as Error).message;
    await setTaskInstanceDispatchError(instance.id, err).catch(() => {});
    await fireTaskFailed(instance, err);
    return { ok: false, error: err };
  }
}

/**
 * Auto-dispatch every pending dispatchable task for a release. Called after
 * generate/regenerate so the user doesn't have to click "Create task" N times.
 *
 * If Google isn't connected, we skip all dispatch (rather than marking each
 * row with the same error) so the UI shows "pending" cleanly and the user can
 * dispatch manually later.
 */
export async function autoDispatchPendingInstances(
  releaseId: string,
): Promise<void> {
  const creds = await getGoogleCredentials().catch(() => null);
  if (!creds) return;

  const instances = await listTaskInstances(releaseId);
  const needsDispatch = instances.filter(
    (i) => !i.externalId && isDispatchable(i),
  );
  for (const instance of needsDispatch) {
    await dispatchInstance(instance);
  }
}

/**
 * Cascade a changed release_date to all pending task instances.
 *
 * For each pending task:
 *   - no external_id → just update local due_date
 *   - has external_id (google_task) → check remote status
 *       - remote completed → mark local done (sync up), don't reschedule
 *       - remote missing → clear external_id, update local due_date only
 *       - remote pending → PATCH remote due date, update local due_date
 *   - has external_id (calendar_event) → check remote status
 *       - remote cancelled/missing → clear external_id, update local due_date only
 *       - otherwise → PATCH remote date, update local due_date
 *
 * Already-done / skipped local tasks are left alone entirely.
 */
export async function cascadeReleaseDateChange(
  releaseId: string,
  newReleaseDate: string | null,
): Promise<void> {
  const instances = await listTaskInstances(releaseId);
  const creds = await getGoogleCredentials().catch(() => null);

  for (const instance of instances) {
    const newDueDate = newReleaseDate
      ? addDays(newReleaseDate, instance.dayOffset)
      : null;

    // No external ref — just update local date.
    if (!instance.externalId) {
      await setTaskInstanceDueDate(instance.id, newDueDate);
      continue;
    }

    // External ref exists but Google isn't connected — still update local so
    // the UI stays consistent. Record a warning on the row.
    if (!creds) {
      await setTaskInstanceDueDate(instance.id, newDueDate);
      await setTaskInstanceDispatchError(
        instance.id,
        "Google not connected — remote date not updated",
      );
      continue;
    }

    try {
      if (instance.actionType === "google_task") {
        const status = await getGoogleTaskStatus(
          getTaskListId(instance),
          instance.externalId,
        );
        if (status === "completed") {
          // User finished it in Google — mirror locally, don't reschedule.
          await updateTaskInstanceStatus(instance.id, "done");
          continue;
        }
        if (status === "missing") {
          await setTaskInstanceDueDate(instance.id, newDueDate);
          await setTaskInstanceDispatchError(
            instance.id,
            "Remote task was deleted — local date updated only",
          );
          continue;
        }
        await updateGoogleTaskDue(
          getTaskListId(instance),
          instance.externalId,
          newDueDate,
        );
        await setTaskInstanceDueDate(instance.id, newDueDate);
      } else if (instance.actionType === "calendar_event") {
        const status = await getCalendarEventStatus(
          getCalendarId(instance),
          instance.externalId,
        );
        if (status === "missing" || status === "cancelled") {
          await setTaskInstanceDueDate(instance.id, newDueDate);
          await setTaskInstanceDispatchError(
            instance.id,
            "Remote event was removed — local date updated only",
          );
          continue;
        }
        if (!newDueDate) {
          // Release date cleared and event can't be "undated"; leave remote alone.
          await setTaskInstanceDueDate(instance.id, null);
          continue;
        }
        const timeZone = await resolveTimeZone();
        await updateCalendarEventDate(
          getCalendarId(instance),
          instance.externalId,
          {
            date: newDueDate,
            startTime: instance.allDay ? null : instance.startTime,
            durationMinutes: instance.durationMinutes,
            timeZone,
          },
        );
        await setTaskInstanceDueDate(instance.id, newDueDate);
      } else {
        await setTaskInstanceDueDate(instance.id, newDueDate);
      }
    } catch (e) {
      const err = (e as Error).message;
      // Still update local date so the UI reflects reality.
      await setTaskInstanceDueDate(instance.id, newDueDate).catch(() => {});
      await setTaskInstanceDispatchError(instance.id, err).catch(() => {});
    }
  }
}

/**
 * Probe Google for every dispatched task/event in the release and update local
 * sync state. Used by the "Refresh sync" button on the detail page and the
 * list page sync summary.
 *
 * Error prefixes drive the UI's SyncState pills:
 *   - "MISSING: ..." → remote was deleted; external_id cleared so retry will recreate
 *   - "DRIFT: ..."   → remote still exists but date/time diverged
 *   - no error       → synced
 *
 * Never throws at the top level — per-row failures are persisted.
 */
export async function refreshSyncStatus(releaseId: string): Promise<void> {
  const instances = await listTaskInstances(releaseId);
  const creds = await getGoogleCredentials().catch(() => null);
  if (!creds) return;

  for (const instance of instances) {
    if (!isDispatchable(instance)) continue;
    if (!instance.externalId) continue; // nothing dispatched to check

    try {
      if (instance.actionType === "google_task") {
        const details = await getGoogleTaskDetails(
          getTaskListId(instance),
          instance.externalId,
        );
        if (!details) {
          await clearTaskInstanceExternalRef(instance.id);
          await setTaskInstanceDispatchError(
            instance.id,
            "MISSING: Task was deleted from Google Tasks",
          );
          continue;
        }
        if (details.due !== instance.dueDate) {
          await setTaskInstanceDispatchError(
            instance.id,
            `DRIFT: Google due date ${details.due ?? "(none)"} ≠ expected ${instance.dueDate ?? "(none)"}`,
          );
          continue;
        }
        await clearTaskInstanceDispatchError(instance.id);
      } else if (instance.actionType === "calendar_event") {
        const details = await getCalendarEventDetails(
          getCalendarId(instance),
          instance.externalId,
        );
        if (!details || details.status === "cancelled") {
          await clearTaskInstanceExternalRef(instance.id);
          await setTaskInstanceDispatchError(
            instance.id,
            "MISSING: Event was deleted from Google Calendar",
          );
          continue;
        }
        const drift = detectCalendarDrift(instance, details);
        if (drift) {
          await setTaskInstanceDispatchError(instance.id, `DRIFT: ${drift}`);
          continue;
        }
        await clearTaskInstanceDispatchError(instance.id);
      }
    } catch (e) {
      await setTaskInstanceDispatchError(
        instance.id,
        `Refresh failed: ${(e as Error).message}`,
      ).catch(() => {});
    }
  }
}

/**
 * Force-update Google to match this row's expected schedule. Used by the
 * "Push to Google" button on drifted rows — Jira is the source of truth for
 * release dates, so drift is corrected by re-asserting the Jira-derived date
 * in Google rather than accepting the manual edit in Google.
 */
export async function pushInstanceToGoogle(
  instance: ReleaseTaskInstance,
): Promise<{ ok: boolean; error?: string }> {
  if (!instance.externalId) {
    return { ok: false, error: "No external reference" };
  }
  if (!isDispatchable(instance)) return { ok: true };

  try {
    if (instance.actionType === "google_task") {
      await updateGoogleTaskDue(
        getTaskListId(instance),
        instance.externalId,
        instance.dueDate,
      );
      await clearTaskInstanceDispatchError(instance.id);
      return { ok: true };
    }

    if (instance.actionType === "calendar_event") {
      if (!instance.dueDate) {
        return { ok: false, error: "No expected date to push" };
      }
      const timeZone = await resolveTimeZone();
      await updateCalendarEventDate(
        getCalendarId(instance),
        instance.externalId,
        {
          date: instance.dueDate,
          startTime: instance.allDay ? null : instance.startTime,
          durationMinutes: instance.durationMinutes,
          timeZone,
        },
      );
      await clearTaskInstanceDispatchError(instance.id);
      return { ok: true };
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

function detectCalendarDrift(
  instance: ReleaseTaskInstance,
  event: CalendarEventDetails,
): string | null {
  if (instance.allDay) {
    if (event.startDateTimeDate) {
      return `Event is now timed, expected all-day on ${instance.dueDate ?? "(none)"}`;
    }
    if (event.startDate !== instance.dueDate) {
      return `All-day event on ${event.startDate ?? "(none)"} ≠ expected ${instance.dueDate ?? "(none)"}`;
    }
    return null;
  }

  // Timed event: compare both date and "HH:MM" against expected.
  if (event.startDate) {
    return `Event is now all-day on ${event.startDate}, expected timed on ${instance.dueDate ?? "(none)"}`;
  }
  if (!event.startDateTimeDate || !event.startDateTimeTime) {
    return `Event has no start time`;
  }
  if (
    event.startDateTimeDate !== instance.dueDate ||
    event.startDateTimeTime !== instance.startTime
  ) {
    return `Event at ${event.startDateTimeDate} ${event.startDateTimeTime} ≠ expected ${instance.dueDate ?? "(none)"} ${instance.startTime ?? "(none)"}`;
  }
  return null;
}
