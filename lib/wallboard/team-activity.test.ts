import { describe, expect, it } from "vitest";
import { buildTeamActivity } from "./team-activity";

describe("buildTeamActivity", () => {
  it("merges a person's Jira activity by accountId", () => {
    const people = buildTeamActivity({
      comments: [{ accountId: "acc-1", name: "Jack Shynkaruk" }],
      transitions: [
        { accountId: "acc-1", name: "Jack Shynkaruk" },
        { accountId: "acc-1", name: "Jack Shynkaruk" },
      ],
      prs: [],
    });
    expect(people).toHaveLength(1);
    expect(people[0].key).toBe("acc-1");
    expect(people[0].commented).toBe(1);
    expect(people[0].transitioned).toBe(2);
    expect(people[0].total).toBe(3);
  });

  it("attributes mapped GitHub PRs to the Jira person (login case-insensitive)", () => {
    const people = buildTeamActivity(
      {
        comments: [{ accountId: "acc-1", name: "Kacper Warda", avatarUrl: "k.png" }],
        transitions: [],
        prs: [
          { login: "Kacper-Sysdyne", name: "kacper-sysdyne", kind: "opened" },
          { login: "kacper-sysdyne", name: "kacper-sysdyne", kind: "merged" },
        ],
      },
      { githubUserMap: { "kacper-sysdyne": "acc-1" } }
    );
    expect(people).toHaveLength(1);
    const k = people[0];
    expect(k.key).toBe("acc-1");
    expect(k.name).toBe("Kacper Warda"); // Jira identity, not the login
    expect(k.avatarUrl).toBe("k.png");
    expect(k.commented).toBe(1);
    expect(k.prOpened).toBe(1);
    expect(k.prMerged).toBe(1);
    expect(k.total).toBe(3);
  });

  it("uses the Jira roster for a mapped dev with no Jira activity today", () => {
    const people = buildTeamActivity(
      {
        comments: [],
        transitions: [],
        prs: [{ login: "mnowak", name: "mnowak", kind: "approved" }],
      },
      {
        githubUserMap: { mnowak: "acc-9" },
        jiraRoster: { "acc-9": { name: "Mateusz Nowak", avatarUrl: "m.png" } },
      }
    );
    expect(people[0].key).toBe("acc-9");
    expect(people[0].name).toBe("Mateusz Nowak");
    expect(people[0].avatarUrl).toBe("m.png");
    expect(people[0].prApproved).toBe(1);
  });

  it("shows an unmapped GitHub user as their own GitHub-identity row", () => {
    const people = buildTeamActivity({
      comments: [],
      transitions: [],
      prs: [{ login: "drengr", name: "Dana Reng", kind: "merged" }],
    });
    expect(people).toHaveLength(1);
    expect(people[0].key).toBe("gh:drengr");
    expect(people[0].name).toBe("Dana Reng");
    expect(people[0].prMerged).toBe(1);
  });

  it("tracks each person's most recent activity across sources", () => {
    const people = buildTeamActivity(
      {
        comments: [
          { accountId: "acc-1", name: "Jack", at: "2026-07-22T09:00:00.000Z" },
        ],
        transitions: [],
        prs: [
          {
            login: "jack-gh",
            name: "jack-gh",
            kind: "merged",
            at: "2026-07-22T14:30:00.000Z",
          },
        ],
      },
      { githubUserMap: { "jack-gh": "acc-1" } }
    );
    expect(people[0].lastAt).toBe(new Date("2026-07-22T14:30:00.000Z").getTime());
  });

  it("leaves lastAt null when inputs carry no timestamps", () => {
    const people = buildTeamActivity({
      comments: [{ accountId: "acc-1", name: "Jack" }],
      transitions: [],
      prs: [],
    });
    expect(people[0].lastAt).toBeNull();
  });

  it("sorts by total desc and drops zero-activity rows", () => {
    const people = buildTeamActivity({
      comments: [{ accountId: "quiet", name: "Quiet Dev" }],
      transitions: [
        { accountId: "busy", name: "Busy Dev" },
        { accountId: "busy", name: "Busy Dev" },
      ],
      prs: [{ login: "busy-gh", name: "busy", kind: "merged" }],
    }, { githubUserMap: { "busy-gh": "busy" } });
    expect(people.map((p) => p.name)).toEqual(["Busy Dev", "Quiet Dev"]);
    expect(people[0].total).toBe(3);
  });
});
