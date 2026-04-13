"use client";

import { TicketBrowseShell } from "@/components/app-shell/TicketBrowseShell";
import { RisksView } from "@/components/standup/RisksView";
import { useTicketData } from "@/lib/ticket-data-context";

export default function RisksPage() {
  const { tickets, teamMembers, isStale } = useTicketData();

  return (
    <TicketBrowseShell title="Risks">
      {({ onTicketSelect }) => (
        <main className="px-4 py-4">
          <RisksView
            tickets={tickets}
            teamMembers={teamMembers}
            isStale={isStale}
            onTicketSelect={onTicketSelect}
          />
        </main>
      )}
    </TicketBrowseShell>
  );
}
