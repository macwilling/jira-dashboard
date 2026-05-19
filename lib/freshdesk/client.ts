export interface FreshdeskTicket {
  id: number;
  subject: string;
  status: number; // 2=Open 3=Pending 4=Resolved 5=Closed
  created_at: string;
}

/** A single ticket fetched by ID, enriched with the body text and company
 *  name. Used to pre-fill the Slack support modals from a chosen FD ticket. */
export interface FreshdeskTicketDetail extends FreshdeskTicket {
  descriptionText: string;
  companyName: string | null;
}

function getCredentials() {
  const domain = process.env.FRESHDESK_DOMAIN;
  const apiKey = process.env.FRESHDESK_API_KEY;
  if (!domain || !apiKey) return null;
  return {
    baseUrl: `https://${domain}.freshdesk.com/api/v2`,
    auth: Buffer.from(`${apiKey}:X`).toString("base64"),
  };
}

export function hasFreshdeskCredentials(): boolean {
  return getCredentials() !== null;
}

const FD_PAGE_SIZE = 100; // Freshdesk API maximum per page

export async function listRecentTickets(
  totalLimit = 100,
): Promise<FreshdeskTicket[]> {
  const creds = getCredentials();
  if (!creds) return [];

  const out: FreshdeskTicket[] = [];
  let page = 1;

  try {
    while (out.length < totalLimit) {
      const url = new URL(`${creds.baseUrl}/tickets`);
      url.searchParams.set("order_by", "created_at");
      url.searchParams.set("order_type", "desc");
      url.searchParams.set("per_page", String(FD_PAGE_SIZE));
      url.searchParams.set("page", String(page));

      const res = await fetch(url.toString(), {
        headers: {
          Authorization: `Basic ${creds.auth}`,
          "Content-Type": "application/json",
        },
        cache: "no-store",
      });

      if (!res.ok) {
        console.warn(`[freshdesk] listRecentTickets page ${page} failed: ${res.status}`);
        break;
      }

      const batch = (await res.json()) as FreshdeskTicket[];
      if (batch.length === 0) break;

      out.push(...batch);
      if (batch.length < FD_PAGE_SIZE) break; // last page
      page++;
    }
  } catch (e) {
    console.warn("[freshdesk] listRecentTickets error", e);
  }

  return out.slice(0, totalLimit);
}

export function freshdeskTicketUrl(domain: string, ticketId: number): string {
  return `https://${domain}.freshdesk.com/helpdesk/tickets/${ticketId}`;
}

async function fetchCompanyName(
  creds: { baseUrl: string; auth: string },
  companyId: number,
): Promise<string | null> {
  try {
    const res = await fetch(`${creds.baseUrl}/companies/${companyId}`, {
      headers: {
        Authorization: `Basic ${creds.auth}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const company = (await res.json()) as { name?: string };
    return company.name ?? null;
  } catch {
    return null;
  }
}

/**
 * Fetch a single ticket by ID, including its body text and company name.
 * Works for ANY ticket regardless of age — unlike `listRecentTickets`, this
 * is a direct lookup. Returns null if the ticket doesn't exist or FD is
 * unconfigured.
 */
export async function getTicket(
  id: number,
): Promise<FreshdeskTicketDetail | null> {
  const creds = getCredentials();
  if (!creds || !Number.isFinite(id)) return null;

  try {
    const url = new URL(`${creds.baseUrl}/tickets/${id}`);
    url.searchParams.set("include", "company");

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Basic ${creds.auth}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    if (!res.ok) {
      if (res.status !== 404) {
        console.warn(`[freshdesk] getTicket ${id} failed: ${res.status}`);
      }
      return null;
    }

    const t = (await res.json()) as {
      id: number;
      subject?: string;
      status: number;
      created_at: string;
      description_text?: string;
      company_id?: number;
      company?: { name?: string };
    };

    // `include=company` usually inlines the company; if not, fall back to a
    // direct company lookup so tenant auto-fill still works.
    let companyName = t.company?.name ?? null;
    if (!companyName && t.company_id) {
      companyName = await fetchCompanyName(creds, t.company_id);
    }

    return {
      id: t.id,
      subject: t.subject ?? "",
      status: t.status,
      created_at: t.created_at,
      descriptionText: t.description_text ?? "",
      companyName,
    };
  } catch (e) {
    console.warn(`[freshdesk] getTicket ${id} error`, e);
    return null;
  }
}

/**
 * Search tickets for the Slack external-select picker.
 *
 * Substring-matches the query against recent tickets' IDs and subjects, so a
 * partial number like "123" surfaces 1234, 12345, etc. A fully numeric query
 * is also looked up directly by ID, which reaches tickets too old to be in
 * the recent list. Best-effort — Freshdesk has no public free-text search.
 */
export async function searchTickets(
  query: string,
): Promise<FreshdeskTicket[]> {
  const q = query.trim();
  if (!q) return listRecentTickets(50);

  const recent = await listRecentTickets(100);
  const lc = q.toLowerCase();
  const matches = recent.filter(
    (t) => String(t.id).includes(q) || t.subject.toLowerCase().includes(lc),
  );

  // A fully numeric query may be the exact ID of a ticket too old to appear
  // in the recent list — fetch it directly and pin it to the top.
  if (/^\d+$/.test(q) && !matches.some((t) => String(t.id) === q)) {
    const exact = await getTicket(Number(q));
    if (exact) matches.unshift(exact);
  }

  return matches.slice(0, 50);
}
