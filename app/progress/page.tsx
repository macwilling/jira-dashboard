"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import useSWR from "swr";
import { Search, Loader2, RefreshCw, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { TicketDrawer } from "@/components/TicketDrawer";
import { SearchBar } from "@/components/SearchBar";
import { AppShell } from "@/components/app-shell/AppShell";
import { FilterBar, ScopeFilter, GroupByOption } from "@/components/progress/FilterBar";
import { StoryCard } from "@/components/progress/StoryCard";
import { TaskChipBadge } from "@/components/progress/TaskChipBadge";
import { useTicketData } from "@/lib/ticket-data-context";
import { buildProgressData } from "@/lib/progress-utils";
import { isStale as isStaleUtil, cn } from "@/lib/utils";
import { getEpicColor } from "@/lib/utils";
import { Ticket, TicketStatus, TeamMember } from "@/lib/types";

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `API error ${res.status}`);
  }
  return res.json();
};

export default function ProgressPage() {
  const ctx = useTicketData();

  // --- Filter state ---
  const [scope, setScope] = useState<ScopeFilter>("sprint");
  const [groupBy, setGroupBy] = useState<GroupByOption>("none");
  const [selectedFixVersions, setSelectedFixVersions] = useState<Set<string>>(new Set());
  const [selectedEpics, setSelectedEpics] = useState<Set<string>>(new Set());
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());

  // --- Data fetching ---
  const { data: allOpenData, error: allOpenError, isLoading: allOpenLoading, mutate: allOpenMutate } = useSWR(
    scope === "all-open" ? "/api/jira/tickets?scope=all-open" : null,
    fetcher,
    { revalidateOnFocus: false, errorRetryCount: 2 }
  );

  const tickets: Ticket[] = scope === "all-open"
    ? (allOpenData?.tickets || [])
    : ctx.tickets;
  const teamMembers: TeamMember[] = scope === "all-open"
    ? (allOpenData?.teamMembers || ctx.teamMembers)
    : ctx.teamMembers;
  const isLoading = scope === "all-open" ? allOpenLoading : ctx.isLoading;
  const error = scope === "all-open" ? allOpenError?.message : ctx.error;

  // --- Refresh ---
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(() => {
    if (refreshing) return;
    setRefreshing(true);
    const minSpin = new Promise((r) => setTimeout(r, 600));
    const fetched = scope === "all-open" ? allOpenMutate() : ctx.refresh();
    Promise.all([minSpin, fetched]).finally(() => setRefreshing(false));
  }, [refreshing, scope, allOpenMutate, ctx]);

  // --- Derive filter options ---
  const fixVersionOptions = useMemo(() => {
    const versions = new Set<string>();
    for (const t of tickets) {
      for (const v of t.fixVersions) versions.add(v);
    }
    return [...versions].sort();
  }, [tickets]);

  const epicOptions = useMemo(() => {
    const epics = new Set<string>();
    for (const t of tickets) {
      if (t.epicName) epics.add(t.epicName);
    }
    return [...epics].sort();
  }, [tickets]);

  // --- Apply client-side filters ---
  const filteredTickets = useMemo(() => {
    let result = tickets;
    if (selectedFixVersions.size > 0) {
      result = result.filter((t) =>
        t.fixVersions.some((v) => selectedFixVersions.has(v))
      );
    }
    if (selectedEpics.size > 0) {
      result = result.filter((t) =>
        t.epicName !== null && selectedEpics.has(t.epicName)
      );
    }
    return result;
  }, [tickets, selectedFixVersions, selectedEpics]);

  // --- Build progress data ---
  const progressData = useMemo(
    () => buildProgressData(filteredTickets, isStaleUtil),
    [filteredTickets]
  );

  // --- Group stories for display ---
  const storyGroups = useMemo(() => {
    type StoryGroup = { label: string; color: string | null; stories: typeof progressData.stories };

    if (groupBy === "none") {
      return [{ label: "", color: null, stories: progressData.stories }] as StoryGroup[];
    }

    const map = new Map<string, typeof progressData.stories>();

    for (const story of progressData.stories) {
      let keys: string[];
      switch (groupBy) {
        case "epic":
          keys = [story.epicName || "No Epic"];
          break;
        case "fix-version":
          keys = story.fixVersions.length > 0 ? story.fixVersions : ["No Fix Version"];
          break;
        case "assignee": {
          const member = teamMembers.find((m) => m.id === story.ticket.assigneeId);
          keys = [member?.name || "Unassigned"];
          break;
        }
        default:
          keys = [""];
      }
      for (const key of keys) {
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(story);
      }
    }

    const groups: StoryGroup[] = [];
    for (const [label, stories] of map) {
      let color: string | null = null;
      if (groupBy === "epic") {
        color = stories[0]?.epicColor || null;
      }
      groups.push({ label, color, stories });
    }
    return groups;
  }, [progressData.stories, groupBy, teamMembers]);

  // --- Expand / collapse ---
  const toggleCard = useCallback((key: string) => {
    setExpandedCards((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const hasExpandableCards = progressData.stories.some((s) => s.tasks.length > 0);
  const allCardsExpanded = hasExpandableCards && progressData.stories
    .filter((s) => s.tasks.length > 0)
    .every((s) => expandedCards.has(s.ticket.key));

  const toggleExpandAll = useCallback(() => {
    if (allCardsExpanded) {
      setExpandedCards(new Set());
    } else {
      const allKeys = new Set(progressData.stories.filter((s) => s.tasks.length > 0).map((s) => s.ticket.key));
      setExpandedCards(allKeys);
    }
  }, [allCardsExpanded, progressData.stories]);

  // --- Ticket drawer state ---
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [ticketHistory, setTicketHistory] = useState<Ticket[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);

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

  const handleTaskChipClick = useCallback((key: string) => {
    // Try to find in sprint data first, then fetch
    const ticket = tickets.find((t) => t.key === key);
    if (ticket) {
      handleTicketSelect(ticket);
    } else {
      ctx.fetchTicket(key).then((t) => {
        if (t) handleTicketSelect(t);
      });
    }
  }, [tickets, handleTicketSelect, ctx]);

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

  const handleStatusChange = useCallback(
    (ticket: Ticket, status: TicketStatus) => {
      void ticket;
      void status;
    },
    []
  );

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

  const topbarActions = (
    <>
      <button
        onClick={() => setSearchOpen(true)}
        className="flex items-center gap-2 px-2.5 h-7 rounded-md border bg-muted/50 text-muted-foreground hover:bg-muted transition-colors w-full max-w-sm"
      >
        <Search className="h-3.5 w-3.5 shrink-0" />
        <span className="text-xs">Search tickets...</span>
        <kbd className="ml-auto text-[10px] bg-background px-1.5 py-0 rounded border font-mono">/</kbd>
      </button>
      <button
        onClick={handleRefresh}
        disabled={refreshing}
        className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50 shrink-0"
        title="Refresh tickets"
      >
        <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
      </button>
    </>
  );

  return (
    <AppShell title="Progress" actions={topbarActions}>
      {/* Filter bar */}
      <div className="sticky top-0 z-20 border-b bg-background px-4 py-2">
        <div className="max-w-5xl mx-auto flex items-center gap-2">
          <FilterBar
            scope={scope}
            onScopeChange={setScope}
            groupBy={groupBy}
            onGroupByChange={setGroupBy}
            fixVersionOptions={fixVersionOptions}
            selectedFixVersions={selectedFixVersions}
            onFixVersionsChange={setSelectedFixVersions}
            epicOptions={epicOptions}
            selectedEpics={selectedEpics}
            onEpicsChange={setSelectedEpics}
          />
          <button
            onClick={toggleExpandAll}
            className="ml-auto inline-flex items-center gap-1 px-2 py-1 h-7 rounded-md text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0"
            title={allCardsExpanded ? "Collapse all" : "Expand all"}
          >
            {allCardsExpanded ? (
              <ChevronsDownUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronsUpDown className="h-3.5 w-3.5" />
            )}
            <span className="hidden sm:inline">{allCardsExpanded ? "Collapse all" : "Expand all"}</span>
          </button>
        </div>
      </div>

      {/* Loading state */}
      {isLoading && tickets.length === 0 && (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading tickets...</span>
          </div>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="px-4 py-3">
          <div className="max-w-5xl mx-auto rounded-md border border-destructive/50 bg-destructive/5 p-3">
            <p className="text-sm text-destructive">Failed to load tickets: {error}</p>
          </div>
        </div>
      )}

      {/* Main content */}
      {(progressData.stories.length > 0 || progressData.orphanTasks.length > 0) && (
        <main className="flex-1 px-4 py-4">
          <div className="flex flex-col gap-2 max-w-5xl mx-auto">
            {storyGroups.map((group) => (
              <div key={group.label}>
                {/* Group header (hidden when groupBy=none) */}
                {group.label && (
                  <div className="flex items-center gap-2 px-1 pt-3 pb-1.5">
                    {groupBy === "epic" && (
                      <span
                        className="h-2.5 w-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: getEpicColor(group.label, group.color) }}
                      />
                    )}
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      {group.label}
                    </span>
                    <span className="text-xxs text-muted-foreground">
                      {group.stories.length} {group.stories.length === 1 ? "story" : "stories"}
                    </span>
                  </div>
                )}
                {/* Story cards */}
                <div className="flex flex-col gap-2">
                  {group.stories.map((card) => (
                    <StoryCard
                      key={card.ticket.key}
                      card={card}
                      expanded={expandedCards.has(card.ticket.key)}
                      onToggle={() => toggleCard(card.ticket.key)}
                      onTicketSelect={handleTicketSelect}
                      onTaskChipClick={handleTaskChipClick}
                    />
                  ))}
                </div>
              </div>
            ))}

            {/* Orphan tasks */}
            {progressData.orphanTasks.length > 0 && (
              <div>
                <div className="flex items-center gap-2 px-1 pt-3 pb-1.5">
                  <span className="h-2.5 w-2.5 rounded-full shrink-0 bg-slate-400" />
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Ungrouped Tasks
                  </span>
                  <span className="text-xxs text-muted-foreground">
                    {progressData.orphanTasks.length}
                  </span>
                </div>
                <div className="rounded-lg border bg-card px-4 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    {progressData.orphanTasks.map((chip) => (
                      <TaskChipBadge
                        key={chip.key}
                        chip={chip}
                        onClick={() => handleTaskChipClick(chip.key)}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>
      )}

      {/* Empty state */}
      {!isLoading && tickets.length > 0 && progressData.stories.length === 0 && progressData.orphanTasks.length === 0 && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-muted-foreground">No tickets match the current filters.</p>
        </div>
      )}

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
        onClose={() => { setSelectedTicket(null); setTicketHistory([]); }}
        onStatusChange={handleStatusChange}
        onTicketSelect={handleTicketSelect}
        ticketHistory={ticketHistory}
        onBack={handleTicketBack}
        onBreadcrumbNav={handleBreadcrumbNav}
      />
    </AppShell>
  );
}
