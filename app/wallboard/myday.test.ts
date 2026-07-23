import { describe, expect, it } from "vitest";
import {
  DayEvent,
  classifyKind,
  decodeTaskSlug,
  pickPreviewDay,
  unionMs,
} from "./myday";

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

describe("classifyKind", () => {
  it("treats a tasks.google.com-linked item as a task even when Google files it as focusTime", () => {
    expect(
      classifyKind({ eventType: "focusTime", taskSlug: "FeFw0ezOc3tZJqGr", attendeeCount: 0 }),
    ).toBe("task");
  });

  it("maps out-of-office and focus by eventType", () => {
    expect(classifyKind({ eventType: "outOfOffice" })).toBe("ooo");
    expect(classifyKind({ eventType: "focusTime" })).toBe("focus");
  });

  it("calls anything with other guests a meeting, and a solo hold a block", () => {
    expect(classifyKind({ eventType: "default", attendeeCount: 5 })).toBe("meeting");
    expect(classifyKind({ eventType: "default", attendeeCount: 2 })).toBe("meeting");
    expect(classifyKind({ eventType: "default", attendeeCount: 1 })).toBe("block");
    expect(classifyKind({ eventType: "default", attendeeCount: 0 })).toBe("block");
    expect(classifyKind({})).toBe("block");
  });

  it("lets a task win over its focusTime type and attendee count", () => {
    expect(classifyKind({ eventType: "focusTime", attendeeCount: 4, taskSlug: "abc" })).toBe(
      "task",
    );
  });
});

describe("unionMs", () => {
  const H = 60 * 60 * 1000;
  const iv = (startH: number, endH: number) => ({ startMs: startH * H, endMs: endH * H });

  it("is zero for no intervals", () => {
    expect(unionMs([])).toBe(0);
  });

  it("sums disjoint intervals", () => {
    expect(unionMs([iv(9, 10), iv(13, 14.5)])).toBe(2.5 * H);
  });

  it("counts a task nested inside a focus block once (today's real case)", () => {
    // 8:30–9:30 block · 10:00–13:30 focus ⊃ 11:30–13:00 task · 14:15–16:45 block
    const total = unionMs([
      iv(8.5, 9.5),
      iv(10, 13.5),
      iv(11.5, 13),
      iv(14.25, 16.75),
    ]);
    expect(total).toBe(7 * H); // not 8.5h — the task doesn't double-count
  });

  it("merges partial overlaps and touching intervals", () => {
    expect(unionMs([iv(9, 10.5), iv(10, 11)])).toBe(2 * H); // overlap
    expect(unionMs([iv(9, 10), iv(10, 11)])).toBe(2 * H); // touching
  });

  it("does not depend on input order", () => {
    expect(unionMs([iv(14, 15), iv(9, 10), iv(9.5, 11)])).toBe(unionMs([iv(9, 10), iv(9.5, 11), iv(14, 15)]));
  });
});

describe("decodeTaskSlug", () => {
  it("base64url-decodes a Tasks API id back to its tasks.google.com slug", () => {
    // Verified against a live scheduled task: id ↔ slug are base64url of each other.
    expect(decodeTaskSlug("RmVGdzBlek9jM3RaSnFHcg")).toBe("FeFw0ezOc3tZJqGr");
  });

  it("returns null for ids that don't decode to a clean slug", () => {
    expect(decodeTaskSlug("!!!not base64!!!")).toBeNull();
  });
});
