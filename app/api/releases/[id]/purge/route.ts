import { NextRequest, NextResponse } from "next/server";
import { getRelease, purgeRelease } from "@/lib/releases/store";
import { listTaskInstances } from "@/lib/releases/templates-store";
import {
  deleteGoogleTask,
  deleteCalendarEvent,
  getGoogleCredentials,
} from "@/lib/google/client";
import type { ReleaseTaskInstance } from "@/lib/releases/types";

function getTaskListId(instance: ReleaseTaskInstance): string {
  return (instance.actionConfig?.taskListId as string | undefined) ?? "@default";
}

function getCalendarId(instance: ReleaseTaskInstance): string {
  return (instance.actionConfig?.calendarId as string | undefined) ?? "primary";
}

/**
 * Purge a soft-deleted release: delete any Google Tasks / Calendar events the
 * dispatcher previously created, then hard-delete the D1 row (cascading its
 * task instances). Per-artifact failures don't block the purge — the response
 * enumerates any errors so the user can clean up by hand if needed.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const release = await getRelease(id);
    if (!release) {
      return NextResponse.json({ error: "release not found" }, { status: 404 });
    }

    const instances = await listTaskInstances(id);
    const withExternal = instances.filter((i) => !!i.externalId);

    const creds = await getGoogleCredentials().catch(() => null);
    const errors: { label: string; error: string }[] = [];
    let deletedCount = 0;

    if (creds && withExternal.length > 0) {
      for (const instance of withExternal) {
        try {
          if (instance.actionType === "google_task") {
            await deleteGoogleTask(getTaskListId(instance), instance.externalId!);
            deletedCount++;
          } else if (instance.actionType === "calendar_event") {
            await deleteCalendarEvent(getCalendarId(instance), instance.externalId!);
            deletedCount++;
          }
        } catch (e) {
          errors.push({ label: instance.label, error: (e as Error).message });
        }
      }
    }

    await purgeRelease(id);

    return NextResponse.json({
      ok: true,
      purgedReleaseId: id,
      googleDeleted: deletedCount,
      googleSkipped: !creds ? withExternal.length : 0,
      errors,
    });
  } catch (e) {
    console.error("[DELETE /api/releases/[id]/purge]", e);
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 },
    );
  }
}
