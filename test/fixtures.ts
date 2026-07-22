import type { Ticket, Comment } from "@/lib/types";

/**
 * Builds a valid Ticket for tests. Every field has a sensible default so a
 * test only has to specify the fields it actually cares about.
 */
export function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    key: "PROJ-1",
    summary: "Do the thing",
    status: "In Progress",
    statusCategory: "indeterminate",
    priority: "Medium",
    type: "Story",
    assigneeId: "user-1",
    parentKey: null,
    epicKey: null,
    epicName: null,
    epicColor: null,
    labels: [],
    fixVersions: [],
    description: "",
    lastActivityDate: "2026-07-22T00:00:00.000Z",
    isL2: false,
    inSprint: true,
    comments: [],
    links: [],
    ...overrides,
  };
}

export function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: "c-1",
    authorId: "user-1",
    body: "a comment",
    createdAt: "2026-07-22T00:00:00.000Z",
    ...overrides,
  };
}
