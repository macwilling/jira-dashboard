import { NextResponse } from "next/server";
import {
  createIssue,
  adfDoc,
  adfParagraph,
  adfHeading,
  adfParagraphWithLink,
} from "@/lib/jira/client";
import { listRecentTickets, freshdeskTicketUrl } from "@/lib/freshdesk/client";
import { postSlackMessage } from "@/lib/slack/client";
import {
  buildCgGateView,
  buildCgStopView,
  buildTicketSyncDetailsView,
  buildBugReportView,
  CB_REQUEST_TYPE,
  CB_TICKET_SYNC_CG_GATE,
  CB_TICKET_SYNC_DETAILS,
  CB_BUG_REPORT,
  BLOCK_REQUEST_TYPE,
  ACTION_REQUEST_TYPE,
  BLOCK_CG_UPDATED,
  ACTION_CG_UPDATED,
  BLOCK_DG_TICKET,
  ACTION_DG_TICKET,
  BLOCK_SYNC_METHOD,
  ACTION_SYNC_METHOD,
  BLOCK_FIELD_DETAILS,
  ACTION_FIELD_DETAILS,
  BLOCK_FD_TICKET,
  ACTION_FD_TICKET,
  BLOCK_BUG_TITLE,
  ACTION_BUG_TITLE,
  BLOCK_REPRODUCED,
  ACTION_REPRODUCED,
  BLOCK_MULTI_CLIENT,
  ACTION_MULTI_CLIENT,
  BLOCK_STEPS,
  ACTION_STEPS,
  BLOCK_EXPECTED,
  ACTION_EXPECTED,
} from "@/lib/slack/support-modals";

const JIRA_PROJECT = "IST";

interface ViewState {
  values?: Record<
    string,
    Record<
      string,
      {
        value?: string | null;
        selected_option?: { value: string } | null;
      }
    >
  >;
}

export interface SupportViewPayload {
  type: string;
  user?: { id?: string };
  view?: {
    id?: string;
    callback_id?: string;
    state?: ViewState;
  };
}

function getField(
  state: ViewState | undefined,
  blockId: string,
  actionId: string,
): string {
  const raw = state?.values?.[blockId]?.[actionId];
  return (
    raw?.selected_option?.value ?? raw?.value ?? ""
  ).trim();
}

function jiraUrl(key: string): string {
  const base = process.env.JIRA_URL?.replace(/\/$/, "") ?? "";
  return `${base}/browse/${key}`;
}

async function dmUser(userId: string, text: string, blocks?: unknown[]) {
  await postSlackMessage({ channel: userId, text, blocks }).catch((e) =>
    console.warn("[support-handlers] DM failed", e),
  );
}

// ─── Router ───────────────────────────────────────────────────────────────────

export async function handleSupportViewSubmission(
  payload: SupportViewPayload,
): Promise<NextResponse> {
  const callbackId = payload.view?.callback_id;

  switch (callbackId) {
    case CB_REQUEST_TYPE:
      return handleRequestTypeSubmit(payload);
    case CB_TICKET_SYNC_CG_GATE:
      return handleCgGateSubmit(payload);
    case CB_TICKET_SYNC_DETAILS:
      return handleTicketSyncDetailsSubmit(payload);
    case CB_BUG_REPORT:
      return handleBugReportSubmit(payload);
    default:
      return NextResponse.json({ ok: true });
  }
}

// ─── Step 1: request type → push next view ────────────────────────────────────

async function handleRequestTypeSubmit(
  payload: SupportViewPayload,
): Promise<NextResponse> {
  const state = payload.view?.state;
  const requestType = getField(state, BLOCK_REQUEST_TYPE, ACTION_REQUEST_TYPE);

  if (requestType === "ticket_sync") {
    return NextResponse.json({
      response_action: "push",
      view: buildCgGateView(),
    });
  }

  if (requestType === "bug_report") {
    const fdTickets = await listRecentTickets(100);
    return NextResponse.json({
      response_action: "push",
      view: buildBugReportView(fdTickets),
    });
  }

  return NextResponse.json({ ok: true });
}

// ─── Step 2a: ConcreteGo gate ─────────────────────────────────────────────────

async function handleCgGateSubmit(
  payload: SupportViewPayload,
): Promise<NextResponse> {
  const state = payload.view?.state;
  const cgUpdated = getField(state, BLOCK_CG_UPDATED, ACTION_CG_UPDATED);

  if (cgUpdated === "no") {
    return NextResponse.json({
      response_action: "update",
      view: buildCgStopView(),
    });
  }

  return NextResponse.json({
    response_action: "push",
    view: buildTicketSyncDetailsView(),
  });
}

// ─── Step 3a: ticket sync → create Jira Task ──────────────────────────────────

async function handleTicketSyncDetailsSubmit(
  payload: SupportViewPayload,
): Promise<NextResponse> {
  const state = payload.view?.state;
  const dgTicket = getField(state, BLOCK_DG_TICKET, ACTION_DG_TICKET);
  const syncMethod = getField(state, BLOCK_SYNC_METHOD, ACTION_SYNC_METHOD);
  const fieldDetails = getField(
    state,
    BLOCK_FIELD_DETAILS,
    ACTION_FIELD_DETAILS,
  );

  if (!dgTicket) {
    return NextResponse.json({
      response_action: "errors",
      errors: { [BLOCK_DG_TICKET]: "Please enter a DG ticket number." },
    });
  }

  if (syncMethod === "specify" && !fieldDetails) {
    return NextResponse.json({
      response_action: "errors",
      errors: {
        [BLOCK_FIELD_DETAILS]:
          "Please specify the fields to update, or choose Mirror.",
      },
    });
  }

  const isMirror = syncMethod === "mirror";
  const summary = `[Sync] DG-${dgTicket} - ${isMirror ? "Mirror from ConcreteGo" : "Manual field update"}`;

  const descBlocks = isMirror
    ? [
        adfHeading("Sync Request"),
        adfParagraph(`DG Ticket: #${dgTicket}`),
        adfParagraph("Sync Method: Mirror from ConcreteGo"),
        adfParagraph("ConcreteGo has been confirmed as updated."),
        adfParagraph("Raised via Slack."),
      ]
    : [
        adfHeading("Sync Request"),
        adfParagraph(`DG Ticket: #${dgTicket}`),
        adfParagraph("Sync Method: Manual field specification"),
        adfHeading("Fields to Update", 4),
        adfParagraph(fieldDetails),
        adfParagraph("ConcreteGo has been confirmed as updated."),
        adfParagraph("Raised via Slack."),
      ];

  try {
    const result = await createIssue({
      projectKey: JIRA_PROJECT,
      issueType: "Task",
      summary,
      description: adfDoc(descBlocks),
      labels: ["L2"],
    });

    const userId = payload.user?.id;
    if (userId) {
      await dmUser(
        userId,
        `Jira ticket created: ${result.key}`,
        [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:white_check_mark: *Ticket created:* <${jiraUrl(result.key)}|${result.key}>\n${summary}`,
            },
          },
        ],
      );
    }

    return NextResponse.json({ response_action: "clear" });
  } catch (e) {
    console.error("[support-handlers] createIssue failed", e);
    return NextResponse.json({
      response_action: "errors",
      errors: {
        [BLOCK_DG_TICKET]: `Failed to create Jira ticket: ${(e as Error).message}`,
      },
    });
  }
}

// ─── Step 2b: bug report → create Jira Bug ────────────────────────────────────

async function handleBugReportSubmit(
  payload: SupportViewPayload,
): Promise<NextResponse> {
  const state = payload.view?.state;
  const fdTicketId = getField(state, BLOCK_FD_TICKET, ACTION_FD_TICKET);
  const bugTitle = getField(state, BLOCK_BUG_TITLE, ACTION_BUG_TITLE);
  const reproduced = getField(state, BLOCK_REPRODUCED, ACTION_REPRODUCED);
  const multiClient = getField(state, BLOCK_MULTI_CLIENT, ACTION_MULTI_CLIENT);
  const steps = getField(state, BLOCK_STEPS, ACTION_STEPS);
  const expected = getField(state, BLOCK_EXPECTED, ACTION_EXPECTED);

  if (!bugTitle) {
    return NextResponse.json({
      response_action: "errors",
      errors: { [BLOCK_BUG_TITLE]: "Please enter a bug title." },
    });
  }

  const reproducedLabel =
    reproduced === "yes" ? "Yes" : reproduced === "no" ? "No" : "Not specified";
  const multiClientLabel =
    multiClient === "yes"
      ? "Yes"
      : multiClient === "no"
        ? "No"
        : multiClient === "unknown"
          ? "Unknown"
          : "Not specified";

  const fdDomain = process.env.FRESHDESK_DOMAIN ?? "";
  const fdIdNum = fdTicketId ? parseInt(fdTicketId, 10) : null;

  const descBlocks = [
    adfHeading("Bug Report"),
    ...(fdIdNum
      ? [
          adfParagraphWithLink(
            `FD Ticket #${fdIdNum}`,
            freshdeskTicketUrl(fdDomain, fdIdNum),
          ),
        ]
      : [adfParagraph("FD Ticket: Not specified")]),
    adfHeading("Triage", 4),
    adfParagraph(`Reproduced internally: ${reproducedLabel}`),
    adfParagraph(`Affecting multiple clients: ${multiClientLabel}`),
    adfHeading("Steps to Reproduce", 4),
    adfParagraph(steps || "Not provided"),
    adfHeading("Expected Behavior", 4),
    adfParagraph(expected || "Not provided"),
    adfParagraph("Raised via Slack."),
  ];

  try {
    const result = await createIssue({
      projectKey: JIRA_PROJECT,
      issueType: "Bug",
      summary: bugTitle,
      description: adfDoc(descBlocks),
      labels: ["L2"],
    });

    const userId = payload.user?.id;
    if (userId) {
      await dmUser(
        userId,
        `Bug ticket created: ${result.key}`,
        [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:beetle: *Bug ticket created:* <${jiraUrl(result.key)}|${result.key}>\n${bugTitle}`,
            },
          },
        ],
      );
    }

    return NextResponse.json({ response_action: "clear" });
  } catch (e) {
    console.error("[support-handlers] createIssue failed", e);
    return NextResponse.json({
      response_action: "errors",
      errors: {
        [BLOCK_BUG_TITLE]: `Failed to create Jira ticket: ${(e as Error).message}`,
      },
    });
  }
}
