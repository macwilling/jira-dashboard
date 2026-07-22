import { describe, expect, it } from "vitest";
import { DayEvent, pickPreviewDay } from "./myday";

/** Timed event starting at local (y, m0, d, h) lasting 30 min. */
function ev(id: string, y: number, m0: number, d: number, h: number): DayEvent {
  const start = new Date(y, m0, d, h);
  const end = new Date(start.getTime() + 30 * 60_000);
  return {
    id,
    summary: id,
    allDay: false,
    startISO: start.toISOString(),
    endISO: end.toISOString(),
    location: null,
    response: null,
  };
}

const allDay = (id: string, date: string): DayEvent => ({
  id,
  summary: id,
  allDay: true,
  startISO: date,
  endISO: date,
  location: null,
  response: null,
});

// 2026-07-22 is a Wednesday; 2026-07-24 a Friday.
const wedMidnight = new Date(2026, 6, 22);

describe("pickPreviewDay", () => {
  it("picks the from-day itself when it has timed events", () => {
    const events = [ev("standup", 2026, 6, 22, 9), ev("later", 2026, 6, 23, 10)];
    const picked = pickPreviewDay(events, wedMidnight);
    expect(picked?.dayStartMs).toBe(wedMidnight.getTime());
    expect(picked?.events.map((e) => e.id)).toEqual(["standup"]);
  });

  it("skips weekends — Saturday scan starts Monday", () => {
    // From Saturday the 25th; events exist Sunday (ignored) and Monday.
    const satMidnight = new Date(2026, 6, 25);
    const events = [ev("sunday-oncall", 2026, 6, 26, 9), ev("mon", 2026, 6, 27, 9)];
    const picked = pickPreviewDay(events, satMidnight);
    expect(picked?.dayStartMs).toBe(new Date(2026, 6, 27).getTime());
    expect(picked?.events.map((e) => e.id)).toEqual(["mon"]);
  });

  it("skips an empty weekday (holiday) and lands on the next day with events", () => {
    const events = [ev("fri", 2026, 6, 24, 14)];
    const picked = pickPreviewDay(events, new Date(2026, 6, 23)); // Thu empty
    expect(picked?.dayStartMs).toBe(new Date(2026, 6, 24).getTime());
  });

  it("ignores all-day events when deciding whether a day qualifies", () => {
    const events = [allDay("ooo", "2026-07-22"), ev("thu", 2026, 6, 23, 9)];
    const picked = pickPreviewDay(events, wedMidnight);
    expect(picked?.dayStartMs).toBe(new Date(2026, 6, 23).getTime());
  });

  it("returns null when no weekday in the window has events", () => {
    expect(pickPreviewDay([], wedMidnight)).toBeNull();
    const weekendOnly = [ev("sat", 2026, 6, 25, 10)];
    expect(pickPreviewDay(weekendOnly, wedMidnight)).toBeNull();
  });

  it("keeps a day's events in start order and scoped to that day", () => {
    const events = [
      ev("thu-late", 2026, 6, 23, 16),
      ev("thu-early", 2026, 6, 23, 9),
      ev("fri", 2026, 6, 24, 9),
    ];
    // API returns start-ordered; the picker only filters, preserving order.
    const sorted = [...events].sort((a, b) => a.startISO.localeCompare(b.startISO));
    const picked = pickPreviewDay(sorted, new Date(2026, 6, 23));
    expect(picked?.events.map((e) => e.id)).toEqual(["thu-early", "thu-late"]);
  });
});
