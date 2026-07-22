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
}

export interface DueTask {
  id: string;
  title: string;
  listTitle: string;
  /** YYYY-MM-DD — Google stores date-only dues. */
  due: string;
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
