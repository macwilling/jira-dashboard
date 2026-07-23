/**
 * Pure logic for the wallboard "My Day" screen — shared types and the
 * next-workday picker behind the end-of-day pre-read section.
 */

export interface DayEvent {
  id: string;
  summary: string;
  allDay: boolean;
  /** dateTime ISO for timed events; YYYY-MM-DD for all-day. */
  startISO: string;
  endISO: string;
  location: string | null;
  response: "accepted" | "tentative" | "needsAction" | null;
  /** Raw Google eventType (default when absent). */
  eventType?: string;
  /** Attendees incl. self; 0 = solo hold. */
  attendeeCount?: number;
  /** Set when this "event" is really a scheduled Google Task (see myday docs). */
  taskSlug?: string | null;
  /** Task completion, resolved server-side; null = unknown / not a task. */
  taskCompleted?: boolean | null;
}

/**
 * How a timed calendar item reads at a glance. A scheduled task wins over
 * everything (Google files it as a focusTime event); then out-of-office and
 * focus by eventType; otherwise the presence of other guests separates a real
 * meeting from a solo "block" you've held on your own calendar.
 *
 * We deliberately don't split meeting vs 1:1: a meeting invited through a group
 * alias (e.g. a whole-team standup) surfaces as just self + the alias = 2
 * attendees, so an attendee-count split would confidently mislabel it "1:1".
 * The people count is shown in the UI instead, which stays honest.
 */
export type EventKind = "meeting" | "focus" | "ooo" | "task" | "block";

export function classifyKind(e: {
  eventType?: string;
  attendeeCount?: number;
  taskSlug?: string | null;
}): EventKind {
  if (e.taskSlug) return "task";
  if (e.eventType === "outOfOffice") return "ooo";
  if (e.eventType === "focusTime") return "focus";
  return (e.attendeeCount ?? 0) >= 2 ? "meeting" : "block";
}

/**
 * Google Tasks ids are base64url of the slug used in tasks.google.com/task/<slug>
 * (verified 2026-07). Decodes a Tasks API id back to that slug so the rail can
 * tell which due to-dos are already time-blocked on the calendar. Returns null
 * if the id doesn't decode to a clean slug.
 */
export function decodeTaskSlug(taskId: string): string | null {
  try {
    const b64 = taskId.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
    const slug = atob(b64 + pad);
    return /^[\w-]+$/.test(slug) ? slug : null;
  } catch {
    return null;
  }
}

export interface DueTask {
  id: string;
  title: string;
  listTitle: string;
  /** YYYY-MM-DD — Google stores date-only dues. */
  due: string;
}

/**
 * Total wall-clock milliseconds covered by a set of intervals, merging
 * overlaps so nested or double-booked items are counted once. A scheduled task
 * dropped inside a focus block, or two meetings booked over each other, must
 * not inflate the day's time totals.
 */
export function unionMs(intervals: { startMs: number; endMs: number }[]): number {
  if (intervals.length === 0) return 0;
  const sorted = [...intervals].sort((a, b) => a.startMs - b.startMs);
  let total = 0;
  let curStart = sorted[0].startMs;
  let curEnd = sorted[0].endMs;
  for (let i = 1; i < sorted.length; i++) {
    const { startMs, endMs } = sorted[i];
    if (startMs <= curEnd) {
      curEnd = Math.max(curEnd, endMs);
    } else {
      total += curEnd - curStart;
      curStart = startMs;
      curEnd = endMs;
    }
  }
  return total + (curEnd - curStart);
}

/** Local YYYY-MM-DD of a Date — the TV's day, not UTC's. */
export function localDateStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export interface PreviewDay {
  /** Local midnight of the chosen day. */
  dayStartMs: number;
  /** That day's timed events, in start order. */
  events: DayEvent[];
}

/**
 * The next workday worth pre-reading: scanning forward from `fromDayStart`
 * (a local midnight), the first Mon–Fri day that has at least one timed
 * event. Weekends are skipped entirely, and so are empty weekdays (holiday,
 * PTO) — a Friday-evening wallboard previews Monday, not a blank Saturday.
 * Returns null when no day in the window qualifies.
 */
export function pickPreviewDay(
  events: DayEvent[],
  fromDayStart: Date,
  maxDays = 7
): PreviewDay | null {
  const timed = events.filter((e) => !e.allDay);
  for (let i = 0; i < maxDays; i++) {
    // setDate (not +24h of millis) so DST transitions keep local midnight.
    const day = new Date(fromDayStart);
    day.setDate(day.getDate() + i);
    const dow = day.getDay();
    if (dow === 0 || dow === 6) continue;
    const next = new Date(day);
    next.setDate(next.getDate() + 1);
    const dayEvents = timed.filter((e) => {
      const t = new Date(e.startISO).getTime();
      return t >= day.getTime() && t < next.getTime();
    });
    if (dayEvents.length > 0) return { dayStartMs: day.getTime(), events: dayEvents };
  }
  return null;
}
