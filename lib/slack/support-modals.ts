// ─── callback IDs ─────────────────────────────────────────────────────────────
export const CB_REQUEST_TYPE = "support_request_type";
export const CB_TICKET_SYNC_CG_GATE = "ticket_sync_cg_gate";
export const CB_TICKET_SYNC_DETAILS = "ticket_sync_details";
export const CB_SNAIL_TRAIL = "snail_trail_form";
export const CB_BUG_REPORT = "bug_report_form";

// ─── block / action IDs ───────────────────────────────────────────────────────
export const BLOCK_REQUEST_TYPE = "request_type_block";
export const ACTION_REQUEST_TYPE = "request_type";

export const BLOCK_CG_UPDATED = "cg_updated_block";
export const ACTION_CG_UPDATED = "cg_updated";

// Freshdesk ticket picker — shared by all three flows. Selecting an option
// dispatches a block_actions event so the handler can pre-fill the modal.
export const BLOCK_FD_TICKET = "fd_ticket_block";
export const ACTION_FD_TICKET = "fd_ticket";

// Tenant / client — shared by the sync and snail-trail flows.
export const BLOCK_TENANT = "tenant_block";
export const ACTION_TENANT = "tenant";

export const BLOCK_DG_TICKET = "dg_ticket_block";
export const ACTION_DG_TICKET = "dg_ticket";
export const BLOCK_SYNC_METHOD = "sync_method_block";
export const ACTION_SYNC_METHOD = "sync_method";
export const BLOCK_FIELD_DETAILS = "field_details_block";
export const ACTION_FIELD_DETAILS = "field_details";

export const BLOCK_ST_DATES = "st_dates_block";
export const ACTION_ST_DATES = "st_dates";
export const BLOCK_ST_TRUCKS = "st_trucks_block";
export const ACTION_ST_TRUCKS = "st_trucks";
export const BLOCK_ST_ORDERS = "st_orders_block";
export const ACTION_ST_ORDERS = "st_orders";
export const BLOCK_ST_DTICKETS = "st_dtickets_block";
export const ACTION_ST_DTICKETS = "st_dtickets";
export const BLOCK_ST_NOTES = "st_notes_block";
export const ACTION_ST_NOTES = "st_notes";

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

// ─── shared types ─────────────────────────────────────────────────────────────

/** A Slack select option — the shape Slack echoes back as `selected_option`
 *  and accepts as `initial_option`. */
export interface FdOption {
  text: { type: "plain_text"; text: string };
  value: string;
}

/** Read-only context rendered in the modal from the chosen FD ticket. */
export interface FdReference {
  ticketId: number;
  subject: string;
  description: string;
  /** Link to the ticket in Freshdesk, when the domain is configured. */
  url?: string;
}

// ─── block helpers ────────────────────────────────────────────────────────────

function plainText(text: string) {
  return { type: "plain_text" as const, text };
}

function textInputBlock(opts: {
  blockId: string;
  actionId: string;
  label: string;
  placeholder?: string;
  multiline?: boolean;
  optional?: boolean;
  initialValue?: string;
  hint?: string;
}) {
  const element: Record<string, unknown> = {
    type: "plain_text_input",
    action_id: opts.actionId,
  };
  if (opts.multiline) element.multiline = true;
  if (opts.placeholder) element.placeholder = plainText(opts.placeholder);
  if (opts.initialValue) element.initial_value = opts.initialValue;

  const block: Record<string, unknown> = {
    type: "input",
    block_id: opts.blockId,
    label: plainText(opts.label),
    element,
  };
  if (opts.optional) block.optional = true;
  if (opts.hint) block.hint = plainText(opts.hint);
  return block;
}

function radioBlock(opts: {
  blockId: string;
  actionId: string;
  label: string;
  options: Array<{ text: string; value: string }>;
  initialValue?: string;
  optional?: boolean;
}) {
  const options = opts.options.map((o) => ({
    text: plainText(o.text),
    value: o.value,
  }));
  const element: Record<string, unknown> = {
    type: "radio_buttons",
    action_id: opts.actionId,
    options,
  };
  if (opts.initialValue) {
    const match = options.find((o) => o.value === opts.initialValue);
    if (match) element.initial_option = match;
  }
  const block: Record<string, unknown> = {
    type: "input",
    block_id: opts.blockId,
    label: plainText(opts.label),
    element,
  };
  if (opts.optional) block.optional = true;
  return block;
}

/**
 * Freshdesk ticket picker. An `external_select` — Slack calls the app's
 * Options Load URL as the user types, so it isn't capped at the recent 100.
 * `dispatch_action` makes a selection fire a block_actions event, which the
 * handler uses to fetch the ticket and pre-fill the modal.
 */
function fdSelectBlock(opts: { optional: boolean; initialOption?: FdOption }) {
  const element: Record<string, unknown> = {
    type: "external_select",
    action_id: ACTION_FD_TICKET,
    placeholder: plainText("Search by FD ticket # or subject"),
    min_query_length: 2,
  };
  if (opts.initialOption) element.initial_option = opts.initialOption;

  return {
    type: "input",
    block_id: BLOCK_FD_TICKET,
    label: plainText("Freshdesk Ticket"),
    hint: plainText(
      "Type a ticket number to look it up directly, or search by subject.",
    ),
    element,
    dispatch_action: true,
    optional: opts.optional,
  };
}

/**
 * Read-only reference for the chosen FD ticket, so whoever fills the form can
 * transcribe details without leaving Slack. Set apart from the input fields:
 * a small context header, the body as an indented quote block, and dividers
 * top and bottom. Slack modals can't scroll a sub-region, so the body is
 * truncated to keep it from dominating the form.
 */
const FD_REFERENCE_LIMIT = 700;

function fdReferenceBlocks(ref: FdReference): unknown[] {
  const desc = ref.description.trim().replace(/\n{3,}/g, "\n\n");
  const truncated = desc.length > FD_REFERENCE_LIMIT;
  const snippet = truncated ? `${desc.slice(0, FD_REFERENCE_LIMIT)}…` : desc;

  const ticketLabel = `FD #${ref.ticketId}`;
  const linkedTicket = ref.url ? `<${ref.url}|${ticketLabel}>` : ticketLabel;
  const header =
    `*Reference* · ${linkedTicket} — ${ref.subject || "(no subject)"}` +
    (truncated ? "  ·  _truncated, open in Freshdesk for full text_" : "");

  return [
    divider(),
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: header }],
    },
    {
      type: "section",
      // `>>>` renders a multi-line quote block — left bar + indent — which
      // separates this from the surrounding input fields. The trailing
      // divider is supplied by the caller's next block push.
      text: {
        type: "mrkdwn",
        text: snippet ? `>>>${snippet}` : "_(no description text)_",
      },
    },
  ];
}

function divider() {
  return { type: "divider" as const };
}

// ─── Step 1: request type selector ───────────────────────────────────────────

export function buildRequestTypeView() {
  return {
    type: "modal",
    callback_id: CB_REQUEST_TYPE,
    title: plainText("DG Support"),
    submit: plainText("Next"),
    close: plainText("Cancel"),
    blocks: [
      {
        type: "input",
        block_id: BLOCK_REQUEST_TYPE,
        label: plainText("What type of request is this?"),
        element: {
          type: "static_select",
          action_id: ACTION_REQUEST_TYPE,
          placeholder: plainText("Select a type..."),
          options: [
            {
              text: plainText("DeliveryGo Ticket Sync"),
              value: "ticket_sync",
            },
            {
              text: plainText("Snail Trail Retrieval"),
              value: "snail_trail",
            },
            {
              text: plainText("Bug Report"),
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
    title: plainText("Ticket Sync"),
    submit: plainText("Next"),
    close: plainText("Cancel"),
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
        label: plainText("Has ConcreteGo been updated?"),
        element: {
          type: "radio_buttons",
          action_id: ACTION_CG_UPDATED,
          options: [
            { text: plainText("Yes"), value: "yes" },
            { text: plainText("No"), value: "no" },
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
    title: plainText("Action Required"),
    close: plainText("Close"),
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

export interface SyncPrefill {
  fdOption?: FdOption;
  fdReference?: FdReference;
  tenant?: string;
  dgTicket?: string;
  syncMethod?: string;
  fieldDetails?: string;
}

export function buildTicketSyncDetailsView(prefill: SyncPrefill = {}) {
  const blocks: unknown[] = [
    fdSelectBlock({ optional: false, initialOption: prefill.fdOption }),
  ];
  if (prefill.fdReference) blocks.push(...fdReferenceBlocks(prefill.fdReference));
  blocks.push(
    divider(),
    textInputBlock({
      blockId: BLOCK_TENANT,
      actionId: ACTION_TENANT,
      label: "Tenant / Client",
      placeholder: "e.g. Madden Materials (Jarco)",
      initialValue: prefill.tenant,
      hint: "Auto-filled from the Freshdesk ticket — edit if needed.",
    }),
    textInputBlock({
      blockId: BLOCK_DG_TICKET,
      actionId: ACTION_DG_TICKET,
      label: "DeliveryGo Ticket Number",
      placeholder: "e.g. 1234",
      initialValue: prefill.dgTicket,
    }),
    radioBlock({
      blockId: BLOCK_SYNC_METHOD,
      actionId: ACTION_SYNC_METHOD,
      label: "How should we sync?",
      options: [
        { text: "Mirror what's in ConcreteGo", value: "mirror" },
        { text: "Specify fields manually", value: "specify" },
      ],
      initialValue: prefill.syncMethod,
    }),
    textInputBlock({
      blockId: BLOCK_FIELD_DETAILS,
      actionId: ACTION_FIELD_DETAILS,
      label: "Field details (required if specifying manually)",
      placeholder: "e.g.\nStatus → In Progress\nAssignee → John Smith",
      multiline: true,
      optional: true,
      initialValue: prefill.fieldDetails,
    }),
  );

  return {
    type: "modal",
    callback_id: CB_TICKET_SYNC_DETAILS,
    title: plainText("Ticket Sync Details"),
    submit: plainText("Create Ticket"),
    close: plainText("Cancel"),
    blocks,
  };
}

// ─── Snail Trail Retrieval ────────────────────────────────────────────────────

export interface SnailTrailPrefill {
  fdOption?: FdOption;
  fdReference?: FdReference;
  tenant?: string;
  dates?: string;
  trucks?: string;
  orders?: string;
  deliveryTickets?: string;
  notes?: string;
}

export function buildSnailTrailView(prefill: SnailTrailPrefill = {}) {
  const blocks: unknown[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "Pick the Freshdesk ticket first — it identifies the customer and shows their request inline.",
      },
    },
    fdSelectBlock({ optional: false, initialOption: prefill.fdOption }),
  ];
  if (prefill.fdReference) blocks.push(...fdReferenceBlocks(prefill.fdReference));
  blocks.push(
    divider(),
    textInputBlock({
      blockId: BLOCK_TENANT,
      actionId: ACTION_TENANT,
      label: "Tenant / Client",
      placeholder: "e.g. Madden Materials (Jarco)",
      initialValue: prefill.tenant,
      hint: "Auto-filled from the Freshdesk ticket — edit if needed.",
    }),
    textInputBlock({
      blockId: BLOCK_ST_DATES,
      actionId: ACTION_ST_DATES,
      label: "Date(s) requested",
      placeholder: "e.g. 1/13/26  •  or a range: 1/9–1/12",
      initialValue: prefill.dates,
    }),
    textInputBlock({
      blockId: BLOCK_ST_TRUCKS,
      actionId: ACTION_ST_TRUCKS,
      label: "Truck number(s)",
      placeholder: "e.g. 2950, 3672",
      initialValue: prefill.trucks,
    }),
    textInputBlock({
      blockId: BLOCK_ST_ORDERS,
      actionId: ACTION_ST_ORDERS,
      label: "Order number(s)",
      placeholder: "e.g. Order #15, Order #99",
      optional: true,
      initialValue: prefill.orders,
    }),
    textInputBlock({
      blockId: BLOCK_ST_DTICKETS,
      actionId: ACTION_ST_DTICKETS,
      label: "Delivery ticket number(s) / range",
      placeholder: "e.g. 806575 → 806600",
      optional: true,
      initialValue: prefill.deliveryTickets,
    }),
    textInputBlock({
      blockId: BLOCK_ST_NOTES,
      actionId: ACTION_ST_NOTES,
      label: "Additional context",
      placeholder: "Anything else that helps locate the data",
      multiline: true,
      optional: true,
      initialValue: prefill.notes,
    }),
  );

  return {
    type: "modal",
    callback_id: CB_SNAIL_TRAIL,
    title: plainText("Snail Trail Retrieval"),
    submit: plainText("Create Ticket"),
    close: plainText("Cancel"),
    blocks,
  };
}

// ─── Bug report form ──────────────────────────────────────────────────────────

export interface BugPrefill {
  fdOption?: FdOption;
  fdReference?: FdReference;
  bugTitle?: string;
  reproduced?: string;
  multiClient?: string;
  steps?: string;
  expected?: string;
}

export function buildBugReportView(prefill: BugPrefill = {}) {
  const blocks: unknown[] = [
    fdSelectBlock({ optional: true, initialOption: prefill.fdOption }),
  ];
  if (prefill.fdReference) blocks.push(...fdReferenceBlocks(prefill.fdReference));
  blocks.push(
    divider(),
    textInputBlock({
      blockId: BLOCK_BUG_TITLE,
      actionId: ACTION_BUG_TITLE,
      label: "Bug Title",
      placeholder: "Brief, clear title for this bug",
      initialValue: prefill.bugTitle,
    }),
    radioBlock({
      blockId: BLOCK_REPRODUCED,
      actionId: ACTION_REPRODUCED,
      label: "Reproduced internally?",
      options: [
        { text: "Yes", value: "yes" },
        { text: "No", value: "no" },
      ],
      initialValue: prefill.reproduced,
    }),
    radioBlock({
      blockId: BLOCK_MULTI_CLIENT,
      actionId: ACTION_MULTI_CLIENT,
      label: "Affecting multiple clients?",
      options: [
        { text: "Yes", value: "yes" },
        { text: "No", value: "no" },
        { text: "Unknown", value: "unknown" },
      ],
      initialValue: prefill.multiClient,
    }),
    textInputBlock({
      blockId: BLOCK_STEPS,
      actionId: ACTION_STEPS,
      label: "Steps to reproduce",
      placeholder: "1. Go to...\n2. Click on...\n3. See error",
      multiline: true,
      initialValue: prefill.steps,
    }),
    textInputBlock({
      blockId: BLOCK_EXPECTED,
      actionId: ACTION_EXPECTED,
      label: "Expected behavior",
      placeholder: "What should happen instead?",
      multiline: true,
      initialValue: prefill.expected,
    }),
  );

  return {
    type: "modal",
    callback_id: CB_BUG_REPORT,
    title: plainText("Bug Report"),
    submit: plainText("Create Ticket"),
    close: plainText("Cancel"),
    blocks,
  };
}
