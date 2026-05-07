import type { FreshdeskTicket } from "@/lib/freshdesk/client";

// ─── callback IDs ─────────────────────────────────────────────────────────────
export const CB_REQUEST_TYPE = "support_request_type";
export const CB_TICKET_SYNC_CG_GATE = "ticket_sync_cg_gate";
export const CB_TICKET_SYNC_DETAILS = "ticket_sync_details";
export const CB_BUG_REPORT = "bug_report_form";

// ─── block / action IDs ───────────────────────────────────────────────────────
export const BLOCK_REQUEST_TYPE = "request_type_block";
export const ACTION_REQUEST_TYPE = "request_type";

export const BLOCK_CG_UPDATED = "cg_updated_block";
export const ACTION_CG_UPDATED = "cg_updated";

export const BLOCK_DG_TICKET = "dg_ticket_block";
export const ACTION_DG_TICKET = "dg_ticket";
export const BLOCK_SYNC_METHOD = "sync_method_block";
export const ACTION_SYNC_METHOD = "sync_method";
export const BLOCK_FIELD_DETAILS = "field_details_block";
export const ACTION_FIELD_DETAILS = "field_details";

export const BLOCK_FD_TICKET = "fd_ticket_block";
export const ACTION_FD_TICKET = "fd_ticket";
export const BLOCK_BUG_TITLE = "bug_title_block";
export const ACTION_BUG_TITLE = "bug_title";
export const BLOCK_REPRODUCED = "reproduced_block";
export const ACTION_REPRODUCED = "reproduced";
export const BLOCK_MULTI_CLIENT = "multi_client_block";
export const ACTION_MULTI_CLIENT = "multi_client";
export const BLOCK_STEPS = "steps_block";
export const ACTION_STEPS = "steps";
export const BLOCK_EXPECTED = "expected_block";
export const ACTION_EXPECTED = "expected";

// ─── Step 1: request type selector ───────────────────────────────────────────
export function buildRequestTypeView() {
  return {
    type: "modal",
    callback_id: CB_REQUEST_TYPE,
    title: { type: "plain_text", text: "Raise an Issue" },
    submit: { type: "plain_text", text: "Next" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: BLOCK_REQUEST_TYPE,
        label: { type: "plain_text", text: "What type of request is this?" },
        element: {
          type: "static_select",
          action_id: ACTION_REQUEST_TYPE,
          placeholder: { type: "plain_text", text: "Select a type..." },
          options: [
            {
              text: { type: "plain_text", text: "DeliveryGo Ticket Sync" },
              value: "ticket_sync",
            },
            {
              text: { type: "plain_text", text: "Bug Report" },
              value: "bug_report",
            },
          ],
        },
      },
    ],
  };
}

// ─── Step 2a: ConcreteGo gate ─────────────────────────────────────────────────
export function buildCgGateView() {
  return {
    type: "modal",
    callback_id: CB_TICKET_SYNC_CG_GATE,
    title: { type: "plain_text", text: "Ticket Sync" },
    submit: { type: "plain_text", text: "Next" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "Before proceeding, please confirm the following:",
        },
      },
      {
        type: "input",
        block_id: BLOCK_CG_UPDATED,
        label: { type: "plain_text", text: "Has ConcreteGo been updated?" },
        element: {
          type: "radio_buttons",
          action_id: ACTION_CG_UPDATED,
          options: [
            { text: { type: "plain_text", text: "Yes" }, value: "yes" },
            { text: { type: "plain_text", text: "No" }, value: "no" },
          ],
        },
      },
    ],
  };
}

// ─── CG gate stop view (replaces gate when user says No) ─────────────────────
export function buildCgStopView() {
  return {
    type: "modal",
    callback_id: "cg_stop",
    title: { type: "plain_text", text: "Action Required" },
    close: { type: "plain_text", text: "Close" },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: ":stop_sign: *Please update ConcreteGo first.*\n\nOnce ConcreteGo has been updated, come back and raise this ticket.",
        },
      },
    ],
  };
}

// ─── Step 3a: ticket sync details ─────────────────────────────────────────────
export function buildTicketSyncDetailsView() {
  return {
    type: "modal",
    callback_id: CB_TICKET_SYNC_DETAILS,
    title: { type: "plain_text", text: "Ticket Sync Details" },
    submit: { type: "plain_text", text: "Create Ticket" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: BLOCK_DG_TICKET,
        label: { type: "plain_text", text: "DG Ticket Number" },
        element: {
          type: "plain_text_input",
          action_id: ACTION_DG_TICKET,
          placeholder: { type: "plain_text", text: "e.g. 1234" },
        },
      },
      {
        type: "input",
        block_id: BLOCK_SYNC_METHOD,
        label: { type: "plain_text", text: "How should we sync?" },
        element: {
          type: "radio_buttons",
          action_id: ACTION_SYNC_METHOD,
          options: [
            {
              text: { type: "plain_text", text: "Mirror what's in ConcreteGo" },
              value: "mirror",
            },
            {
              text: { type: "plain_text", text: "Specify fields manually" },
              value: "specify",
            },
          ],
        },
      },
      {
        type: "input",
        block_id: BLOCK_FIELD_DETAILS,
        label: {
          type: "plain_text",
          text: "Field details (required if specifying manually)",
        },
        element: {
          type: "plain_text_input",
          action_id: ACTION_FIELD_DETAILS,
          multiline: true,
          placeholder: {
            type: "plain_text",
            text: "e.g.\nStatus → In Progress\nAssignee → John Smith",
          },
        },
        optional: true,
      },
    ],
  };
}

// ─── Step 2b: bug report form ─────────────────────────────────────────────────
export function buildBugReportView(fdTickets: FreshdeskTicket[]) {
  const fdOptions = fdTickets.map((t) => {
    const label = `#${t.id} - ${t.subject.slice(0, 66)}`;
    return {
      text: { type: "plain_text", text: label },
      value: String(t.id),
    };
  });

  const fdElement =
    fdOptions.length > 0
      ? {
          type: "static_select",
          action_id: ACTION_FD_TICKET,
          placeholder: {
            type: "plain_text",
            text: "Select a Freshdesk ticket...",
          },
          options: fdOptions,
        }
      : {
          type: "plain_text_input",
          action_id: ACTION_FD_TICKET,
          placeholder: {
            type: "plain_text",
            text: "FD ticket ID (could not load list)",
          },
        };

  return {
    type: "modal",
    callback_id: CB_BUG_REPORT,
    title: { type: "plain_text", text: "Bug Report" },
    submit: { type: "plain_text", text: "Create Ticket" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: BLOCK_FD_TICKET,
        label: { type: "plain_text", text: "Freshdesk Ticket" },
        element: fdElement,
        optional: true,
      },
      {
        type: "input",
        block_id: BLOCK_BUG_TITLE,
        label: { type: "plain_text", text: "Bug Title" },
        element: {
          type: "plain_text_input",
          action_id: ACTION_BUG_TITLE,
          placeholder: {
            type: "plain_text",
            text: "Brief, clear title for this bug",
          },
        },
      },
      {
        type: "input",
        block_id: BLOCK_REPRODUCED,
        label: { type: "plain_text", text: "Reproduced internally?" },
        element: {
          type: "radio_buttons",
          action_id: ACTION_REPRODUCED,
          options: [
            { text: { type: "plain_text", text: "Yes" }, value: "yes" },
            { text: { type: "plain_text", text: "No" }, value: "no" },
          ],
        },
      },
      {
        type: "input",
        block_id: BLOCK_MULTI_CLIENT,
        label: { type: "plain_text", text: "Affecting multiple clients?" },
        element: {
          type: "radio_buttons",
          action_id: ACTION_MULTI_CLIENT,
          options: [
            { text: { type: "plain_text", text: "Yes" }, value: "yes" },
            { text: { type: "plain_text", text: "No" }, value: "no" },
            { text: { type: "plain_text", text: "Unknown" }, value: "unknown" },
          ],
        },
      },
      {
        type: "input",
        block_id: BLOCK_STEPS,
        label: { type: "plain_text", text: "Steps to reproduce" },
        element: {
          type: "plain_text_input",
          action_id: ACTION_STEPS,
          multiline: true,
          placeholder: {
            type: "plain_text",
            text: "1. Go to...\n2. Click on...\n3. See error",
          },
        },
      },
      {
        type: "input",
        block_id: BLOCK_EXPECTED,
        label: { type: "plain_text", text: "Expected behavior" },
        element: {
          type: "plain_text_input",
          action_id: ACTION_EXPECTED,
          multiline: true,
          placeholder: {
            type: "plain_text",
            text: "What should happen instead?",
          },
        },
      },
    ],
  };
}
