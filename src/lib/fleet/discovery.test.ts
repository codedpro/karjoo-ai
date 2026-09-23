/**
 * Fleet discovery — the control plane decides who is searched, the node only
 * executes. These pin the gates, and the one security boundary that matters: a
 * node can only queue work for users assigned to it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EMPTY_APPLY_FILTERS } from "@/lib/apply/filters";

const readApplyFilters = vi.fn();
const readJobPreferences = vi.fn(async () => ({ remoteOnly: true, categorySlugs: ["x"] }));
const enqueue = vi.fn(async () => ({ ingested: 1, queued: 1, alreadyQueued: 0, stale: 0, genderFiltered: 0, errors: [] }));
const persistCatalog = vi.fn(async () => ({ ingested: 1, stale: 0, errors: [] }));

vi.mock("@/lib/apply/filters", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/apply/filters")>()),
  readApplyFilters: (...a: unknown[]) => readApplyFilters(...a),
  readJobPreferences: (...a: unknown[]) => readJobPreferences(...(a as [])),
}));
vi.mock("@/lib/apply/orchestrator", () => ({
  enqueueBrowserDiscoveredListings: (...a: unknown[]) => enqueue(...(a as [])),
  persistCatalogListings: (...a: unknown[]) => persistCatalog(...(a as [])),
}));

const { claimFleetDiscovery, ingestFleetDiscovery, ingestFleetCatalog, FLEET_DISCOVERY_QUEUE_CEILING } =
  await import("@/lib/fleet/discovery");

function filters(over: Record<string, unknown> = {}) {
  return {
    ...EMPTY_APPLY_FILTERS,
    boardFilters: {
      ...EMPTY_APPLY_FILTERS.boardFilters,
      karboom: { ...EMPTY_APPLY_FILTERS.boardFilters.karboom, enabled: true, categoryKeys: ["dev"] },
      jobvision: { ...EMPTY_APPLY_FILTERS.boardFilters.jobvision, enabled: true, categoryKeys: ["developer"] },
    },
    ...over,
  };
}

const allOpen = {
  readAssignedUserIds: async () => ["u1"],
  canExecute: async () => true,
  isAllowed: async () => true,
  pendingCount: async () => 0,
  claimTurn: async () => true,
  jobvisionLabels: async (keys: string[]) => keys.map((k) => `label:${k}`),
};

beforeEach(() => {
  vi.clearAllMocks();
  readApplyFilters.mockResolvedValue(filters());
});

describe("claimFleetDiscovery", () => {
  it("hands out each targeted board, with JobVision labels resolved", async () => {
    const [user] = await claimFleetDiscovery("node-1", allOpen);
    expect(user!.userId).toBe("u1");
    const boards = Object.fromEntries(user!.boards.map((b) => [b.board, b]));
    expect(boards.karboom!.categoryKeys).toEqual(["dev"]);
    expect(boards.jobvision!.categoryLabels).toEqual(["label:developer"]);
  });

  it("leaves a user alone while their own browser is running the queue", async () => {
    const claimTurn = vi.fn(async () => true);
    expect(await claimFleetDiscovery("n", { ...allOpen, canExecute: async () => false, claimTurn })).toEqual([]);
    expect(claimTurn).not.toHaveBeenCalled();
  });

  it("does not discover more when the queue is already deep", async () => {
    const claimTurn = vi.fn(async () => true);
    const out = await claimFleetDiscovery("n", {
      ...allOpen,
      pendingCount: async () => FLEET_DISCOVERY_QUEUE_CEILING,
      claimTurn,
    });
    expect(out).toEqual([]);
    // The turn is not consumed by a user who was skipped for another reason.
    expect(claimTurn).not.toHaveBeenCalled();
  });

  it("skips a user whose turn another node already took", async () => {
    expect(await claimFleetDiscovery("n", { ...allOpen, claimTurn: async () => false })).toEqual([]);
  });

  it("skips paused filters and plans without server auto-apply", async () => {
    readApplyFilters.mockResolvedValue(filters({ paused: true }));
    expect(await claimFleetDiscovery("n", allOpen)).toEqual([]);
    readApplyFilters.mockResolvedValue(filters());
    expect(await claimFleetDiscovery("n", { ...allOpen, isAllowed: async () => false })).toEqual([]);
  });

  it("drops JobVision for the turn when its labels cannot be resolved", async () => {
    // Sent without labels, the node would read "no category" as "match anything".
    const [user] = await claimFleetDiscovery("n", {
      ...allOpen,
      jobvisionLabels: async () => {
        throw new Error("catalog down");
      },
    });
    expect(user!.boards.map((b) => b.board)).not.toContain("jobvision");
    expect(user!.boards.map((b) => b.board)).toContain("karboom");
  });
});

describe("ingestFleetDiscovery", () => {
  const listing = {
    externalId: "abc",
    title: "برنامه نویس",
    url: "https://karboom.io/jobs/abc/x",
    postedAt: "2026-09-20T00:00:00.000Z",
  };

  it("queues listings for a user assigned to this node, tagged as fleet", async () => {
    await ingestFleetDiscovery("node-1", "u1", "karboom", [listing], {
      readAssignedUserIds: async () => ["u1"],
    });
    expect(enqueue).toHaveBeenCalledWith("u1", expect.any(Array), expect.anything(), "fleet");
  });

  it("refuses to queue work for a user who is NOT on this node", async () => {
    await expect(
      ingestFleetDiscovery("node-1", "someone-else", "karboom", [listing], {
        readAssignedUserIds: async () => ["u1"],
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("puts catalog listings on the public page without queuing anything", async () => {
    await ingestFleetCatalog("karboom", [listing]);
    expect(persistCatalog).toHaveBeenCalledTimes(1);
    expect(enqueue).not.toHaveBeenCalled();
  });
});
