"use client";

import { useCallback, useEffect, useState } from "react";
import { Search, RefreshCw } from "lucide-react";
import { AppShell } from "./AppShell";
import { SearchBar } from "@/components/SearchBar";
import { TicketDrawer } from "@/components/TicketDrawer";
import { useTicketData } from "@/lib/ticket-data-context";
import { Ticket } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Shell for pages that browse tickets from the shared TicketDataProvider.
 * Wires the command palette (/), refresh button, and the ticket drawer.
 * Used by /, /risks, /changes. Progress has its own concerns and uses AppShell directly.
 */
export function TicketBrowseShell({
  title,
  subtitle,
  extraActions,
  footer,
  children,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  extraActions?: React.ReactNode;
  footer?: React.ReactNode;
  children: (api: {
    onTicketSelect: (ticket: Ticket) => void;
  }) => React.ReactNode;
}) {
  const { tickets, teamMembers, refresh } = useTicketData();

  const [searchOpen, setSearchOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [ticketHistory, setTicketHistory] = useState<Ticket[]>([]);

  const handleRefresh = useCallback(() => {
    if (refreshing) return;
    setRefreshing(true);
    const minSpin = new Promise((r) => setTimeout(r, 600));
    const fetched = refresh();
    Promise.all([minSpin, fetched]).finally(() => setRefreshing(false));
  }, [refreshing, refresh]);

  const handleTicketSelect = useCallback((ticket: Ticket) => {
    setSelectedTicket((prev) => {
      if (prev && prev.key !== ticket.key) {
        setTicketHistory((h) => {
          if (h.length > 0 && h[h.length - 1].key === prev.key) return h;
          return [...h, prev];
        });
      }
      return ticket;
    });
  }, []);

  const handleTicketBack = useCallback(() => {
    setTicketHistory((h) => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1];
      setSelectedTicket(prev);
      return h.slice(0, -1);
    });
  }, []);

  const handleBreadcrumbNav = useCallback((index: number) => {
    setTicketHistory((h) => {
      const target = h[index];
      setSelectedTicket(target);
      return h.slice(0, index);
    });
  }, []);

  const handleStatusChange = useCallback(() => {}, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "/" && !e.ctrlKey && !e.metaKey) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const actions = (
    <>
      <button
        onClick={() => setSearchOpen(true)}
        className="flex items-center gap-2 px-2.5 h-7 rounded-md border bg-muted/50 text-muted-foreground hover:bg-muted transition-colors w-full max-w-sm"
      >
        <Search className="h-3.5 w-3.5 shrink-0" />
        <span className="text-xs">Search tickets...</span>
        <kbd className="ml-auto text-[10px] bg-background px-1.5 py-0 rounded border font-mono">
          /
        </kbd>
      </button>
      <button
        onClick={handleRefresh}
        disabled={refreshing}
        className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50 shrink-0"
        title="Refresh tickets"
        aria-label="Refresh tickets"
      >
        <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
      </button>
      {extraActions}
    </>
  );

  return (
    <AppShell title={title} subtitle={subtitle} actions={actions} footer={footer}>
      {children({ onTicketSelect: handleTicketSelect })}

      {searchOpen && (
        <SearchBar
          open={searchOpen}
          onOpenChange={setSearchOpen}
          tickets={tickets}
          onSelect={handleTicketSelect}
        />
      )}

      <TicketDrawer
        ticket={selectedTicket}
        teamMembers={teamMembers}
        allTickets={tickets}
        onClose={() => {
          setSelectedTicket(null);
          setTicketHistory([]);
        }}
        onStatusChange={handleStatusChange}
        onTicketSelect={handleTicketSelect}
        ticketHistory={ticketHistory}
        onBack={handleTicketBack}
        onBreadcrumbNav={handleBreadcrumbNav}
      />
    </AppShell>
  );
}
