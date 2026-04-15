import { NextRequest, NextResponse } from "next/server";
import { verifySlackSignature } from "@/lib/slack/signing";
import { updateSlackMessage } from "@/lib/slack/client";
import {
  getRelease,
  setApprovalApproved,
  setApprovalCancelled,
} from "@/lib/releases/store";
import {
  listTaskInstances,
} from "@/lib/releases/task-instances-store";
import { autoDispatchPendingInstances } from "@/lib/releases/dispatcher";
import {
  APPROVE_ACTION_ID,
  CANCEL_ACTION_ID,
  TEST_APPROVE_ACTION_ID,
  TEST_CANCEL_ACTION_ID,
  buildApprovedBlocks,
  buildCancelledBlocks,
  buildTestConfirmedBlocks,
  buildTestCancelledBlocks,
  decodeButtonValue,
} from "@/lib/releases/approval-message";

/**
 * Slack interactive endpoint.
 *
 * Receives button clicks from approval messages. Slack posts
 * `application/x-www-form-urlencoded` with a single `payload` field containing
 * a JSON blob. We must respond within 3 seconds — long-running work (dispatch)
 * happens AFTER we've returned the acknowledgement and is persisted via
 * chat.update.
 *
 * Button values carry `{releaseId}:{approvalVersion}`. A click is only valid
 * if the version matches the release's current approval_version — otherwise
 * it's a stale click on a superseded message and we surface a helpful note.
 */

interface SlackInteractivePayload {
  type: string;
  user?: { id?: string };
  channel?: { id?: string };
  message?: { ts?: string };
  actions?: Array<{ action_id?: string; value?: string }>;
  response_url?: string;
}

function getAbsoluteUrl(req: NextRequest, path: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (base) return `${base}${path}`;
  const origin = req.nextUrl.origin;
  return `${origin}${path}`;
}

export async function POST(req: NextRequest) {
  // Raw body needed for signature verification — must read it before parsing.
  const rawBody = await req.text();

  const sig = req.headers.get("x-slack-signature");
  const tsHeader = req.headers.get("x-slack-request-timestamp");

  // Log enough to diagnose "nothing happens" without leaking secrets. The
  // signature and timestamp are safe to log — the signing secret isn't.
  console.log("[slack interactive] POST received", {
    hasSignature: !!sig,
    hasTimestamp: !!tsHeader,
    hasSigningSecret: !!process.env.SLACK_SIGNING_SECRET,
    bodyLen: rawBody.length,
    contentType: req.headers.get("content-type"),
  });

  if (!process.env.SLACK_SIGNING_SECRET) {
    console.warn("[slack interactive] rejected: SLACK_SIGNING_SECRET is not set");
    return NextResponse.json(
      { error: "SLACK_SIGNING_SECRET not configured on the server" },
      { status: 503 },
    );
  }

  const ok = verifySlackSignature({
    rawBody,
    signature: sig,
    timestamp: tsHeader,
  });
  if (!ok) {
    console.warn("[slack interactive] rejected: signature mismatch or stale timestamp", {
      now: Math.floor(Date.now() / 1000),
      slackTs: tsHeader,
    });
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  // Slack sends x-www-form-urlencoded with a single `payload` field.
  const params = new URLSearchParams(rawBody);
  const payloadStr = params.get("payload");
  if (!payloadStr) {
    return NextResponse.json({ error: "missing payload" }, { status: 400 });
  }

  let payload: SlackInteractivePayload;
  try {
    payload = JSON.parse(payloadStr) as SlackInteractivePayload;
  } catch {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const action = payload.actions?.[0];
  if (!action?.action_id) {
    // "release_view" buttons are URL buttons — Slack still posts the click but
    // we don't need to do anything. Ack silently.
    return NextResponse.json({ ok: true });
  }

  // Route by action_id. "release_view" is a link button that Slack also pings —
  // we just ack since the browser already navigated.
  if (action.action_id === "release_view") {
    return NextResponse.json({ ok: true });
  }

  // Round-trip test from the settings page — edit the message in place and
  // we're done. No DB state, no dispatch, no release.
  if (
    action.action_id === TEST_APPROVE_ACTION_ID ||
    action.action_id === TEST_CANCEL_ACTION_ID
  ) {
    const channel = payload.channel?.id;
    const ts = payload.message?.ts;
    const userId = payload.user?.id ?? null;
    if (channel && ts) {
      const msg =
        action.action_id === TEST_APPROVE_ACTION_ID
          ? buildTestConfirmedBlocks({
              clickedByUserId: userId,
              when: new Date().toISOString(),
            })
          : buildTestCancelledBlocks({ clickedByUserId: userId });
      await updateSlackMessage({ channel, ts, ...msg }).catch((err) =>
        console.warn("[slack interactive] test update failed", err),
      );
    }
    return NextResponse.json({ ok: true });
  }

  if (
    action.action_id !== APPROVE_ACTION_ID &&
    action.action_id !== CANCEL_ACTION_ID
  ) {
    return NextResponse.json({ ok: true });
  }

  const decoded = action.value ? decodeButtonValue(action.value) : null;
  if (!decoded) {
    return NextResponse.json({ error: "bad button value" }, { status: 400 });
  }

  const release = await getRelease(decoded.releaseId);
  if (!release) {
    return NextResponse.json({ ok: true }); // nothing to do
  }

  // Stale-click guard: version must match the release's current approval_version.
  // If not, the user clicked on a superseded message — point them at the newer one.
  if (release.approvalVersion !== decoded.version) {
    const responseUrl = payload.response_url;
    if (responseUrl) {
      await fetch(responseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          response_type: "ephemeral",
          replace_original: false,
          text: `:fast_forward: This approval request was superseded (v${decoded.version} → v${release.approvalVersion}). Use the newer message.`,
        }),
      }).catch(() => {});
    }
    return NextResponse.json({ ok: true });
  }

  // Ignore clicks on already-settled releases.
  if (release.approvalStatus !== "pending") {
    return NextResponse.json({ ok: true });
  }

  const userId = payload.user?.id ?? null;
  const channel = payload.channel?.id ?? release.approvalMessageChannel;
  const ts = payload.message?.ts ?? release.approvalMessageTs;
  const releaseUrl = getAbsoluteUrl(req, `/releases/${release.id}`);

  try {
    if (action.action_id === APPROVE_ACTION_ID) {
      await setApprovalApproved(release.id, userId);
      // Dispatch in the background-ish; Slack gave us 3 seconds but the
      // underlying dispatcher is per-task and can run to completion here at
      // our scale. If it ever becomes a problem, move to a queue.
      await autoDispatchPendingInstances(release.id).catch((err) =>
        console.warn("[slack interactive] dispatch failed", err),
      );
      const instances = await listTaskInstances(release.id);
      if (channel && ts) {
        const msg = buildApprovedBlocks({
          release,
          approvedByUserId: userId,
          approvedAt: new Date().toISOString(),
          taskCount: instances.length,
          releaseUrl,
        });
        await updateSlackMessage({ channel, ts, ...msg }).catch((err) =>
          console.warn("[slack interactive] chat.update failed", err),
        );
      }
      return NextResponse.json({ ok: true });
    }

    if (action.action_id === CANCEL_ACTION_ID) {
      await setApprovalCancelled(release.id);
      if (channel && ts) {
        const msg = buildCancelledBlocks({
          release,
          cancelledByUserId: userId,
          releaseUrl,
        });
        await updateSlackMessage({ channel, ts, ...msg }).catch((err) =>
          console.warn("[slack interactive] chat.update failed", err),
        );
      }
      return NextResponse.json({ ok: true });
    }
  } catch (e) {
    console.error("[slack interactive] failed", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

/**
 * Health check — visit this in a browser to confirm the app is reachable and
 * that the env vars the interactive path depends on are set. The URL shown
 * below is what needs to go into the Slack app's Interactivity Request URL.
 */
export async function GET(req: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? null;
  const inferredRequestUrl = `${req.nextUrl.origin}/api/webhooks/slack/interactive`;
  return NextResponse.json({
    ok: true,
    endpoint: "slack interactive receiver",
    signingSecretConfigured: !!process.env.SLACK_SIGNING_SECRET,
    appUrlConfigured: !!appUrl,
    requestUrlForSlackApp: appUrl
      ? `${appUrl}/api/webhooks/slack/interactive`
      : inferredRequestUrl,
    checklist: [
      "1) SLACK_SIGNING_SECRET set — required to verify incoming clicks",
      "2) NEXT_PUBLIC_APP_URL set — used for 'View in app' links",
      "3) Slack app → Interactivity & Shortcuts is ENABLED",
      "4) Slack app → Interactivity Request URL matches the field above",
      "5) The bot is a member of the target channel (for posting)",
      "6) Deployment is publicly reachable from Slack (prod, or dev via ngrok)",
    ],
  });
}
