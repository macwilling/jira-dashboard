import { describe, it, expect } from "vitest";
import { parseReleaseName, addDays } from "./matcher";

describe("parseReleaseName", () => {
  it("splits a platform-prefixed version into platform + release type", () => {
    expect(parseReleaseName("web@1.1.0")).toEqual({ platform: "web", releaseType: "minor" });
    expect(parseReleaseName("android@2.0.0")).toEqual({ platform: "android", releaseType: "major" });
    expect(parseReleaseName("ios@1.2.3")).toEqual({ platform: "ios", releaseType: "patch" });
  });

  it("classifies release type from the semver: x.0.0 major, x.y.0 minor, x.y.z patch", () => {
    expect(parseReleaseName("web@3.0.0").releaseType).toBe("major");
    expect(parseReleaseName("web@3.4.0").releaseType).toBe("minor");
    expect(parseReleaseName("web@3.4.5").releaseType).toBe("patch");
  });

  it("treats a bare semver as platform-less", () => {
    expect(parseReleaseName("1.2.3")).toEqual({ platform: null, releaseType: "patch" });
  });

  it("tolerates a trailing pre-release/build suffix after the semver core", () => {
    expect(parseReleaseName("web@1.0.0-rc1")).toEqual({ platform: "web", releaseType: "major" });
  });

  it("returns nulls for unparseable names", () => {
    expect(parseReleaseName("Sprint 42")).toEqual({ platform: null, releaseType: null });
    expect(parseReleaseName("web@")).toEqual({ platform: "web", releaseType: null });
  });
});

describe("addDays", () => {
  it("adds calendar days and returns a YYYY-MM-DD string", () => {
    expect(addDays("2026-07-22", 3)).toBe("2026-07-25");
  });

  it("handles month and year rollover", () => {
    expect(addDays("2026-07-30", 5)).toBe("2026-08-04");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("supports negative offsets", () => {
    expect(addDays("2026-07-22", -1)).toBe("2026-07-21");
  });

  it("uses only the date part of a full ISO timestamp", () => {
    expect(addDays("2026-07-22T18:30:00Z", 0)).toBe("2026-07-22");
  });

  it("throws on an invalid date", () => {
    expect(() => addDays("not-a-date", 1)).toThrow(/Invalid release date/);
  });
});
