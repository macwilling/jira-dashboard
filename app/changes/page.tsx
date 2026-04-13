"use client";

import { TicketBrowseShell } from "@/components/app-shell/TicketBrowseShell";
import { ChangesView } from "@/components/standup/ChangesView";
import { useTicketData } from "@/lib/ticket-data-context";

export default function ChangesPage() {
  const { tickets, teamMembers, standupTime, standupTimezone } = useTicketData();

  return (
    <TicketBrowseShell title="Changes">
      {({ onTicketSelect }) => (
        <main className="px-4 py-4">
          <ChangesView
            tickets={tickets}
            teamMembers={teamMembers}
            standupTime={standupTime}
            standupTimezone={standupTimezone}
            onTicketSelect={onTicketSelect}
          />
        </main>
      )}
    </TicketBrowseShell>
  );
}
