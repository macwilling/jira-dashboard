import { describe, it, expect } from "vitest";
import { extractJiraKey } from "./client";

describe("extractJiraKey", () => {
  it("pulls the key from a PR title", () => {
    expect(extractJiraKey("IST-5584-5. Zello: added create view")).toBe("IST-5584");
  });

  it("truncates at the issue number (ignores a trailing -N suffix)", () => {
    expect(extractJiraKey("IST-5584-5")).toBe("IST-5584");
  });

  it("falls back to the branch, then the body, in order", () => {
    // no key in title → branch wins
    expect(extractJiraKey("feat(truck): maintenance", "feature/IST-5607-truck")).toBe(
      "IST-5607"
    );
    // no key in title or branch → body wins
    expect(
      extractJiraKey("chore: cleanup", "cleanup-branch", "Closes IST-1234 and more")
    ).toBe("IST-1234");
  });

  it("uppercases a lowercase key", () => {
    expect(extractJiraKey("ist-42 fix")).toBe("IST-42");
  });

  it("returns null when no key is present", () => {
    expect(extractJiraKey("feat(zello): add query service", "main", null)).toBeNull();
  });

  it("does not match unrelated hyphenated tokens", () => {
    // UTF-8 / SHA-256 must not be mistaken for Jira keys (prefix is anchored to IST)
    expect(extractJiraKey("encode as UTF-8 with SHA-256 digest")).toBeNull();
  });

  it("skips nullish sources", () => {
    expect(extractJiraKey(undefined, null, "IST-9")).toBe("IST-9");
  });
});
