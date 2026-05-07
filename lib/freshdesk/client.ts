export interface FreshdeskTicket {
  id: number;
  subject: string;
  status: number; // 2=Open 3=Pending 4=Resolved 5=Closed
  created_at: string;
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
