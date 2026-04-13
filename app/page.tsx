"use client";

import { useCallback, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { TeamCard } from "@/components/TeamCard";
import { SetupBanner } from "@/components/SetupBanner";
import { SprintProgressBar } from "@/components/SprintProgressBar";
import { TicketBrowseShell } from "@/components/app-shell/TicketBrowseShell";
import { useTicketData } from "@/lib/ticket-data-context";
import { TeamMemberWithTickets } from "@/lib/types";

export default function Home() {
  const {
    tickets,
    teamMembers,
    sprint,
    isLoading,
    error,
    configured,
    isStale,
  } = useTicketData();

  const [expandedMembers, setExpandedMembers] = useState<Set<string>>(new Set());

  const membersWithTickets: TeamMemberWithTickets[] = useMemo(() => {
    return teamMembers
      .map((member) => {
        const memberTickets = tickets.filter((t) => t.assigneeId === member.id);
        const sprintTickets = memberTickets.filter((t) => !t.isL2);
        const l2Tickets = memberTickets.filter((t) => t.isL2);
        const staleCount = memberTickets.filter((t) => isStale(t)).length;
        return { ...member, sprintTickets, l2Tickets, staleCount };
      })
      .filter((member) => member.sprintTickets.length + member.l2Tickets.length > 0);
  }, [teamMembers, tickets, isStale]);

  const toggleMember = useCallback((id: string) => {
    setExpandedMembers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const footer =
    tickets.length > 0 ? (
      <footer className="border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-4">
        <div className="max-w-5xl mx-auto">
          <SprintProgressBar
            sprintTickets={tickets.filter((t) => !t.isL2)}
            sprint={sprint}
          />
        </div>
      </footer>
    ) : undefined;

  return (
    <TicketBrowseShell title="Standup" footer={footer}>
      {({ onTicketSelect }) => (
        <>
          {!configured && <SetupBanner />}

          {isLoading && tickets.length === 0 && (
            <div className="flex-1 flex items-center justify-center py-20">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Loading tickets...</span>
              </div>
            </div>
          )}

          {error && configured && (
            <div className="px-4 py-3">
              <div className="max-w-5xl mx-auto rounded-md border border-destructive/50 bg-destructive/5 p-3">
                <p className="text-sm text-destructive">
                  Failed to load tickets: {error}
                </p>
              </div>
            </div>
          )}

          {tickets.length > 0 && (
            <main className="px-4 py-3">
              <div className="flex flex-col max-w-5xl mx-auto">
                {membersWithTickets.map((member) => (
                  <TeamCard
                    key={member.id}
                    member={member}
                    isExpanded={expandedMembers.has(member.id)}
                    onToggle={() => toggleMember(member.id)}
                    onTicketSelect={onTicketSelect}
                  />
                ))}
              </div>
            </main>
          )}
        </>
      )}
    </TicketBrowseShell>
  );
}
