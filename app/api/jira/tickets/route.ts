import { NextResponse } from "next/server";
import {
  searchAllIssues,
  hasJiraCredentials,
  fetchActiveSprint,
  discoverSprintFieldId,
  discoverBoards,
  fetchEpicColors,
} from "@/lib/jira/client";
import { mapJiraIssue, extractTeamMembers, extractSprint } from "@/lib/jira/mappers";
import { getConfig } from "@/lib/config";

export async function GET() {
  if (!hasJiraCredentials()) {
    return NextResponse.json(
      { error: "Jira credentials not configured", configured: false },
      { status: 503 }
    );
  }

  const config = await getConfig();
  if (!config?.jqlFilter) {
    return NextResponse.json(
      { error: "JQL filter not configured", configured: false },
      { status: 503 }
    );
  }

  try {
    // Auto-discover sprint field if not configured
    let sprintFieldId = config.sprintFieldId;
    if (!sprintFieldId) {
      sprintFieldId = (await discoverSprintFieldId()) || undefined;
    }

    const issues = await searchAllIssues(config.jqlFilter, sprintFieldId);
    const l2Patterns = config.l2LabelPatterns || [];
    const tickets = issues.map((issue) => mapJiraIssue(issue, l2Patterns));

    // Fetch real epic colors from Jira Agile API
    const epicKeys = Array.from(new Set(tickets.filter((t) => t.epicKey).map((t) => t.epicKey!)));
    if (epicKeys.length > 0) {
      const epicColorMap = await fetchEpicColors(epicKeys);
      // Jira Agile API returns color keys like "color_1", map to hex
      const AGILE_COLORS: Record<string, string> = {
        color_1: "#7C3AED", // purple
        color_2: "#2563EB", // blue
        color_3: "#0891B2", // teal
        color_4: "#059669", // green
        color_5: "#D97706", // amber
        color_6: "#F59E0B", // yellow
        color_7: "#EA580C", // orange
        color_8: "#DC2626", // red
        color_9: "#DB2777", // pink
        color_10: "#4F46E5", // indigo
        color_11: "#6D28D9", // violet
        color_12: "#7C2D12", // brown
        color_13: "#0D9488", // cyan
        color_14: "#475569", // slate
      };
      for (const ticket of tickets) {
        if (ticket.epicKey && epicColorMap.has(ticket.epicKey)) {
          const colorKey = epicColorMap.get(ticket.epicKey)!;
          ticket.epicColor = AGILE_COLORS[colorKey] || colorKey;
        }
      }
    }

    const teamMembers = extractTeamMembers(issues);

    // Try extracting sprint from issue custom fields first
    let sprint = extractSprint(issues, sprintFieldId);

    // Fallback: use the Jira Agile board API
    if (!sprint) {
      const boardId = config.boardId;
      if (boardId) {
        // Use configured board ID
        const agileSprint = await fetchActiveSprint(boardId);
        if (agileSprint) {
          sprint = {
            name: agileSprint.name,
            startDate: agileSprint.startDate?.split("T")[0] || "",
            endDate: agileSprint.endDate?.split("T")[0] || "",
          };
        }
      } else {
        // Auto-discover: try all boards until we find an active sprint
        const boards = await discoverBoards();
        for (const board of boards) {
          const agileSprint = await fetchActiveSprint(String(board.id));
          if (agileSprint) {
            sprint = {
              name: agileSprint.name,
              startDate: agileSprint.startDate?.split("T")[0] || "",
              endDate: agileSprint.endDate?.split("T")[0] || "",
            };
            break;
          }
        }
      }
    }

    return NextResponse.json({
      tickets,
      teamMembers,
      sprint,
      configured: true,
      standupTime: config.standupTime || null,
      standupTimezone: config.standupTimezone || null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message, configured: true },
      { status: 500 }
    );
  }
}
