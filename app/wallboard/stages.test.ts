import { describe, it, expect } from "vitest";
import { stageOf, stageColor, STAGE_COLORS } from "./stages";

describe("stageOf", () => {
  it("maps known Jira statuses to display stages", () => {
    expect(stageOf("Blocked")).toBe("Blocked");
    expect(stageOf("Open")).toBe("To Do");
    expect(stageOf("In Progress")).toBe("In Progress");
    expect(stageOf("Resolved")).toBe("Code Review");
    expect(stageOf("Testing")).toBe("Testing");
  });

  it("is case-insensitive", () => {
    expect(stageOf("BLOCKED")).toBe("Blocked");
    expect(stageOf("in progress")).toBe("In Progress");
    expect(stageOf("ReSoLvEd")).toBe("Code Review");
  });

  it("treats unknown / terminal statuses as Done", () => {
    // Documented behavior: Closed, Awaiting Release, and any future status
    // all fall through to Done.
    expect(stageOf("Closed")).toBe("Done");
    expect(stageOf("Awaiting Release")).toBe("Done");
    expect(stageOf("Some Future Status")).toBe("Done");
    expect(stageOf("")).toBe("Done");
  });

  it("never lets Blocked masquerade as Done", () => {
    // Regression guard for the invariant called out in stages.ts.
    expect(stageOf("Blocked")).not.toBe("Done");
  });
});

describe("stageColor", () => {
  it("returns the color for the resolved stage", () => {
    expect(stageColor("Resolved")).toBe(STAGE_COLORS["Code Review"]);
    expect(stageColor("nonsense")).toBe(STAGE_COLORS.Done);
  });

  it("returns a defined color for every stage", () => {
    for (const color of Object.values(STAGE_COLORS)) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
