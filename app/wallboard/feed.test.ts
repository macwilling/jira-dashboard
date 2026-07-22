import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  commentPreview,
  buildSnapshot,
  diffSnapshots,
  relativeTime,
} from "./feed";
import { makeTicket, makeComment } from "@/test/fixtures";

const NOW = 1_800_000_000_000;
const idOf = (id: string) => id; // identity member-name resolver for tests

describe("commentPreview", () => {
  it("strips markdown emphasis and collapses whitespace", () => {
    expect(commentPreview("**bold** and _italic_ and `code`")).toBe(
      "bold and italic and code"
    );
    expect(commentPreview("line one\n\n  line two")).toBe("line one line two");
  });

  it("replaces images with a placeholder and unwraps links", () => {
    expect(commentPreview("see ![alt](http://img.png) here")).toBe(
      "see [image] here"
    );
    expect(commentPreview("click [the link](http://x.com)")).toBe(
      "click the link"
    );
  });

  it("truncates with an ellipsis past the max length", () => {
    const out = commentPreview("a".repeat(200), 140);
    expect(out).toHaveLength(141); // 140 chars + ellipsis
    expect(out.endsWith("…")).toBe(true);
  });

  it("leaves short strings untouched", () => {
    expect(commentPreview("short", 140)).toBe("short");
  });
});

describe("buildSnapshot", () => {
  it("captures the fields the diff depends on, keyed by ticket key", () => {
    const snap = buildSnapshot([
      makeTicket({ key: "A-1", comments: [makeComment(), makeComment({ id: "c-2" })] }),
    ]);
    expect(snap.get("A-1")).toEqual({
      status: "In Progress",
      priority: "Medium",
      assigneeId: "user-1",
      commentCount: 2,
    });
  });
});

describe("diffSnapshots", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns no events when nothing changed", () => {
    const tickets = [makeTicket({ key: "A-1" })];
    const prev = buildSnapshot(tickets);
    expect(diffSnapshots(prev, tickets, idOf)).toEqual([]);
  });

  it("emits a 'new' event for a ticket not in the previous snapshot", () => {
    const prev = buildSnapshot([]);
    const events = diffSnapshots(prev, [makeTicket({ key: "A-1" })], idOf);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ key: "A-1", kind: "new", text: "added to the sprint" });
  });

  it("emits a status transition with from → to text", () => {
    const prev = buildSnapshot([makeTicket({ key: "A-1", status: "Open" })]);
    const events = diffSnapshots(prev, [makeTicket({ key: "A-1", status: "In Progress" })], idOf);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "status", text: "Open → In Progress" });
  });

  it("emits priority and assignee changes", () => {
    const prev = buildSnapshot([makeTicket({ key: "A-1", priority: "Low", assigneeId: "u1" })]);
    const events = diffSnapshots(
      prev,
      [makeTicket({ key: "A-1", priority: "High", assigneeId: "u2" })],
      (id) => (id === "u2" ? "Bob" : id)
    );
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("priority");
    expect(kinds).toContain("assignee");
    expect(events.find((e) => e.kind === "assignee")?.text).toBe("assigned to Bob");
  });

  it("labels an unassignment as 'unassigned'", () => {
    const prev = buildSnapshot([makeTicket({ key: "A-1", assigneeId: "u1" })]);
    const events = diffSnapshots(
      prev,
      [makeTicket({ key: "A-1", assigneeId: "" })],
      () => null
    );
    expect(events.find((e) => e.kind === "assignee")?.text).toBe("assigned to unassigned");
  });

  it("emits a comment event only when the count grows, with a preview of the latest", () => {
    const prev = buildSnapshot([makeTicket({ key: "A-1", comments: [makeComment({ id: "c-1" })] })]);
    const events = diffSnapshots(
      prev,
      [
        makeTicket({
          key: "A-1",
          comments: [makeComment({ id: "c-1" }), makeComment({ id: "c-2", body: "**hi there**" })],
        }),
      ],
      idOf
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "comment", detail: "hi there" });
  });

  it("does not emit a comment event when the count drops (deletion)", () => {
    const prev = buildSnapshot([
      makeTicket({ key: "A-1", comments: [makeComment({ id: "c-1" }), makeComment({ id: "c-2" })] }),
    ]);
    const events = diffSnapshots(
      prev,
      [makeTicket({ key: "A-1", comments: [makeComment({ id: "c-1" })] })],
      idOf
    );
    expect(events.filter((e) => e.kind === "comment")).toHaveLength(0);
  });

  it("emits multiple events for a ticket that changed several fields at once", () => {
    const prev = buildSnapshot([makeTicket({ key: "A-1", status: "Open", priority: "Low" })]);
    const events = diffSnapshots(
      prev,
      [makeTicket({ key: "A-1", status: "In Progress", priority: "High" })],
      idOf
    );
    expect(events.map((e) => e.kind).sort()).toEqual(["priority", "status"]);
  });
});

describe("relativeTime", () => {
  const base = NOW;
  it("renders coarse buckets", () => {
    expect(relativeTime(base, base)).toBe("just now");
    expect(relativeTime(base - 30 * 1000, base)).toBe("just now");
    expect(relativeTime(base - 5 * 60 * 1000, base)).toBe("5m ago");
    expect(relativeTime(base - 3 * 60 * 60 * 1000, base)).toBe("3h ago");
    expect(relativeTime(base - 2 * 24 * 60 * 60 * 1000, base)).toBe("2d ago");
  });

  it("clamps future timestamps to 'just now' instead of going negative", () => {
    expect(relativeTime(base + 10_000, base)).toBe("just now");
  });
});
