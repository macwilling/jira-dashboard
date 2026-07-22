import type {
  ReadAiSpeakerBlock,
  ReadAiWebhookPayload,
} from "@/lib/readai/types";

/**
 * Deterministic meeting-note + transcript builders for the Read AI bridge.
 * Everything template-shaped happens here in code; the enrichment routine
 * only fills the marker-delimited blocks (see ENRICH_SECTIONS) afterwards
 * via /api/readai/enrich.
 */

// ─── Enrichment markers ────────────────────────────────────────────────────────

export const ENRICH_SECTIONS = ["decisions", "actionitems", "related"] as const;
export type EnrichSection = (typeof ENRICH_SECTIONS)[number];

function markerStart(section: EnrichSection): string {
  return `<!-- enrich:${section}:start -->`;
}
function markerEnd(section: EnrichSection): string {
  return `<!-- enrich:${section}:end -->`;
}

function enrichBlock(section: EnrichSection, initial: string): string {
  return `${markerStart(section)}\n${initial}\n${markerEnd(section)}`;
}

/**
 * Replaces the content between a section's enrichment markers (markers stay
 * in place so the block can be re-patched). Returns null if the markers are
 * missing — e.g. the note was hand-edited past recognition.
 */
export function patchEnrichSection(
  content: string,
  section: EnrichSection,
  replacement: string,
): string | null {
  const start = markerStart(section);
  const end = markerEnd(section);
  const startIdx = content.indexOf(start);
  const endIdx = content.indexOf(end);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) return null;
  return (
    content.slice(0, startIdx + start.length) +
    `\n${replacement.trim()}\n` +
    content.slice(endIdx)
  );
}

// ─── Naming ────────────────────────────────────────────────────────────────────

/** Strip characters that break filenames or Obsidian wikilink targets. */
function sanitizeTitle(title: string): string {
  return title
    .replace(/[/\\:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function meetingDate(payload: ReadAiWebhookPayload): string {
  return payload.start_time.slice(0, 10); // YYYY-MM-DD
}

/** "2026-07-21 Sprint Planning" — no extension; used for filenames and wikilinks. */
export function noteBaseName(payload: ReadAiWebhookPayload): string {
  return `${meetingDate(payload)} ${sanitizeTitle(payload.title)}`;
}

export function transcriptBaseName(payload: ReadAiWebhookPayload): string {
  return `${noteBaseName(payload)} (transcript)`;
}

// ─── Text helpers ──────────────────────────────────────────────────────────────

/** Linkify Jira issue keys (e.g. IST-1234) against the configured Jira URL. */
export function linkifyJiraKeys(text: string): string {
  const base = (
    process.env.NEXT_PUBLIC_JIRA_URL ??
    process.env.JIRA_URL ??
    ""
  ).replace(/\/$/, "");
  if (!base) return text;
  return text.replace(
    /(^|[^[\w/])([A-Z][A-Z0-9]{1,9}-\d+)\b/g,
    (_m, pre: string, key: string) => `${pre}[${key}](${base}/browse/${key})`,
  );
}

function formatClock(msString: string): string {
  const ms = Number(msString);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toISOString().slice(11, 19); // HH:MM:SS UTC
}

function formatSpeakerBlock(block: ReadAiSpeakerBlock): string {
  const clock = formatClock(block.start_time);
  const speaker = block.speaker?.name ?? "Unknown";
  return clock
    ? `**[${clock}] ${speaker}:** ${block.words}`
    : `**${speaker}:** ${block.words}`;
}

/**
 * Renders the transcript as markdown. `maxChars` bounds the output (used for
 * the routine fire payload); pass Infinity for the full transcript file.
 */
export function renderTranscript(
  payload: ReadAiWebhookPayload,
  maxChars = Infinity,
): string {
  const blocks = payload.transcript?.speaker_blocks ?? [];
  if (blocks.length === 0) return "_No transcript available._";

  const lines: string[] = [];
  let used = 0;
  let included = 0;
  for (const block of blocks) {
    const line = formatSpeakerBlock(block);
    if (used + line.length > maxChars) break;
    lines.push(line, "");
    used += line.length + 1;
    included++;
  }
  if (included < blocks.length) {
    lines.push(
      `_Truncated: ${included} of ${blocks.length} speaker blocks shown; the full transcript file in the vault has the rest._`,
    );
  }
  return lines.join("\n");
}

// ─── Previous meeting in series ────────────────────────────────────────────────

/**
 * Finds the most recent prior note of the same recurring meeting (same title
 * after stripping the leading date) among vault index paths. Returns the note
 * base name for wikilinking, or null.
 */
export function findPreviousInSeries(
  vaultPaths: string[],
  payload: ReadAiWebhookPayload,
  meetingNotesFolderName = "Meeting Notes",
): string | null {
  const targetTitle = sanitizeTitle(payload.title).toLowerCase();
  const targetDate = meetingDate(payload);
  const pattern = /^(\d{4}-\d{2}-\d{2}) (.+?)( \(transcript\))?$/;

  let best: { date: string; name: string } | null = null;
  for (const path of vaultPaths) {
    if (!path.startsWith(`${meetingNotesFolderName}/`)) continue;
    const name = path.slice(meetingNotesFolderName.length + 1);
    if (name.includes("/")) continue; // skip Transcripts/ subfolder
    const m = name.match(pattern);
    if (!m || m[3]) continue;
    const [, date, title] = m;
    if (title.toLowerCase() !== targetTitle) continue;
    if (date >= targetDate) continue;
    if (!best || date > best.date) best = { date, name };
  }
  return best?.name ?? null;
}

// ─── Note builder ──────────────────────────────────────────────────────────────

const PENDING = "_Pending — filled in by the enrichment routine._";

export interface BuiltNote {
  fileName: string;
  content: string;
}

export function buildMeetingNote(
  payload: ReadAiWebhookPayload,
  opts: { previousInSeries: string | null },
): BuiltNote {
  const lines: string[] = [];
  const date = meetingDate(payload);

  lines.push("---");
  lines.push("type: meeting-note");
  lines.push(`session_id: ${payload.session_id}`);
  lines.push(`date: ${date}`);
  lines.push(`start: ${payload.start_time}`);
  if (payload.end_time) lines.push(`end: ${payload.end_time}`);
  if (payload.platform) lines.push(`platform: ${payload.platform}`);
  if (payload.report_url) {
    lines.push(`read_ai_report_url: "${payload.report_url}"`);
  }
  lines.push("---");
  lines.push("", `# ${sanitizeTitle(payload.title)}`);

  lines.push("", "## Attendees", "");
  const attendees = payload.participants?.length
    ? payload.participants
    : payload.owner
      ? [payload.owner]
      : [];
  if (attendees.length === 0) {
    lines.push("- _Unknown_");
  }
  for (const person of attendees) {
    const ownerTag =
      payload.owner && person.name === payload.owner.name ? " (owner)" : "";
    lines.push(
      `- [[${sanitizeTitle(person.name)}]]${person.email ? ` <${person.email}>` : ""}${ownerTag}`,
    );
  }

  if (payload.summary) {
    lines.push("", "## Summary", "", linkifyJiraKeys(payload.summary));
  }

  if (payload.chapter_summaries?.length) {
    lines.push("", "## Chapters");
    for (const chapter of payload.chapter_summaries) {
      lines.push(
        "",
        `### ${chapter.title}`,
        "",
        linkifyJiraKeys(chapter.description),
      );
      if (chapter.topics?.length) {
        lines.push(`Topics: ${chapter.topics.map((t) => t.text).join(", ")}`);
      }
    }
  }

  lines.push("", "## Key decisions", "");
  lines.push(enrichBlock("decisions", PENDING));

  lines.push("", "## Action items", "");
  const actionItemsMd = payload.action_items?.length
    ? payload.action_items
        .map((item) => `- [ ] ${linkifyJiraKeys(item.text)}`)
        .join("\n")
    : "_None captured._";
  lines.push(enrichBlock("actionitems", actionItemsMd));

  if (payload.key_questions?.length) {
    lines.push("", "## Open questions", "");
    for (const q of payload.key_questions) {
      lines.push(`- ${linkifyJiraKeys(q.text)}`);
    }
  }

  lines.push("", "## Related", "");
  const relatedInitial = opts.previousInSeries
    ? `- Previous in series: [[${opts.previousInSeries}]]`
    : PENDING;
  lines.push(enrichBlock("related", relatedInitial));

  lines.push("", "---", "");
  const footer: string[] = [`Transcript: [[${transcriptBaseName(payload)}]]`];
  if (payload.report_url) {
    footer.push(`[Read AI report](${payload.report_url})`);
  }
  lines.push(footer.join(" · "));

  return { fileName: `${noteBaseName(payload)}.md`, content: lines.join("\n") };
}

export function buildTranscriptNote(payload: ReadAiWebhookPayload): BuiltNote {
  const lines: string[] = [];
  lines.push("---");
  lines.push("type: meeting-transcript");
  lines.push(`session_id: ${payload.session_id}`);
  lines.push(`date: ${meetingDate(payload)}`);
  lines.push("---");
  lines.push("", `# Transcript: ${sanitizeTitle(payload.title)}`);
  lines.push("", `Meeting note: [[${noteBaseName(payload)}]]`, "");
  lines.push(renderTranscript(payload));
  return {
    fileName: `${transcriptBaseName(payload)}.md`,
    content: lines.join("\n"),
  };
}

/** The action-items block content, for inclusion in the enrichment payload. */
export function actionItemsMarkdown(payload: ReadAiWebhookPayload): string {
  return payload.action_items?.length
    ? payload.action_items
        .map((item) => `- [ ] ${linkifyJiraKeys(item.text)}`)
        .join("\n")
    : "_None captured._";
}
