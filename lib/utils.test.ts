import { describe, it, expect, vi, afterEach } from "vitest";
import {
  cn,
  isStale,
  isRecentlyChanged,
  getStatusBadgeColor,
  getEpicColor,
  parseSummaryTags,
  getLastStandupTime,
} from "./utils";
import { makeTicket } from "@/test/fixtures";

describe("cn", () => {
  it("merges class names and de-dupes conflicting tailwind utilities", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
    expect(cn("text-sm", false && "hidden", "font-bold")).toBe("text-sm font-bold");
  });
});

describe("isStale", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is true when last activity is older than 7 days", () => {
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-07-22T00:00:00Z").getTime());
    expect(isStale(makeTicket({ lastActivityDate: "2026-07-10T00:00:00Z" }))).toBe(true);
  });

  it("is false at exactly the threshold and for recent activity", () => {
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-07-22T00:00:00Z").getTime());
    expect(isStale(makeTicket({ lastActivityDate: "2026-07-21T00:00:00Z" }))).toBe(false);
  });
});

describe("isRecentlyChanged", () => {
  it("is inclusive of the boundary instant", () => {
    const since = new Date("2026-07-20T00:00:00Z");
    expect(isRecentlyChanged(makeTicket({ lastActivityDate: "2026-07-20T00:00:00Z" }), since)).toBe(true);
    expect(isRecentlyChanged(makeTicket({ lastActivityDate: "2026-07-19T23:59:59Z" }), since)).toBe(false);
  });
});

describe("getStatusBadgeColor", () => {
  it("returns a class string per category and defaults to 'new'", () => {
    expect(getStatusBadgeColor("done")).toContain("green");
    expect(getStatusBadgeColor("indeterminate")).toContain("blue");
    // @ts-expect-error — exercising the runtime fallback for a bad value
    expect(getStatusBadgeColor("bogus")).toBe(getStatusBadgeColor("new"));
  });
});

describe("getEpicColor", () => {
  it("uses a valid hex color from Jira when provided", () => {
    expect(getEpicColor("Any Epic", "#AbCdEf")).toBe("#AbCdEf");
  });

  it("ignores invalid hex and derives deterministically from the name", () => {
    const a = getEpicColor("Checkout Revamp", "not-a-hex");
    const b = getEpicColor("Checkout Revamp");
    expect(a).toBe(b); // same name → same color regardless of the junk input
    expect(a).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it("is stable across calls for the same epic name", () => {
    expect(getEpicColor("Billing")).toBe(getEpicColor("Billing"));
  });
});

describe("parseSummaryTags", () => {
  it("extracts leading [TAG] prefixes and returns the cleaned summary", () => {
    expect(parseSummaryTags("[API][URGENT] Fix the thing")).toEqual({
      tags: ["API", "URGENT"],
      rest: "Fix the thing",
    });
  });

  it("returns no tags when the summary has no prefix", () => {
    expect(parseSummaryTags("Just a summary")).toEqual({ tags: [], rest: "Just a summary" });
  });

  it("does not treat a mid-string bracket as a tag", () => {
    expect(parseSummaryTags("Fix [thing] later")).toEqual({
      tags: [],
      rest: "Fix [thing] later",
    });
  });
});

describe("getLastStandupTime", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns today's standup when it has already passed (local time)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-22T15:00:00"));
    const result = getLastStandupTime("09:00");
    expect(result.getFullYear()).toBe(2026);
    expect(result.getHours()).toBe(9);
    expect(result.getDate()).toBe(22);
    vi.useRealTimers();
  });

  it("rolls back to yesterday when today's standup hasn't happened yet (local time)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-22T07:00:00"));
    const result = getLastStandupTime("09:00");
    expect(result.getDate()).toBe(21);
    expect(result.getHours()).toBe(9);
    vi.useRealTimers();
  });

  it("defaults to 09:00 when no time is given", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-22T12:00:00"));
    expect(getLastStandupTime().getHours()).toBe(9);
    vi.useRealTimers();
  });
});
