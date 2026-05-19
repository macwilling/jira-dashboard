import { NextResponse } from "next/server";
import {
  createIssue,
  adfDoc,
  adfParagraph,
  adfHeading,
  adfParagraphWithLink,
} from "@/lib/jira/client";
import {
  getTicket,
  searchTickets,
  freshdeskTicketUrl,
  hasFreshdeskCredentials,
} from "@/lib/freshdesk/client";
import { postSlackMessage, updateSlackModal } from "@/lib/slack/client";
import {
  buildCgGateView,
  buildCgStopView,
  buildTicketSyncDetailsView,
  buildSnailTrailView,
  buildBugReportView,
  type FdOption,
  type FdReference,
  CB_REQUEST_TYPE,
  CB_TICKET_SYNC_CG_GATE,
  CB_TICKET_SYNC_DETAILS,
  CB_SNAIL_TRAIL,
  CB_BUG_REPORT,
  BLOCK_REQUEST_TYPE,
  ACTION_REQUEST_TYPE,
  BLOCK_CG_UPDATED,
  ACTION_CG_UPDATED,
  BLOCK_FD_TICKET,
  ACTION_FD_TICKET,
  BLOCK_TENANT,
  ACTION_TENANT,
  BLOCK_DG_TICKET,
  ACTION_DG_TICKET,
  BLOCK_SYNC_METHOD,
  ACTION_SYNC_METHOD,
  BLOCK_FIELD_DETAILS,
  ACTION_FIELD_DETAILS,
  BLOCK_ST_DATES,
  ACTION_ST_DATES,
  BLOCK_ST_TRUCKS,
  ACTION_ST_TRUCKS,
  BLOCK_ST_ORDERS,
  ACTION_ST_ORDERS,
  BLOCK_ST_DTICKETS,
  ACTION_ST_DTICKETS,
  BLOCK_ST_NOTES,
  ACTION_ST_NOTES,
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
// Sync + Snail Trail retrieval are owned by CS Eng; bug reports stay L2.
const LABEL_CS_ENG = "cs-eng";
const LABEL_L2 = "L2";

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

interface SelectedOption {
  text?: { text?: string };
  value?: string;
}

export interface SupportPayload {
  type: string;
  user?: { id?: string };
  /** block_suggestion: the action being typed into. */
  action_id?: string;
  /** block_suggestion: the text the user has typed. */
  value?: string;
  /** block_actions: the elements that were interacted with. */
  actions?: Array<{
    action_id?: string;
    selected_option?: SelectedOption | null;
  }>;
  view?: {
    id?: string;
    hash?: string;
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
  return (raw?.selected_option?.value ?? raw?.value ?? "").trim();
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

// ─── block_suggestion: Freshdesk ticket search ────────────────────────────────

export function isSupportBlockSuggestion(payload: SupportPayload): boolean {
  return (
    payload.type === "block_suggestion" &&
    payload.action_id === ACTION_FD_TICKET
  );
}

export async function handleSupportBlockSuggestion(
  payload: SupportPayload,
): Promise<NextResponse> {
  const query = (payload.value ?? "").trim();
  const tickets = await searchTickets(query);
  // Diagnostic: distinguishes "Slack never called us" (no log at all) from
  // "FD unconfigured" (fdConfigured:false) from "FD returned nothing".
  console.log("[support-handlers] FD suggestion", {
    query,
    fdConfigured: hasFreshdeskCredentials(),
    resultCount: tickets.length,
  });
  const options = tickets.slice(0, 100).map((t) => ({
    text: {
      type: "plain_text" as const,
      text: `#${t.id} — ${t.subject}`.slice(0, 75),
    },
    value: String(t.id),
  }));
  return NextResponse.json({ options });
}

// ─── block_actions: FD ticket chosen → pre-fill the modal ─────────────────────

export function isSupportBlockAction(payload: SupportPayload): boolean {
  return (
    payload.type === "block_actions" &&
    (payload.actions ?? []).some((a) => a?.action_id === ACTION_FD_TICKET)
  );
}

export async function handleSupportBlockAction(
  payload: SupportPayload,
): Promise<NextResponse> {
  const action = (payload.actions ?? []).find(
    (a) => a?.action_id === ACTION_FD_TICKET,
  );
  const view = payload.view;
  if (!action || !view?.id) return NextResponse.json({ ok: true });

  const selected = action.selected_option ?? undefined;
  const state = view.state;

  // Echo the selection back so the picker keeps showing the chosen ticket
  // after we re-render the modal.
  let fdOption: FdOption | undefined;
  let fdReference: FdReference | undefined;
  let fetchedTenant: string | undefined;

  if (selected?.value) {
    fdOption = {
      text: {
        type: "plain_text",
        text: selected.text?.text ?? `#${selected.value}`,
      },
      value: selected.value,
    };

    const id = parseInt(selected.value, 10);
    const ticket = Number.isFinite(id) ? await getTicket(id) : null;
    if (ticket) {
      const domain = process.env.FRESHDESK_DOMAIN ?? "";
      fdReference = {
        ticketId: ticket.id,
        subject: ticket.subject,
        description: ticket.descriptionText,
        url: domain ? freshdeskTicketUrl(domain, ticket.id) : undefined,
      };
      fetchedTenant = ticket.companyName ?? undefined;
    }
  }

  // Carry forward whatever the user already typed in the other fields so the
  // re-render doesn't wipe their input. Tenant follows the FD ticket when we
  // got a company name back.
  let nextView: unknown;
  switch (view.callback_id) {
    case CB_SNAIL_TRAIL:
      nextView = buildSnailTrailView({
        fdOption,
        fdReference,
        tenant: fetchedTenant ?? getField(state, BLOCK_TENANT, ACTION_TENANT),
        dates: getField(state, BLOCK_ST_DATES, ACTION_ST_DATES),
        trucks: getField(state, BLOCK_ST_TRUCKS, ACTION_ST_TRUCKS),
        orders: getField(state, BLOCK_ST_ORDERS, ACTION_ST_ORDERS),
        deliveryTickets: getField(state, BLOCK_ST_DTICKETS, ACTION_ST_DTICKETS),
        notes: getField(state, BLOCK_ST_NOTES, ACTION_ST_NOTES),
      });
      break;
    case CB_TICKET_SYNC_DETAILS:
      nextView = buildTicketSyncDetailsView({
        fdOption,
        fdReference,
        tenant: fetchedTenant ?? getField(state, BLOCK_TENANT, ACTION_TENANT),
        dgTicket: getField(state, BLOCK_DG_TICKET, ACTION_DG_TICKET),
        syncMethod: getField(state, BLOCK_SYNC_METHOD, ACTION_SYNC_METHOD),
        fieldDetails: getField(state, BLOCK_FIELD_DETAILS, ACTION_FIELD_DETAILS),
      });
      break;
    case CB_BUG_REPORT:
      nextView = buildBugReportView({
        fdOption,
        fdReference,
        // Don't clobber a title the user already typed; otherwise seed it
        // from the FD ticket subject.
        bugTitle:
          getField(state, BLOCK_BUG_TITLE, ACTION_BUG_TITLE) ||
          fdReference?.subject,
        reproduced: getField(state, BLOCK_REPRODUCED, ACTION_REPRODUCED),
        multiClient: getField(state, BLOCK_MULTI_CLIENT, ACTION_MULTI_CLIENT),
        steps: getField(state, BLOCK_STEPS, ACTION_STEPS),
        expected: getField(state, BLOCK_EXPECTED, ACTION_EXPECTED),
      });
      break;
    default:
      return NextResponse.json({ ok: true });
  }

  await updateSlackModal(view.id, nextView, view.hash).catch((e) =>
    console.warn("[support-handlers] views.update failed", e),
  );
  return NextResponse.json({ ok: true });
}

// ─── Router (view_submission) ─────────────────────────────────────────────────

export async function handleSupportViewSubmission(
  payload: SupportPayload,
): Promise<NextResponse> {
  switch (payload.view?.callback_id) {
    case CB_REQUEST_TYPE:
      return handleRequestTypeSubmit(payload);
    case CB_TICKET_SYNC_CG_GATE:
      return handleCgGateSubmit(payload);
    case CB_TICKET_SYNC_DETAILS:
      return handleTicketSyncDetailsSubmit(payload);
    case CB_SNAIL_TRAIL:
      return handleSnailTrailSubmit(payload);
    case CB_BUG_REPORT:
      return handleBugReportSubmit(payload);
    default:
      return NextResponse.json({ ok: true });
  }
}

// ─── Step 1: request type → push next view ────────────────────────────────────

async function handleRequestTypeSubmit(
  payload: SupportPayload,
): Promise<NextResponse> {
  const requestType = getField(
    payload.view?.state,
    BLOCK_REQUEST_TYPE,
    ACTION_REQUEST_TYPE,
  );

  switch (requestType) {
    case "ticket_sync":
      return NextResponse.json({
        response_action: "push",
        view: buildCgGateView(),
      });
    case "snail_trail":
      return NextResponse.json({
        response_action: "push",
        view: buildSnailTrailView(),
      });
    case "bug_report":
      return NextResponse.json({
        response_action: "push",
        view: buildBugReportView(),
      });
    default:
      return NextResponse.json({ ok: true });
  }
}

// ─── Step 2a: ConcreteGo gate ─────────────────────────────────────────────────

async function handleCgGateSubmit(
  payload: SupportPayload,
): Promise<NextResponse> {
  const cgUpdated = getField(
    payload.view?.state,
    BLOCK_CG_UPDATED,
    ACTION_CG_UPDATED,
  );

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

// ─── Shared: notify the requester after a ticket is created ───────────────────

async function notifyCreated(
  userId: string | undefined,
  emoji: string,
  label: string,
  key: string,
  summary: string,
) {
  if (!userId) return;
  await dmUser(userId, `${label}: ${key}`, [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${emoji} *${label}:* <${jiraUrl(key)}|${key}>\n${summary}`,
      },
    },
  ]);
}

function fdLinkBlocks(fdId: number | null) {
  if (!fdId) return [adfParagraph("FD Ticket: Not specified")];
  const domain = process.env.FRESHDESK_DOMAIN ?? "";
  return [
    adfParagraphWithLink(`FD Ticket #${fdId}`, freshdeskTicketUrl(domain, fdId)),
  ];
}

// ─── Step 3a: ticket sync → create Jira Task ──────────────────────────────────

async function handleTicketSyncDetailsSubmit(
  payload: SupportPayload,
): Promise<NextResponse> {
  const state = payload.view?.state;
  const fdTicket = getField(state, BLOCK_FD_TICKET, ACTION_FD_TICKET);
  const tenant = getField(state, BLOCK_TENANT, ACTION_TENANT);
  const dgTicket = getField(state, BLOCK_DG_TICKET, ACTION_DG_TICKET);
  const syncMethod = getField(state, BLOCK_SYNC_METHOD, ACTION_SYNC_METHOD);
  const fieldDetails = getField(state, BLOCK_FIELD_DETAILS, ACTION_FIELD_DETAILS);

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

  const fdId = fdTicket ? parseInt(fdTicket, 10) : null;
  const isMirror = syncMethod === "mirror";
  const tenantLabel = tenant || "Unknown";
  const summary = `${tenantLabel} | DG Ticket Sync (DG-${dgTicket}) | ${fdId ? `FD${fdId}` : "No FD"}`;

  const descBlocks = [
    adfHeading("Sync Request"),
    ...fdLinkBlocks(fdId),
    adfParagraph(`Tenant / Client: ${tenantLabel}`),
    adfParagraph(`DG Ticket: #${dgTicket}`),
    adfParagraph(
      `Sync Method: ${isMirror ? "Mirror from ConcreteGo" : "Manual field specification"}`,
    ),
    ...(isMirror
      ? []
      : [adfHeading("Fields to Update", 4), adfParagraph(fieldDetails)]),
    adfParagraph("ConcreteGo has been confirmed as updated."),
    adfParagraph("Raised via Slack."),
  ];

  try {
    const result = await createIssue({
      projectKey: JIRA_PROJECT,
      issueType: "Task",
      summary,
      description: adfDoc(descBlocks),
      labels: [LABEL_CS_ENG],
    });
    await notifyCreated(
      payload.user?.id,
      ":white_check_mark:",
      "Ticket created",
      result.key,
      summary,
    );
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

// ─── Snail Trail Retrieval → create Jira Task ─────────────────────────────────

async function handleSnailTrailSubmit(
  payload: SupportPayload,
): Promise<NextResponse> {
  const state = payload.view?.state;
  const fdTicket = getField(state, BLOCK_FD_TICKET, ACTION_FD_TICKET);
  const tenant = getField(state, BLOCK_TENANT, ACTION_TENANT);
  const dates = getField(state, BLOCK_ST_DATES, ACTION_ST_DATES);
  const trucks = getField(state, BLOCK_ST_TRUCKS, ACTION_ST_TRUCKS);
  const orders = getField(state, BLOCK_ST_ORDERS, ACTION_ST_ORDERS);
  const deliveryTickets = getField(state, BLOCK_ST_DTICKETS, ACTION_ST_DTICKETS);
  const notes = getField(state, BLOCK_ST_NOTES, ACTION_ST_NOTES);

  if (!dates) {
    return NextResponse.json({
      response_action: "errors",
      errors: { [BLOCK_ST_DATES]: "Please enter the date(s) requested." },
    });
  }
  if (!trucks) {
    return NextResponse.json({
      response_action: "errors",
      errors: { [BLOCK_ST_TRUCKS]: "Please enter the truck number(s)." },
    });
  }

  const fdId = fdTicket ? parseInt(fdTicket, 10) : null;
  const tenantLabel = tenant || "Unknown";
  const summary = `${tenantLabel} | Snail Trail | ${fdId ? `FD${fdId}` : "No FD"}`;

  const descBlocks = [
    adfHeading("Snail Trail Retrieval"),
    ...fdLinkBlocks(fdId),
    adfParagraph(`Tenant / Client: ${tenantLabel}`),
    adfHeading("Retrieval Details", 4),
    adfParagraph(`Date(s): ${dates}`),
    adfParagraph(`Truck(s): ${trucks}`),
    adfParagraph(`Order(s): ${orders || "Not specified"}`),
    adfParagraph(`Delivery ticket(s): ${deliveryTickets || "Not specified"}`),
    adfHeading("Additional Context", 4),
    adfParagraph(notes || "None provided"),
    adfParagraph("Raised via Slack."),
  ];

  try {
    const result = await createIssue({
      projectKey: JIRA_PROJECT,
      issueType: "Task",
      summary,
      description: adfDoc(descBlocks),
      labels: [LABEL_CS_ENG],
    });
    await notifyCreated(
      payload.user?.id,
      ":snail:",
      "Snail trail ticket created",
      result.key,
      summary,
    );
    return NextResponse.json({ response_action: "clear" });
  } catch (e) {
    console.error("[support-handlers] createIssue failed", e);
    return NextResponse.json({
      response_action: "errors",
      errors: {
        [BLOCK_ST_DATES]: `Failed to create Jira ticket: ${(e as Error).message}`,
      },
    });
  }
}

// ─── Bug report → create Jira Bug ─────────────────────────────────────────────

async function handleBugReportSubmit(
  payload: SupportPayload,
): Promise<NextResponse> {
  const state = payload.view?.state;
  const fdTicket = getField(state, BLOCK_FD_TICKET, ACTION_FD_TICKET);
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

  const fdId = fdTicket ? parseInt(fdTicket, 10) : null;

  const descBlocks = [
    adfHeading("Bug Report"),
    ...fdLinkBlocks(fdId),
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
      labels: [LABEL_L2],
    });
    await notifyCreated(
      payload.user?.id,
      ":beetle:",
      "Bug ticket created",
      result.key,
      bugTitle,
    );
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
