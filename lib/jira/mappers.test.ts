import { describe, it, expect } from "vitest";
import {
  mapJiraStatusCategory,
  mapJiraPriority,
  mapJiraType,
  adfToMarkdown,
  type AttachmentMap,
} from "./mappers";
import type { JiraAdfNode } from "./types";

describe("mapJiraStatusCategory", () => {
  it("maps the three Jira category keys", () => {
    expect(mapJiraStatusCategory("done")).toBe("done");
    expect(mapJiraStatusCategory("indeterminate")).toBe("indeterminate");
    expect(mapJiraStatusCategory("new")).toBe("new");
  });

  it("falls back to 'new' for anything unrecognized", () => {
    expect(mapJiraStatusCategory("")).toBe("new");
    expect(mapJiraStatusCategory("garbage")).toBe("new");
  });
});

describe("mapJiraPriority", () => {
  it("collapses Jira priority synonyms into the four app buckets", () => {
    expect(mapJiraPriority("Blocker")).toBe("Highest");
    expect(mapJiraPriority("Critical")).toBe("Highest");
    expect(mapJiraPriority("Major")).toBe("High");
    expect(mapJiraPriority("Normal")).toBe("Medium");
    expect(mapJiraPriority("Minor")).toBe("Low");
    expect(mapJiraPriority("Trivial")).toBe("Low");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(mapJiraPriority("  HIGH  ")).toBe("High");
  });

  it("defaults unknown priorities to Medium", () => {
    expect(mapJiraPriority("wat")).toBe("Medium");
  });
});

describe("mapJiraType", () => {
  it("maps known issue types, including sub-task spellings", () => {
    expect(mapJiraType("Story")).toBe("Story");
    expect(mapJiraType("Sub-task")).toBe("Subtask");
    expect(mapJiraType("subtask")).toBe("Subtask");
    expect(mapJiraType("Incident")).toBe("Support");
    expect(mapJiraType("Service Request")).toBe("Support");
    expect(mapJiraType("Epic")).toBe("Epic");
  });

  it("defaults unknown types to Task", () => {
    expect(mapJiraType("Spike")).toBe("Task");
  });
});

// Small helpers to keep the ADF fixtures readable.
const text = (t: string, marks?: JiraAdfNode["marks"]): JiraAdfNode => ({
  type: "text",
  text: t,
  ...(marks ? { marks } : {}),
});
const para = (...content: JiraAdfNode[]): JiraAdfNode => ({ type: "paragraph", content });
const doc = (...content: JiraAdfNode[]): JiraAdfNode => ({ type: "doc", content });

describe("adfToMarkdown", () => {
  it("returns an empty string for null", () => {
    expect(adfToMarkdown(null)).toBe("");
  });

  it("renders plain paragraphs with a trailing blank line", () => {
    expect(adfToMarkdown(doc(para(text("hello"))))).toBe("hello\n\n");
  });

  it("applies inline marks", () => {
    expect(adfToMarkdown(para(text("bold", [{ type: "strong" }]))).trim()).toBe(
      "<strong>bold</strong>"
    );
    expect(adfToMarkdown(para(text("x", [{ type: "code" }]))).trim()).toBe("`x`");
    expect(adfToMarkdown(para(text("gone", [{ type: "strike" }]))).trim()).toBe(
      "~~gone~~"
    );
  });

  it("renders links from the link mark", () => {
    const node = para(
      text("click", [{ type: "link", attrs: { href: "https://example.com" } }])
    );
    expect(adfToMarkdown(node).trim()).toBe("[click](https://example.com)");
  });

  it("renders headings at the right level", () => {
    const node: JiraAdfNode = { type: "heading", attrs: { level: 3 }, content: [text("Title")] };
    expect(adfToMarkdown(node)).toBe("### Title\n\n");
  });

  it("renders bullet lists", () => {
    const node: JiraAdfNode = {
      type: "bulletList",
      content: [
        { type: "listItem", content: [para(text("one"))] },
        { type: "listItem", content: [para(text("two"))] },
      ],
    };
    const out = adfToMarkdown(node);
    expect(out).toContain("- one");
    expect(out).toContain("- two");
  });

  it("renders ordered lists with incrementing numbers", () => {
    const node: JiraAdfNode = {
      type: "orderedList",
      content: [
        { type: "listItem", content: [para(text("first"))] },
        { type: "listItem", content: [para(text("second"))] },
      ],
    };
    const out = adfToMarkdown(node);
    expect(out).toContain("1. first");
    expect(out).toContain("2. second");
  });

  it("renders code blocks with the language fence", () => {
    const node: JiraAdfNode = {
      type: "codeBlock",
      attrs: { language: "ts" },
      content: [text("const x = 1;")],
    };
    expect(adfToMarkdown(node)).toBe("```ts\nconst x = 1;\n```\n\n");
  });

  it("renders mentions as bold handles", () => {
    expect(adfToMarkdown({ type: "mention", attrs: { text: "Alice" } })).toBe(
      "**@Alice**"
    );
  });

  it("resolves image media through the attachment proxy", () => {
    const attachments: AttachmentMap = new Map([
      ["media-1", { url: "https://jira/att/1", filename: "shot.png", mimeType: "image/png" }],
    ]);
    const node: JiraAdfNode = { type: "media", attrs: { id: "media-1" } };
    const out = adfToMarkdown(node, attachments);
    expect(out).toBe(
      "![shot.png](/api/jira/attachment?url=" +
        encodeURIComponent("https://jira/att/1") +
        ")"
    );
  });

  it("falls back to a placeholder for unresolved media", () => {
    expect(adfToMarkdown({ type: "media", attrs: { id: "missing" } })).toBe(
      "*[attachment]*"
    );
  });

  it("renders a whole document with mixed block content", () => {
    const node = doc(
      { type: "heading", attrs: { level: 1 }, content: [text("Heading")] },
      para(text("Some "), text("bold", [{ type: "strong" }]), text(" text.")),
      { type: "rule" }
    );
    const out = adfToMarkdown(node);
    expect(out).toContain("# Heading");
    expect(out).toContain("Some <strong>bold</strong> text.");
    expect(out).toContain("---");
  });
});
