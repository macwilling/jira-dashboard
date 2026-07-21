import type {
  ReadAiSpeakerBlock,
  ReadAiWebhookPayload,
} from "@/lib/readai/types";

/**
 * Cap on the transcript portion of the fire payload. The routines /fire
 * endpoint has no documented body limit, so stay comfortably small — the
 * structured report (summary, chapters, action items) carries most of the
 * signal and is always included in full.
 */
const TRANSCRIPT_CHAR_LIMIT = 100_000;

function formatClock(msString: string): string {
  const ms = Number(msString);
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  return d.toISOString().slice(11, 19); // HH:MM:SS UTC
}

function formatSpeakerBlock(block: ReadAiSpeakerBlock): string {
  const clock = formatClock(block.start_time);
  const speaker = block.speaker?.name ?? "Unknown";
  return clock ? `[${clock}] ${speaker}: ${block.words}` : `${speaker}: ${block.words}`;
}

/**
 * Flattens a Read AI meeting_end payload into the markdown digest sent as
 * the routine fire `text`. The routine's Claude session receives this inside
 * a <routine-fire-payload> block and turns it into an Obsidian note.
 */
export function buildMeetingDigest(payload: ReadAiWebhookPayload): string {
  const lines: string[] = [];

  lines.push(`# Meeting: ${payload.title}`);
  lines.push("");
  lines.push(`- Start: ${payload.start_time}`);
  if (payload.end_time) lines.push(`- End: ${payload.end_time}`);
  if (payload.platform) lines.push(`- Platform: ${payload.platform}`);
  if (payload.owner?.name) {
    lines.push(
      `- Owner: ${payload.owner.name}${payload.owner.email ? ` <${payload.owner.email}>` : ""}`,
    );
  }
  if (payload.participants?.length) {
    const names = payload.participants
      .map((p) => (p.email ? `${p.name} <${p.email}>` : p.name))
      .join(", ");
    lines.push(`- Participants: ${names}`);
  }
  if (payload.report_url) lines.push(`- Read AI report: ${payload.report_url}`);
  lines.push(`- Session ID: ${payload.session_id}`);

  if (payload.summary) {
    lines.push("", "## Summary", "", payload.summary);
  }

  if (payload.chapter_summaries?.length) {
    lines.push("", "## Chapters");
    for (const chapter of payload.chapter_summaries) {
      lines.push("", `### ${chapter.title}`, "", chapter.description);
      if (chapter.topics?.length) {
        lines.push(
          `Topics: ${chapter.topics.map((t) => t.text).join(", ")}`,
        );
      }
    }
  }

  if (payload.action_items?.length) {
    lines.push("", "## Action items", "");
    for (const item of payload.action_items) lines.push(`- ${item.text}`);
  }

  if (payload.key_questions?.length) {
    lines.push("", "## Key questions", "");
    for (const q of payload.key_questions) lines.push(`- ${q.text}`);
  }

  if (payload.topics?.length) {
    lines.push("", "## Topics", "");
    lines.push(payload.topics.map((t) => t.text).join(", "));
  }

  const blocks = payload.transcript?.speaker_blocks;
  if (blocks?.length) {
    lines.push("", "## Transcript", "");
    let used = 0;
    let included = 0;
    for (const block of blocks) {
      const line = formatSpeakerBlock(block);
      if (used + line.length > TRANSCRIPT_CHAR_LIMIT) break;
      lines.push(line);
      used += line.length + 1;
      included++;
    }
    if (included < blocks.length) {
      lines.push(
        "",
        `_Transcript truncated: ${included} of ${blocks.length} speaker blocks included. Full transcript: ${payload.report_url ?? "see Read AI report"}_`,
      );
    }
  }

  return lines.join("\n");
}
