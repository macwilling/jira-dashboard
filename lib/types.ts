export type TicketStatus = string;
export type StatusCategory = "new" | "indeterminate" | "done";
export type TicketPriority = "Highest" | "High" | "Medium" | "Low";
export type TicketType = "Story" | "Task" | "Subtask" | "Bug" | "Support" | "Epic";

export interface TeamMember {
  id: string;
  name: string;
  avatarUrl: string;
}

export interface Comment {
  id: string;
  authorId: string;
  body: string;
  createdAt: string;
}

export type LinkType = "blocks" | "blocked by" | "relates to" | "duplicates";

export interface TicketLinkDef {
  targetKey: string;
  type: LinkType;
  rawDescription: string;
  targetType?: TicketType;
  targetSummary?: string;
  targetStatus?: string;
  targetStatusCategory?: StatusCategory;
}

export interface Ticket {
  key: string;
  summary: string;
  status: TicketStatus;
  statusCategory: StatusCategory;
  priority: TicketPriority;
  type: TicketType;
  assigneeId: string;
  /** Parent issue key for subtasks (non-Epic parent), used to group work by story. */
  parentKey?: string | null;
  epicKey: string | null;
  epicName: string | null;
  epicColor: string | null;
  labels: string[];
  fixVersions: string[];
  description: string;
  lastActivityDate: string;
  isL2: boolean;
  /** True when the ticket's sprint field is non-empty (i.e. it's on the sprint board). */
  inSprint?: boolean;
  comments: Comment[];
  links: TicketLinkDef[];
}

export interface Sprint {
  name: string;
  startDate: string;
  endDate: string;
}

export interface ChangelogEntry {
  id: string;
  authorName: string;
  authorAccountId: string;
  authorAvatarUrl: string;
  created: string;
  changes: {
    field: string;
    from: string | null;
    to: string | null;
  }[];
}

export interface TeamMemberWithTickets extends TeamMember {
  sprintTickets: Ticket[];
  l2Tickets: Ticket[];
  staleCount: number;
}
