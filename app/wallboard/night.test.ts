import { describe, expect, it } from "vitest";
import { inSleepWindow } from "./night";

// The window is defined in Eastern wall-clock time (7 PM – 7 AM), so the same
// UTC hour lands differently across the DST switch — that's the main thing
// worth pinning here.
describe("inSleepWindow", () => {
  it("is awake during the ET workday", () => {
    // 12:00 EST (UTC-5)
    expect(inSleepWindow(Date.parse("2026-01-15T17:00:00Z"))).toBe(false);
    // 12:00 EDT (UTC-4)
    expect(inSleepWindow(Date.parse("2026-07-15T16:00:00Z"))).toBe(false);
  });

  it("sleeps from 19:00 ET", () => {
    // 18:59 / 19:00 EST
    expect(inSleepWindow(Date.parse("2026-01-15T23:59:00Z"))).toBe(false);
    expect(inSleepWindow(Date.parse("2026-01-16T00:00:00Z"))).toBe(true);
    // 19:30 EDT
    expect(inSleepWindow(Date.parse("2026-07-15T23:30:00Z"))).toBe(true);
  });

  it("stays asleep past midnight and wakes at 07:00 ET", () => {
    // 02:00 EST
    expect(inSleepWindow(Date.parse("2026-01-16T07:00:00Z"))).toBe(true);
    // 06:59 / 07:00 EST
    expect(inSleepWindow(Date.parse("2026-01-16T11:59:00Z"))).toBe(true);
    expect(inSleepWindow(Date.parse("2026-01-16T12:00:00Z"))).toBe(false);
    // 06:30 / 07:30 EDT
    expect(inSleepWindow(Date.parse("2026-07-16T10:30:00Z"))).toBe(true);
    expect(inSleepWindow(Date.parse("2026-07-16T11:30:00Z"))).toBe(false);
  });
});
