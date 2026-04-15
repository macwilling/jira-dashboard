import { NextRequest, NextResponse } from "next/server";
import {
  deleteRelease,
  upsertRelease,
  getRelease,
} from "@/lib/releases/store";
import { maybeGenerateInstances } from "@/lib/releases/templates-store";
import {
  autoDispatchPendingInstances,
  cascadeReleaseDateChange,
} from "@/lib/releases/dispatcher";
import { fireReleaseEvent } from "@/lib/releases/notifications";
import {
  isApprovalGateEnabled,
  postApprovalRequest,
  supersedeAndRepost,
} from "@/lib/releases/approval";
import type {
  JiraVersionPayload,
  JiraVersionWebhookEvent,
} from "@/lib/releases/types";

/**
 * Receiver for Jira "version" webhooks (Fix Versions).
 *
 * Jira webhook setup:
 *   URL:    https://<your-vercel-domain>/api/webhooks/jira/version
 *   Events: Version created, updated, released, unreleased, deleted, moved, merged
 *   Header: X-Webhook-Secret: <value of JIRA_WEBHOOK_SECRET>
 *
 * Note: Jira's native webhook UI doesn't let you set custom headers. Options:
 *   - Use an automation rule ("Send web request" action) which supports headers
 *   - Or embed the secret in the URL as a query param (?secret=...) — less clean
 *   - Or skip verification for now (not recommended for production)
 *
 * This handler accepts the secret via either `X-Webhook-Secret` header OR
 * `?secret=` query param so you can use whichever fits your Jira setup.
 */

interface VersionWebhookBody {
  webhookEvent?: JiraVersionWebhookEvent;
  version?: JiraVersionPayload;
}

function verifySecret(req: NextRequest): boolean {
  const expected = process.env.JIRA_WEBHOOK_SECRET;
  if (!expected) return true; // not configured → skip verification (dev mode)

  const headerSecret = req.headers.get("x-webhook-secret");
  const querySecret = req.nextUrl.searchParams.get("secret");
  return headerSecret === expected || querySecret === expected;
}

export async function POST(req: NextRequest) {
  if (!verifySecret(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: VersionWebhookBody;
  try {
    body = (await req.json()) as VersionWebhookBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const { webhookEvent, version } = body;

  if (!webhookEvent || !webhookEvent.startsWith("jira:version_")) {
    return NextResponse.json(
      { error: `unexpected webhookEvent: ${webhookEvent ?? "missing"}` },
      { status: 400 }
    );
  }

  if (!version || !version.id) {
    return NextResponse.json(
      { error: "missing version payload" },
      { status: 400 }
    );
  }

  try {
    if (webhookEvent === "jira:version_deleted") {
      await deleteRelease(String(version.id));
      return NextResponse.json({ ok: true, action: "deleted", id: version.id });
    }

    // Normalize empty-string dates (Jira automation smart values render unset
    // dates as "") to undefined so downstream stores null and transition
    // detection below works cleanly.
    const normalizedVersion: JiraVersionPayload = {
      ...version,
      releaseDate: version.releaseDate || undefined,
      startDate: version.startDate || undefined,
    };

    const previousRelease = await getRelease(String(version.id)).catch(() => null);
    const previousDate = previousRelease?.releaseDate ?? null;

    await upsertRelease(normalizedVersion, body);

    const newDate = normalizedVersion.releaseDate ?? null;
    const release = await getRelease(String(version.id));
    if (!release) {
      return NextResponse.json({
        ok: true,
        action: "upserted",
        id: version.id,
        event: webhookEvent,
        note: "release not found after upsert — skipping task generation",
      });
    }

    // Template tasks are keyed off release_date, so only generate/dispatch when
    // a date is present. Releases created without a date are stored in D1 and
    // will fire on the later update that sets the date (previousDate → newDate).
    const dateNewlySet = !previousDate && !!newDate;
    const dateChanged = !!previousDate && !!newDate && previousDate !== newDate;

    // Don't regenerate Google side-effects for a release the user has soft-deleted.
    // They'll purge via the Releases UI when ready.
    //
    // Note on name-change re-matching: maybeGenerateInstances runs on every
    // update with a date, and is idempotent (skips if any instances exist).
    // That means a release that initially had a typo in its name (no match →
    // no instances) automatically picks up matching templates the moment the
    // name is corrected in Jira. Conversely, renaming a release after it's
    // generated won't clobber existing tasks — the user can click "Rebuild"
    // on the release detail page if they want to reset.
    if (newDate && !release.deletedAt) {
      await maybeGenerateInstances(release).catch(
        (err) => console.warn("[webhook] maybeGenerateInstances failed", err)
      );

      if (dateChanged) {
        await cascadeReleaseDateChange(String(version.id), newDate).catch(
          (err) => console.warn("[webhook] cascadeReleaseDateChange failed", err)
        );
      }

      // Approval gate: when configured, dispatch is held until the user
      // clicks Approve on an interactive Slack message.
      //
      //   none      → first time seeing this, post approval, skip auto-dispatch
      //   pending   → supersede old message + re-post (Jira updated mid-wait)
      //   approved  → already ok'd, let auto-dispatch run as usual
      //   cancelled → user explicitly said no, stay silent; they can re-trigger
      //               from the app if they change their mind
      const refreshed = await getRelease(String(version.id));
      const approvalTarget = await isApprovalGateEnabled();

      if (approvalTarget && refreshed && refreshed.approvalStatus !== "approved") {
        if (refreshed.approvalStatus === "none") {
          // Only post if there are actual instances to approve — unmatched
          // releases generated nothing and there's nothing to gate.
          await postApprovalRequest({ release: refreshed, target: approvalTarget })
            .catch((err) =>
              console.warn("[webhook] postApprovalRequest failed", err),
            );
        } else if (refreshed.approvalStatus === "pending") {
          await supersedeAndRepost(refreshed, approvalTarget).catch((err) =>
            console.warn("[webhook] supersedeAndRepost failed", err),
          );
        }
        // cancelled: intentionally no-op.
      } else {
        await autoDispatchPendingInstances(String(version.id)).catch(
          (err) => console.warn("[webhook] autoDispatchPendingInstances failed", err)
        );
      }
    }

    // Notification events. fireReleaseEvent swallows its own errors, so these
    // can run in parallel without risking the 200 response.
    //
    // release.created: first time we've seen this version id, OR Jira tells us
    //   it's a create event explicitly. Using both signals avoids missing it
    //   when upstream automation rewrites the event type.
    // release.date_changed: the release previously existed and the date moved
    //   (including null → date; that's a meaningful state change for Slack).
    // release.released: explicit release event from Jira, or the released flag
    //   transitioned false → true.
    const wasNew = !previousRelease;
    const releasedTransitioned =
      !!previousRelease && !previousRelease.released && !!release.released;
    const events: Promise<void>[] = [];
    if (wasNew || webhookEvent === "jira:version_created") {
      events.push(fireReleaseEvent({ release, eventType: "release.created" }));
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
      events.push(fireReleaseEvent({ release, eventType: "release.released" }));
    }
    await Promise.all(events);

    return NextResponse.json({
      ok: true,
      action: "upserted",
      id: version.id,
      event: webhookEvent,
      tasksFired: !!newDate,
      dateNewlySet,
    });
  } catch (e) {
    console.error("[webhook jira version] failed", e);
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 }
    );
  }
}

// Health check — useful when setting up the webhook in Jira.
export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "jira version webhook receiver",
    secretConfigured: !!process.env.JIRA_WEBHOOK_SECRET,
  });
}
