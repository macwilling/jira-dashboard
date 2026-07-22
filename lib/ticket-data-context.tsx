"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import useSWR from "swr";
import { Ticket, TeamMember, Sprint } from "./types";
import { isStale as isStaleUtil, isRecentlyChanged, getLastStandupTime } from "./utils";
import {
  teamMembers as mockTeamMembers,
  tickets as mockTickets,
  sprint as mockSprint,
} from "./mock-data";

interface TicketDataContextValue {
  tickets: Ticket[];
  teamMembers: TeamMember[];
  sprint: Sprint | null;
  isLoading: boolean;
  error: string | null;
  configured: boolean;
  findTicket: (key: string) => Ticket | undefined;
  fetchTicket: (key: string) => Promise<Ticket | undefined>;
  isStale: (ticket: Ticket) => boolean;
  isRecent: (ticket: Ticket) => boolean;
  standupTime: string | null;
  standupTimezone: string | null;
  refresh: () => void;
}

const TicketDataContext = createContext<TicketDataContextValue>({
  tickets: [],
  teamMembers: [],
  sprint: null,
  isLoading: false,
  error: null,
  configured: false,
  findTicket: () => undefined,
  fetchTicket: async () => undefined,
  isStale: isStaleUtil,
  isRecent: () => false,
  standupTime: null,
  standupTimezone: null,
  refresh: () => {},
});

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (body.configured === false) {
      return { tickets: [], teamMembers: [], sprint: null, configured: false };
    }
    throw new Error(body.error || `API error ${res.status}`);
  }
  return res.json();
};

export function TicketDataProvider({ children }: { children: React.ReactNode }) {
  // The wallboard is a full-screen TV dashboard that owns its own refresh
  // cadence: it runs a 60s poll on this same "/api/jira/tickets" cache key
  // (plus GitHub/Datadog polls) while it is on screen. To guarantee that the
  // wallboard is the *only* thing polling while it is being viewed, the
  // provider stops its own generic 5-min poll on that route. Ticket data still
  // stays fresh there because SWR shares the cache key — the wallboard's poll
  // updates the same entry this provider reads. Every other route keeps the
  // normal 5-min background poll.
  const onWallboard = usePathname() === "/wallboard";
  const { data, error, isLoading, mutate } = useSWR("/api/jira/tickets", fetcher, {
    revalidateOnFocus: false,
    refreshInterval: onWallboard ? 0 : 300_000, // 0 = no poll; 5 min otherwise
    errorRetryCount: 2,
  });

  const configured = data?.configured !== false;
  const hasData = data?.tickets && data.tickets.length > 0;

  // Use real data if available, mock data if not configured
  const tickets: Ticket[] = hasData ? data.tickets : configured ? [] : mockTickets;
  const teamMembers: TeamMember[] = hasData
    ? data.teamMembers
    : configured
    ? []
    : mockTeamMembers;
  const sprint: Sprint | null = hasData ? data.sprint : configured ? null : mockSprint;

  const ticketMap = useMemo(() => {
    const map = new Map<string, Ticket>();
    for (const t of tickets) {
      map.set(t.key, t);
    }
    return map;
  }, [tickets]);

  // Cache for externally fetched tickets (outside JQL filter)
  const [externalCache, setExternalCache] = useState<Map<string, Ticket>>(new Map());
  const inflightRef = useRef<Map<string, Promise<Ticket | undefined>>>(new Map());

  const findTicket = useCallback(
    (key: string) => ticketMap.get(key) || externalCache.get(key),
    [ticketMap, externalCache]
  );

  const fetchTicket = useCallback(
    async (key: string): Promise<Ticket | undefined> => {
      // Check local first
      const local = ticketMap.get(key) || externalCache.get(key);
      if (local) return local;

      // Check inflight
      const inflight = inflightRef.current.get(key);
      if (inflight) return inflight;

      // Fetch from Jira
      const promise = fetch(`/api/jira/issues?keys=${encodeURIComponent(key)}`)
        .then((r) => r.json())
        .then((data) => {
          const ticket = data.tickets?.[0] as Ticket | undefined;
          if (ticket) {
            setExternalCache((prev) => {
              const next = new Map(prev);
              next.set(key, ticket);
              return next;
            });
          }
          inflightRef.current.delete(key);
          return ticket;
        })
        .catch(() => {
          inflightRef.current.delete(key);
          return undefined;
        });

      inflightRef.current.set(key, promise);
      return promise;
    },
    [ticketMap, externalCache]
  );

  const standupTime: string | null = data?.standupTime || null;
  const standupTimezone: string | null = data?.standupTimezone || null;

  const recentSince = useMemo(
    () => getLastStandupTime(standupTime, standupTimezone),
    [standupTime, standupTimezone]
  );
  const isRecent = useCallback(
    (ticket: Ticket) => isRecentlyChanged(ticket, recentSince),
    [recentSince]
  );

  const value = useMemo<TicketDataContextValue>(
    () => ({
      tickets,
      teamMembers,
      sprint,
      isLoading,
      error: error?.message || null,
      configured,
      findTicket,
      fetchTicket,
      isStale: isStaleUtil,
      isRecent,
      standupTime,
      standupTimezone,
      refresh: () => mutate(),
    }),
    [tickets, teamMembers, sprint, isLoading, error, configured, findTicket, fetchTicket, isRecent, mutate]
  );

  return (
    <TicketDataContext.Provider value={value}>
      {children}
    </TicketDataContext.Provider>
  );
}

export function useTicketData() {
  return useContext(TicketDataContext);
}
