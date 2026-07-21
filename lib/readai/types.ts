// Read AI webhook payload types.
// Schema reference: https://support.read.ai/hc/en-us/articles/16352415827219-Getting-Started-with-Webhooks

export interface ReadAiPerson {
  name: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
}

export interface ReadAiTextItem {
  text: string;
}

export interface ReadAiChapterSummary {
  title: string;
  description: string;
  topics?: ReadAiTextItem[];
}

export interface ReadAiSpeakerBlock {
  /** Unix time in milliseconds, as a string */
  start_time: string;
  end_time: string;
  speaker: { name: string };
  words: string;
}

export interface ReadAiTranscript {
  speaker_blocks: ReadAiSpeakerBlock[];
  speakers: { name: string }[];
}

/**
 * Full payload for `meeting_end` (and manual pushes). `meeting_start`
 * payloads (workspace webhooks only) carry just the identity subset —
 * everything past `owner` may be absent.
 */
export interface ReadAiWebhookPayload {
  session_id: string;
  trigger: "meeting_end" | "meeting_start";
  title: string;
  start_time: string; // ISO 8601 UTC
  end_time?: string;
  owner?: ReadAiPerson;
  participants?: ReadAiPerson[];
  summary?: string;
  action_items?: ReadAiTextItem[];
  key_questions?: ReadAiTextItem[];
  topics?: ReadAiTextItem[];
  report_url?: string;
  chapter_summaries?: ReadAiChapterSummary[];
  transcript?: ReadAiTranscript;
  platform_meeting_id?: string;
  platform?: string;
  /** Unique per delivery — use to drop duplicate/replayed payloads. */
  request_id?: string;
}
