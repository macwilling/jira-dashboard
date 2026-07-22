import type { Ticket, Comment } from "@/lib/types";
import type {
  Release,
  ReleaseCategory,
  Workflow,
  JiraVersionPayload,
} from "@/lib/releases/types";

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

// ─── Release-pipeline fixtures ─────────────────────────────────────────────

export function makeRelease(overrides: Partial<Release> = {}): Release {
  return {
    id: "10001",
    projectId: "1",
    name: "web@1.2.0",
    description: null,
    releaseDate: "2026-08-01",
    startDate: null,
    released: false,
    archived: false,
    deletedAt: null,
    jiraRaw: {},
    receivedAt: "2026-07-22T00:00:00.000Z",
    updatedAt: "2026-07-22T00:00:00.000Z",
    ignored: false,
    categoryId: null,
    resolutionRequired: false,
    resolutionReason: null,
    resolutionSnapshot: null,
    approvalStatus: "none",
    approvalVersion: 0,
    approvalMessageTs: null,
    approvalMessageChannel: null,
    approvedAt: null,
    approvedBy: null,
    ...overrides,
  };
}

export function makeCategory(overrides: Partial<ReleaseCategory> = {}): ReleaseCategory {
  return {
    id: "cat-1",
    key: "web-minor",
    platformPrefix: "web",
    releaseType: "minor",
    workflowId: "wf-1",
    createdAt: "2026-07-22T00:00:00.000Z",
    updatedAt: "2026-07-22T00:00:00.000Z",
    ...overrides,
  };
}

export function makeWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: "wf-1",
    name: "Web Minor Release",
    approvalSlackTarget: null,
    createdAt: "2026-07-22T00:00:00.000Z",
    updatedAt: "2026-07-22T00:00:00.000Z",
    ...overrides,
  };
}

export function makeVersionPayload(
  overrides: Partial<JiraVersionPayload> = {},
): JiraVersionPayload {
  return {
    id: "10001",
    name: "web@1.2.0",
    releaseDate: "2026-08-01",
    released: false,
    archived: false,
    projectId: 1,
    ...overrides,
  };
}
