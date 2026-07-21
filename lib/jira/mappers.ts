import {
  Ticket,
  TicketPriority,
  TicketType,
  TeamMember,
  Comment,
  TicketLinkDef,
  LinkType,
  Sprint,
  ChangelogEntry,
} from "@/lib/types";
import { JiraIssue, JiraIssueLink, JiraAdfNode, JiraComment, JiraSprint, JiraChangelogHistory } from "./types";

// --- Status mapping ---
// We pass through the real Jira status name and use statusCategory for color coding

import { StatusCategory } from "@/lib/types";

export function mapJiraStatusCategory(categoryKey: string): StatusCategory {
  if (categoryKey === "done") return "done";
  if (categoryKey === "indeterminate") return "indeterminate";
  return "new";
}

// --- Priority mapping ---

const PRIORITY_MAP: Record<string, TicketPriority> = {
  "highest": "Highest",
  "blocker": "Highest",
  "critical": "Highest",
  "high": "High",
  "major": "High",
  "medium": "Medium",
  "normal": "Medium",
  "low": "Low",
  "minor": "Low",
  "trivial": "Low",
  "lowest": "Low",
};

export function mapJiraPriority(jiraPriority: string): TicketPriority {
  const normalized = jiraPriority.toLowerCase().trim();
  return PRIORITY_MAP[normalized] ?? "Medium";
}

// --- Issue type mapping ---

const TYPE_MAP: Record<string, TicketType> = {
  "story": "Story",
  "task": "Task",
  "sub-task": "Subtask",
  "subtask": "Subtask",
  "bug": "Bug",
  "support": "Support",
  "service request": "Support",
  "incident": "Support",
  "epic": "Epic",
};

export function mapJiraType(jiraType: string): TicketType {
  const normalized = jiraType.toLowerCase().trim();
  return TYPE_MAP[normalized] ?? "Task";
}

// --- ADF to Markdown ---

// Maps both attachment ID and filename to attachment info for flexible matching
export type AttachmentMap = Map<string, { url: string; filename: string; mimeType: string }>;

interface AdfContext {
  listType?: "bullet" | "ordered";
  listIndex?: number;
  listDepth: number;
}

export function adfToMarkdown(node: JiraAdfNode | null, attachments?: AttachmentMap, ctx?: AdfContext): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  const context = ctx || { listDepth: 0 };

  if (node.type === "text") {
    let text = node.text || "";
    if (node.marks) {
      for (const mark of node.marks) {
        if (mark.type === "strong") text = `<strong>${text}</strong>`;
        if (mark.type === "em") text = `<em>${text}</em>`;
        if (mark.type === "code") text = `\`${text}\``;
        if (mark.type === "strike") text = `~~${text}~~`;
        if (mark.type === "link" && mark.attrs?.href) {
          text = `[${text}](${mark.attrs.href})`;
        }
        if (mark.type === "underline") text = `<u>${text}</u>`;
        if (mark.type === "textColor") text = text; // ignore color, just keep text
        if (mark.type === "subsup") text = text; // ignore sub/sup
      }
    }
    return text;
  }

  switch (node.type) {
    case "doc": {
      const children = (node.content || []).map((c) => adfToMarkdown(c, attachments, context)).join("");
      return children;
    }
    case "paragraph": {
      const children = (node.content || []).map((c) => adfToMarkdown(c, attachments, context)).join("");
      // Inside a list item, don't add double newlines
      if (context.listDepth > 0) return children;
      return children + "\n\n";
    }
    case "heading": {
      const children = (node.content || []).map((c) => adfToMarkdown(c, attachments, context)).join("");
      const level = (node.attrs?.level as number) || 1;
      return "#".repeat(level) + " " + children + "\n\n";
    }
    case "bulletList": {
      const items = (node.content || []).map((c, i) =>
        adfToMarkdown(c, attachments, { listType: "bullet", listIndex: i, listDepth: context.listDepth + 1 })
      ).join("");
      // If nested inside a listItem, add newline before but no trailing blank line
      return (context.listDepth > 0 ? "\n" : "") + items + (context.listDepth === 0 ? "\n" : "");
    }
    case "orderedList": {
      const items = (node.content || []).map((c, i) =>
        adfToMarkdown(c, attachments, { listType: "ordered", listIndex: i, listDepth: context.listDepth + 1 })
      ).join("");
      return (context.listDepth > 0 ? "\n" : "") + items + (context.listDepth === 0 ? "\n" : "");
    }
    case "listItem": {
      // Use 4 spaces per depth level (standard markdown nesting)
      const indent = "    ".repeat(Math.max(0, context.listDepth - 1));
      const marker = context.listType === "ordered" ? `${(context.listIndex ?? 0) + 1}. ` : "- ";
      // Process children but pass a fresh context so nested lists get their own depth tracking
      const childParts: string[] = [];
      for (const child of (node.content || [])) {
        if (child.type === "bulletList" || child.type === "orderedList") {
          // Nested list — process with current depth so it indents further
          childParts.push(adfToMarkdown(child, attachments, context));
        } else {
          // Paragraph or inline content inside the list item
          childParts.push(adfToMarkdown(child, attachments, { ...context, listDepth: context.listDepth }));
        }
      }
      const content = childParts.join("").replace(/\n$/, "");
      return indent + marker + content + "\n";
    }
    case "codeBlock": {
      const codeChildren = (node.content || []).map((c) => adfToMarkdown(c, attachments, context)).join("");
      const lang = (node.attrs?.language as string) || "";
      return "```" + lang + "\n" + codeChildren + "\n```\n\n";
    }
    case "blockquote": {
      const bqChildren = (node.content || []).map((c) => adfToMarkdown(c, attachments, context)).join("");
      return bqChildren
        .split("\n")
        .filter((l) => l.trim())
        .map((line) => "> " + line)
        .join("\n") + "\n\n";
    }
    case "rule":
      return "---\n\n";
    case "hardBreak":
      // Two trailing spaces + newline = markdown line break
      return "  \n";
    case "mention":
      return `**@${node.attrs?.text || "user"}**`;
    case "inlineCard":
      return node.attrs?.url ? `[link](${node.attrs.url})` : "";
    case "emoji":
      return (node.attrs?.shortName as string) || (node.attrs?.text as string) || "";
    case "table":
      return adfTableToMarkdown(node, attachments) + "\n\n";
    case "tableRow":
    case "tableHeader":
    case "tableCell": {
      const tChildren = (node.content || []).map((c) => adfToMarkdown(c, attachments, context)).join("");
      return tChildren;
    }
    case "mediaGroup":
    case "mediaSingle": {
      const mediaChildren = (node.content || []).map((c) => adfToMarkdown(c, attachments, context)).join("");
      return mediaChildren + "\n\n";
    }
    case "media": {
      const mediaId = node.attrs?.id as string;
      const mediaAlt = node.attrs?.alt as string;
      const att = (mediaId && attachments?.get(mediaId))
        || (mediaAlt && attachments?.get(mediaAlt))
        || null;
      if (att && att.mimeType.startsWith("image/")) {
        const proxyUrl = `/api/jira/attachment?url=${encodeURIComponent(att.url)}`;
        return `![${att.filename}](${proxyUrl})`;
      }
      if (att) {
        return `*[${att.filename}]*`;
      }
      return "*[attachment]*";
    }
    case "panel": {
      const panelChildren = (node.content || []).map((c) => adfToMarkdown(c, attachments, context)).join("");
      const panelType = (node.attrs?.panelType as string) || "info";
      // Use HTML div with data attribute so rehype-raw preserves it and our custom renderer picks it up
      return `<div data-panel="${panelType}">\n\n${panelChildren.trim()}\n\n</div>\n\n`;
    }
    case "status":
      return `\`${node.attrs?.text || "status"}\``;
    case "date":
      return node.attrs?.timestamp
        ? new Date(Number(node.attrs.timestamp)).toLocaleDateString()
        : "";
    default: {
      const defaultChildren = (node.content || []).map((c) => adfToMarkdown(c, attachments, context)).join("");
      return defaultChildren;
    }
  }
}

function adfTableToMarkdown(tableNode: JiraAdfNode, attachments?: AttachmentMap): string {
  const rows = tableNode.content || [];
  if (rows.length === 0) return "";

  const result: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const cells = (row.content || []).map((cell) => {
      const cellText = (cell.content || [])
        .map((c) => adfToMarkdown(c, attachments))
        .join("")
        .replace(/\n+/g, " ")
        .trim();
      return cellText || " ";
    });
    result.push("| " + cells.join(" | ") + " |");
    // Add header separator after first row
    if (i === 0) {
      result.push("| " + cells.map(() => "---").join(" | ") + " |");
    }
  }
  return result.join("\n");
}

// --- Issue links mapping ---

const LINK_TYPE_MAP: Record<string, LinkType> = {
  "blocks": "blocks",
  "is blocked by": "blocked by",
  "relates to": "relates to",
  "is cloned by": "relates to",
  "clones": "relates to",
  "duplicates": "duplicates",
  "is duplicated by": "duplicates",
};

function mapLinkType(description: string): LinkType {
  const normalized = description.toLowerCase().trim();
  return LINK_TYPE_MAP[normalized] ?? "relates to";
}

export function mapIssueLinks(links: JiraIssueLink[]): TicketLinkDef[] {
  const result: TicketLinkDef[] = [];

  for (const link of links) {
    if (link.outwardIssue) {
      const f = link.outwardIssue.fields;
      result.push({
        targetKey: link.outwardIssue.key,
        type: mapLinkType(link.type.outward),
        rawDescription: link.type.outward,
        targetType: f.issuetype ? mapJiraType(f.issuetype.name) : undefined,
        targetSummary: f.summary,
        targetStatus: f.status.name,
        targetStatusCategory: mapJiraStatusCategory(f.status.statusCategory?.key || "new"),
      });
    }
    if (link.inwardIssue) {
      const f = link.inwardIssue.fields;
      result.push({
        targetKey: link.inwardIssue.key,
        type: mapLinkType(link.type.inward),
        rawDescription: link.type.inward,
        targetType: f.issuetype ? mapJiraType(f.issuetype.name) : undefined,
        targetSummary: f.summary,
        targetStatus: f.status.name,
        targetStatusCategory: mapJiraStatusCategory(f.status.statusCategory?.key || "new"),
      });
    }
  }

  return result;
}

// --- Comments mapping ---

function mapComment(comment: JiraComment, attachments?: AttachmentMap): Comment {
  return {
    id: comment.id,
    authorId: comment.author.accountId,
    body: adfToMarkdown(comment.body, attachments).trim(),
    createdAt: comment.created,
  };
}

// --- Epic color palette (Jira uses color names) ---

const EPIC_COLORS: Record<string, string> = {
  "purple": "#7C3AED",
  "blue": "#2563EB",
  "green": "#059669",
  "teal": "#0891B2",
  "yellow": "#F59E0B",
  "orange": "#EA580C",
  "red": "#DC2626",
  "pink": "#DB2777",
  "dark_purple": "#4F46E5",
  "dark_blue": "#1D4ED8",
  "dark_green": "#047857",
  "dark_teal": "#0E7490",
  "dark_yellow": "#D97706",
  "dark_orange": "#C2410C",
  "dark_red": "#B91C1C",
  "dark_pink": "#BE185D",
};

// --- Changelog mapping ---

const CHANGELOG_NOISE_FIELDS = new Set([
  "Rank",
  "RemoteIssueLink",
  "Workflow",
  "timespent",
  "timeestimate",
  "timeoriginalestimate",
  "WorklogId",
  "aggregatetimespent",
  "aggregatetimeestimate",
  "aggregatetimeoriginalestimate",
  "aggregateprogress",
  "progress",
]);

const FIELD_DISPLAY_NAMES: Record<string, string> = {
  status: "Status",
  assignee: "Assignee",
  priority: "Priority",
  summary: "Summary",
  description: "Description",
  labels: "Labels",
  resolution: "Resolution",
  issuetype: "Type",
  "Fix Version": "Fix Version",
  "Component": "Component",
  "Story Points": "Story Points",
  "customfield_10014": "Epic Link",
  "Sprint": "Sprint",
  "Link": "Link",
  "IssueParentAssociation": "Parent",
  "Parent": "Parent",
};

function prettifyFieldName(field: string): string {
  if (FIELD_DISPLAY_NAMES[field]) return FIELD_DISPLAY_NAMES[field];
  // Strip "customfield_" prefix and capitalize
  if (field.startsWith("customfield_")) return field;
  return field.charAt(0).toUpperCase() + field.slice(1).replace(/_/g, " ");
}

export function mapChangelog(histories: JiraChangelogHistory[]): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];

  for (const history of histories) {
    const filteredItems = history.items.filter(
      (item) => !CHANGELOG_NOISE_FIELDS.has(item.field)
    );
    if (filteredItems.length === 0) continue;

    entries.push({
      id: history.id,
      authorName: history.author.displayName,
      authorAvatarUrl: history.author.avatarUrls["24x24"],
      created: history.created,
      changes: filteredItems.map((item) => ({
        field: prettifyFieldName(item.field),
        from: item.fromString,
        to: item.toString,
      })),
    });
  }

  // Sort newest first and limit
  entries.sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime());
  return entries.slice(0, 20);
}

// --- Full issue mapping ---

export function mapJiraIssue(
  issue: JiraIssue,
  l2Patterns: string[],
  sprintFieldId?: string
): Ticket {
  const fields = issue.fields;

  // Sprint membership: with the dashboard JQL, L2 tickets ride along only
  // when their sprint field is EMPTY, so a non-empty sprint field means the
  // ticket is genuinely in the (open) sprint.
  const sprintFieldKey = sprintFieldId || "customfield_10020";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sprintValue = ((fields as any)[sprintFieldKey] ??
    fields.customfield_10020) as unknown[] | null | undefined;
  const inSprint = Array.isArray(sprintValue) && sprintValue.length > 0;
  const l2PatternsLower = l2Patterns.map((p) => p.toLowerCase());
  const isL2 = fields.labels.some((label) =>
    l2PatternsLower.includes(label.toLowerCase())
  );

  // Epic: try parent (next-gen) first, then customfield_10014 (classic)
  let epicKey: string | null = null;
  let epicName: string | null = null;
  let epicColor: string | null = null;

  let parentKey: string | null = null;
  if (fields.parent && fields.parent.fields.issuetype.name === "Epic") {
    epicKey = fields.parent.key;
    epicName = fields.parent.fields.summary;
  } else if (fields.parent) {
    // Non-Epic parent = this is a subtask of a story/task/bug
    parentKey = fields.parent.key;
  }
  if (!epicName && fields.customfield_10014) {
    epicName = fields.customfield_10014;
  }

  if (fields.customfield_10011) {
    // Only use customfield_10011 if it's a recognized color name (not Jira internal metadata)
    const mapped = EPIC_COLORS[fields.customfield_10011];
    if (mapped) epicColor = mapped;
  }

  // Build attachment map — index by both numeric ID and filename for flexible matching
  // Jira ADF media nodes use a UUID as id, but attachments use numeric IDs.
  // The media node's alt attr matches the attachment filename.
  const attachmentMap: AttachmentMap = new Map();
  for (const att of fields.attachment || []) {
    const entry = { url: att.content, filename: att.filename, mimeType: att.mimeType };
    attachmentMap.set(att.id, entry);
    attachmentMap.set(att.filename, entry);
  }

  return {
    key: issue.key,
    summary: fields.summary,
    status: fields.status.name,
    statusCategory: mapJiraStatusCategory(fields.status.statusCategory?.key || "new"),
    priority: mapJiraPriority(fields.priority?.name || "Medium"),
    type: mapJiraType(fields.issuetype.name),
    assigneeId: fields.assignee?.accountId || "unassigned",
    parentKey,
    epicKey,
    epicName,
    epicColor,
    labels: fields.labels,
    fixVersions: (fields.fixVersions || []).map((v) => v.name),
    description: adfToMarkdown(fields.description, attachmentMap),
    lastActivityDate: fields.updated,
    isL2,
    inSprint,
    comments: (fields.comment?.comments || []).map((c) => mapComment(c, attachmentMap)),
    links: mapIssueLinks(fields.issuelinks || []),
  };
}

// --- Extract team members from issues ---

export function extractTeamMembers(issues: JiraIssue[]): TeamMember[] {
  const seen = new Map<string, TeamMember>();

  for (const issue of issues) {
    const assignee = issue.fields.assignee;
    if (assignee && !seen.has(assignee.accountId)) {
      seen.set(assignee.accountId, {
        id: assignee.accountId,
        name: assignee.displayName,
        avatarUrl: assignee.avatarUrls["48x48"],
      });
    }

    // Also include comment authors
    for (const comment of issue.fields.comment?.comments || []) {
      const author = comment.author;
      if (!seen.has(author.accountId)) {
        seen.set(author.accountId, {
          id: author.accountId,
          name: author.displayName,
          avatarUrl: author.avatarUrls["48x48"],
        });
      }
    }
  }

  return Array.from(seen.values());
}

// --- Extract sprint from issues ---

export function extractSprint(
  issues: JiraIssue[],
  sprintFieldId?: string
): Sprint | null {
  const fieldKey = sprintFieldId || "customfield_10020";

  for (const issue of issues) {
    // Try the configured/default sprint field
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sprints = (issue.fields as any)[fieldKey] as JiraSprint[] | null | undefined;
    if (sprints && Array.isArray(sprints) && sprints.length > 0) {
      const active = sprints.find((s) => s.state === "active") || sprints[0];
      return {
        name: active.name,
        startDate: active.startDate?.split("T")[0] || "",
        endDate: active.endDate?.split("T")[0] || "",
      };
    }

    // Fallback: also check the hardcoded customfield_10020 in case the
    // configured field ID is different but the default is populated
    if (fieldKey !== "customfield_10020") {
      const fallbackSprints = issue.fields.customfield_10020;
      if (fallbackSprints && fallbackSprints.length > 0) {
        const active = fallbackSprints.find((s) => s.state === "active") || fallbackSprints[0];
        return {
          name: active.name,
          startDate: active.startDate?.split("T")[0] || "",
          endDate: active.endDate?.split("T")[0] || "",
        };
      }
    }
  }
  return null;
}
