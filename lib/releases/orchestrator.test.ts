import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  makeRelease,
  makeCategory,
  makeWorkflow,
  makeVersionPayload,
} from "@/test/fixtures";
import type { Release } from "./types";

// ── Mock every side-effecting dependency. The orchestrator is pure control
//    flow once these are stubbed, so this suite asserts the branching, not the
//    stores/dispatchers themselves. ────────────────────────────────────────
vi.mock("./store", () => ({
  getRelease: vi.fn(),
  upsertRelease: vi.fn(),
  deleteRelease: vi.fn(),
  setReleaseCategory: vi.fn(),
  setResolutionRequired: vi.fn(),
}));
vi.mock("./dispatcher", () => ({
  autoDispatchPendingInstances: vi.fn(),
  cascadeReleaseDateChange: vi.fn(),
}));
vi.mock("./notifications", () => ({ fireReleaseEvent: vi.fn() }));
vi.mock("./approval", () => ({
  postApprovalRequest: vi.fn(),
  supersedeAndRepost: vi.fn(),
}));
vi.mock("./categories", () => ({
  resolveCategoryForName: vi.fn(),
  getCategory: vi.fn(),
}));
vi.mock("./workflows-store", () => ({ getWorkflow: vi.fn() }));
vi.mock("./task-instances-store", () => ({
  generateTaskInstances: vi.fn(),
  countInstancesByState: vi.fn(),
}));
vi.mock("./events-store", () => ({ recordEvent: vi.fn() }));
vi.mock("./admin-notifier", () => ({ postAdminNeedsResolution: vi.fn() }));

import { handleVersionEvent } from "./orchestrator";
import * as store from "./store";
import * as dispatcher from "./dispatcher";
import { fireReleaseEvent } from "./notifications";
import { postApprovalRequest, supersedeAndRepost } from "./approval";
import { resolveCategoryForName, getCategory } from "./categories";
import { getWorkflow } from "./workflows-store";
import {
  generateTaskInstances,
  countInstancesByState,
} from "./task-instances-store";
import { recordEvent } from "./events-store";
import { postAdminNeedsResolution } from "./admin-notifier";

const NO_INSTANCES = { pending: 0, dispatched: 0, completed: 0 };

/** Sets up the two getRelease calls: [0] = previous state, [1+] = post-upsert. */
function primeRelease(previous: Release | null, current: Release) {
  vi.mocked(store.getRelease)
    .mockResolvedValueOnce(previous as Release)
    .mockResolvedValue(current);
}

function run(overrides: {
  event?: Parameters<typeof handleVersionEvent>[0]["webhookEvent"];
  payload?: Partial<ReturnType<typeof makeVersionPayload>>;
} = {}) {
  return handleVersionEvent({
    payload: makeVersionPayload(overrides.payload),
    webhookEvent: overrides.event ?? "jira:version_updated",
    rawBody: { some: "raw" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Sensible defaults: unmatched, no instances, no workflow.
  vi.mocked(store.upsertRelease).mockResolvedValue(undefined);
  vi.mocked(store.deleteRelease).mockResolvedValue(undefined);
  vi.mocked(store.setReleaseCategory).mockResolvedValue(undefined);
  vi.mocked(store.setResolutionRequired).mockResolvedValue(undefined);
  vi.mocked(dispatcher.autoDispatchPendingInstances).mockResolvedValue(undefined);
  vi.mocked(dispatcher.cascadeReleaseDateChange).mockResolvedValue(undefined);
  vi.mocked(fireReleaseEvent).mockResolvedValue(undefined);
  vi.mocked(postApprovalRequest).mockResolvedValue(true);
  vi.mocked(supersedeAndRepost).mockResolvedValue(undefined);
  vi.mocked(resolveCategoryForName).mockResolvedValue(null);
  vi.mocked(getCategory).mockResolvedValue(null);
  vi.mocked(getWorkflow).mockResolvedValue(null);
  vi.mocked(generateTaskInstances).mockResolvedValue([]);
  vi.mocked(countInstancesByState).mockResolvedValue(NO_INSTANCES);
  vi.mocked(recordEvent).mockResolvedValue(undefined);
  vi.mocked(postAdminNeedsResolution).mockResolvedValue(undefined);
});

describe("handleVersionEvent — delete path", () => {
  it("deletes the release and records the event without upserting", async () => {
    const result = await run({ event: "jira:version_deleted" });

    expect(result.action).toBe("deleted");
    expect(store.deleteRelease).toHaveBeenCalledWith("10001");
    expect(recordEvent).toHaveBeenCalledWith("10001", "release.deleted", {
      webhookEvent: "jira:version_deleted",
    });
    expect(store.upsertRelease).not.toHaveBeenCalled();
  });
});

describe("handleVersionEvent — soft-delete / ignored guards", () => {
  it("returns early for a soft-deleted release, firing no notifications", async () => {
    primeRelease(null, makeRelease({ deletedAt: "2026-07-01T00:00:00Z" }));
    const result = await run();

    expect(result.action).toBe("upserted");
    expect(fireReleaseEvent).not.toHaveBeenCalled();
    expect(resolveCategoryForName).not.toHaveBeenCalled();
  });

  it("returns early for an ignored release", async () => {
    primeRelease(null, makeRelease({ ignored: true }));
    const result = await run();

    expect(result.action).toBe("upserted");
    expect(resolveCategoryForName).not.toHaveBeenCalled();
  });
});

describe("handleVersionEvent — already frozen", () => {
  it("stays frozen and still fires lifecycle notifications without re-resolving category", async () => {
    // A date move on an already-frozen release should still notify, proving
    // fireLifecycleNotifications runs on the frozen path.
    primeRelease(
      makeRelease({ releaseDate: "2026-08-01" }),
      makeRelease({ resolutionRequired: true, releaseDate: "2026-09-01" }),
    );
    const result = await run({ payload: { releaseDate: "2026-09-01" } });

    expect(result.action).toBe("frozen");
    expect(resolveCategoryForName).not.toHaveBeenCalled();
    expect(fireReleaseEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "release.date_changed" }),
    );
  });
});

describe("handleVersionEvent — unmatched release", () => {
  it("assigns no category, generates no tasks, and reports unmatched", async () => {
    primeRelease(null, makeRelease({ categoryId: null }));
    const result = await run({ event: "jira:version_created" });

    expect(result.action).toBe("unmatched");
    expect(result.workflowId).toBeNull();
    expect(generateTaskInstances).not.toHaveBeenCalled();
    // New release → release.created fires.
    expect(fireReleaseEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "release.created" }),
    );
  });

  it("records category.assigned when a category matches but has no workflow", async () => {
    primeRelease(null, makeRelease({ categoryId: null }));
    vi.mocked(resolveCategoryForName).mockResolvedValue(
      makeCategory({ workflowId: null }),
    );
    const result = await run();

    expect(result.action).toBe("unmatched");
    expect(store.setReleaseCategory).toHaveBeenCalledWith("10001", "cat-1");
    expect(recordEvent).toHaveBeenCalledWith(
      "10001",
      "category.assigned",
      expect.objectContaining({ categoryId: "cat-1" }),
    );
  });
});

describe("handleVersionEvent — matched, no approval gate", () => {
  beforeEach(() => {
    vi.mocked(resolveCategoryForName).mockResolvedValue(makeCategory());
    vi.mocked(getWorkflow).mockResolvedValue(
      makeWorkflow({ approvalSlackTarget: null }),
    );
  });

  it("generates task instances and auto-dispatches them", async () => {
    primeRelease(null, makeRelease({ categoryId: "cat-1" }));
    vi.mocked(generateTaskInstances).mockResolvedValue([
      { id: "ti-1" } as never,
      { id: "ti-2" } as never,
    ]);

    const result = await run({ event: "jira:version_created" });

    expect(result.action).toBe("upserted");
    expect(result.tasksGenerated).toBe(2);
    expect(generateTaskInstances).toHaveBeenCalledWith(
      expect.objectContaining({ id: "10001" }),
      "wf-1",
    );
    expect(recordEvent).toHaveBeenCalledWith(
      "10001",
      "task.generated",
      expect.objectContaining({ count: 2, workflowId: "wf-1" }),
    );
    expect(dispatcher.autoDispatchPendingInstances).toHaveBeenCalledWith("10001");
    expect(postApprovalRequest).not.toHaveBeenCalled();
  });

  it("does not generate tasks or dispatch when the release has no date", async () => {
    primeRelease(
      null,
      makeRelease({ categoryId: "cat-1", releaseDate: null }),
    );
    const result = await run({ payload: { releaseDate: undefined } });

    expect(result.action).toBe("upserted");
    expect(generateTaskInstances).not.toHaveBeenCalled();
    expect(dispatcher.autoDispatchPendingInstances).not.toHaveBeenCalled();
  });
});

describe("handleVersionEvent — approval gate", () => {
  beforeEach(() => {
    vi.mocked(resolveCategoryForName).mockResolvedValue(makeCategory());
    vi.mocked(getWorkflow).mockResolvedValue(
      makeWorkflow({ approvalSlackTarget: "C123" }),
    );
  });

  it("posts an approval request when status is 'none'", async () => {
    primeRelease(null, makeRelease({ categoryId: "cat-1", approvalStatus: "none" }));
    await run();

    expect(postApprovalRequest).toHaveBeenCalledWith(
      expect.objectContaining({ target: "C123" }),
    );
    expect(dispatcher.autoDispatchPendingInstances).not.toHaveBeenCalled();
  });

  it("auto-dispatches when already approved", async () => {
    primeRelease(null, makeRelease({ categoryId: "cat-1", approvalStatus: "approved" }));
    await run();

    expect(dispatcher.autoDispatchPendingInstances).toHaveBeenCalledWith("10001");
    expect(postApprovalRequest).not.toHaveBeenCalled();
  });

  it("supersedes and reposts when an approval is already pending", async () => {
    primeRelease(null, makeRelease({ categoryId: "cat-1", approvalStatus: "pending" }));
    await run();

    expect(supersedeAndRepost).toHaveBeenCalled();
    expect(postApprovalRequest).not.toHaveBeenCalled();
  });

  it("stays silent when a previous approval was cancelled", async () => {
    primeRelease(null, makeRelease({ categoryId: "cat-1", approvalStatus: "cancelled" }));
    await run();

    expect(postApprovalRequest).not.toHaveBeenCalled();
    expect(supersedeAndRepost).not.toHaveBeenCalled();
    expect(dispatcher.autoDispatchPendingInstances).not.toHaveBeenCalled();
  });
});

describe("handleVersionEvent — category-change conflict", () => {
  it("freezes the release for resolution when the category changes after tasks exist", async () => {
    const oldCat = makeCategory({ id: "cat-old", key: "web-minor", workflowId: "wf-old" });
    const newCat = makeCategory({ id: "cat-new", key: "web-major", workflowId: "wf-new" });

    primeRelease(
      makeRelease({ categoryId: "cat-old" }),
      makeRelease({ categoryId: "cat-old" }),
    );
    vi.mocked(getCategory).mockResolvedValue(oldCat); // current release.categoryId
    vi.mocked(resolveCategoryForName).mockResolvedValue(newCat); // name now maps elsewhere
    vi.mocked(countInstancesByState).mockResolvedValue({
      pending: 3,
      dispatched: 1,
      completed: 0,
    });

    const result = await run();

    expect(result.action).toBe("frozen");
    expect(store.setResolutionRequired).toHaveBeenCalledWith(
      "10001",
      "category_changed",
      expect.objectContaining({ oldCategoryKey: "web-minor", newCategoryKey: "web-major" }),
    );
    expect(recordEvent).toHaveBeenCalledWith(
      "10001",
      "resolution.required",
      expect.anything(),
    );
    expect(postAdminNeedsResolution).toHaveBeenCalled();
    // Critically, it must NOT regenerate tasks under the new (wrong) workflow.
    expect(generateTaskInstances).not.toHaveBeenCalled();
  });

  it("does NOT freeze when the category changes but no tasks exist yet", async () => {
    const oldCat = makeCategory({ id: "cat-old", workflowId: "wf-old" });
    const newCat = makeCategory({ id: "cat-new", workflowId: "wf-new" });

    primeRelease(
      makeRelease({ categoryId: "cat-old" }),
      makeRelease({ categoryId: "cat-old" }),
    );
    vi.mocked(getCategory).mockResolvedValue(oldCat);
    vi.mocked(resolveCategoryForName).mockResolvedValue(newCat);
    vi.mocked(getWorkflow).mockResolvedValue(makeWorkflow({ id: "wf-new" }));
    vi.mocked(countInstancesByState).mockResolvedValue(NO_INSTANCES);

    const result = await run();

    expect(store.setResolutionRequired).not.toHaveBeenCalled();
    expect(store.setReleaseCategory).toHaveBeenCalledWith("10001", "cat-new");
    expect(recordEvent).toHaveBeenCalledWith(
      "10001",
      "category.changed",
      expect.objectContaining({ oldCategoryKey: "web-minor", newCategoryKey: "web-minor" }),
    );
    expect(result.action).toBe("upserted");
  });
});

describe("handleVersionEvent — lifecycle notifications", () => {
  beforeEach(() => {
    vi.mocked(resolveCategoryForName).mockResolvedValue(makeCategory());
    vi.mocked(getWorkflow).mockResolvedValue(makeWorkflow());
  });

  it("fires release.date_changed and cascades when the date moves", async () => {
    primeRelease(
      makeRelease({ categoryId: "cat-1", releaseDate: "2026-08-01" }),
      makeRelease({ categoryId: "cat-1", releaseDate: "2026-08-15" }),
    );
    await run({ payload: { releaseDate: "2026-08-15" } });

    expect(dispatcher.cascadeReleaseDateChange).toHaveBeenCalledWith("10001", "2026-08-15");
    expect(fireReleaseEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "release.date_changed",
        event: { oldDate: "2026-08-01", newDate: "2026-08-15" },
      }),
    );
  });

  it("fires release.released when the release transitions to released", async () => {
    primeRelease(
      makeRelease({ categoryId: "cat-1", released: false }),
      makeRelease({ categoryId: "cat-1", released: true }),
    );
    await run({ event: "jira:version_released" });

    expect(fireReleaseEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "release.released" }),
    );
  });

  it("does not fire date_changed or cascade when the date is unchanged", async () => {
    primeRelease(
      makeRelease({ categoryId: "cat-1", releaseDate: "2026-08-01" }),
      makeRelease({ categoryId: "cat-1", releaseDate: "2026-08-01" }),
    );
    await run();

    expect(dispatcher.cascadeReleaseDateChange).not.toHaveBeenCalled();
    expect(fireReleaseEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "release.date_changed" }),
    );
  });
});
