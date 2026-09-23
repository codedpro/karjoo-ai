/**
 * Which boards a server-owned fleet run is allowed to lease.
 *
 * This used to assert the opposite: IranTalent was excluded from the fleet
 * because its apply ran on the control plane. That arrangement could never have
 * worked — the control plane is not in Iran and those boards never answer it —
 * so every board that applies server-side is now dispatched to the node, HTTP
 * ones included. What is still gated is the EXTENSION-only boards, which have no
 * server adapter at all and must never be leased by a node.
 *
 * This drives the real default claim path (no injected claimItems) and inspects
 * the options the fleet hands to the queue.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EMPTY_APPLY_FILTERS } from "@/lib/apply/filters";
import { testEntitlements } from "@/lib/billing/entitlements";

const claimUserApplyItems = vi.fn<(...args: unknown[]) => Promise<unknown[]>>(
  () => Promise.resolve([]),
);
const readApplyFilters = vi.fn();

vi.mock("@/lib/apply/extension-queue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/apply/extension-queue")>()),
  claimUserApplyItems: (...args: unknown[]) => claimUserApplyItems(...(args as [])),
}));

vi.mock("@/lib/apply/filters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/apply/filters")>();
  return { ...actual, readApplyFilters: (...args: unknown[]) => readApplyFilters(...(args as [])) };
});

const prepareNextTailoredResumeForQueue = vi.fn();
vi.mock("@/lib/resume/queue-prep", () => ({
  prepareNextTailoredResumeForQueue: (...args: unknown[]) =>
    prepareNextTailoredResumeForQueue(...(args as [])),
}));

const { claimFleetJobs } = await import("@/lib/fleet/dispatch");

function filtersWith(...enabled: string[]) {
  const boardFilters = { ...EMPTY_APPLY_FILTERS.boardFilters };
  for (const board of ["jobinja", "jobvision", "e-estekhdam", "irantalent"] as const) {
    boardFilters[board] = { ...boardFilters[board], enabled: enabled.includes(board) };
  }
  return { ...EMPTY_APPLY_FILTERS, boardFilters };
}

const ALL_BOARDS = new Set(["jobinja", "jobvision", "e-estekhdam", "irantalent", "karboom"]);

async function runFleet(usable: Set<string> = ALL_BOARDS) {
  return claimFleetJobs("node-1", 5, {
    readUsableBoards: async () => usable,
    readAssignedUserIds: async () => ["u1"],
    readEntitlements: async () =>
      testEntitlements({ unlimitedApplies: true, workerIpLimit: 1, status: "active" }),
    assertAllowed: async () => ({
      minScore: 0.7,
      quota: { limit: null, usedToday: 0, remaining: null },
    }),
    recordAudit: vi.fn(),
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  claimUserApplyItems.mockResolvedValue([]);
  prepareNextTailoredResumeForQueue.mockResolvedValue({ status: "empty" });
});

describe("server-owned runs and board routing", () => {
  it("leases every server-apply board, HTTP ones included", async () => {
    readApplyFilters.mockResolvedValue(filtersWith("jobinja", "jobvision", "irantalent"));
    await runFleet();
    expect(claimUserApplyItems).toHaveBeenCalledTimes(1);
    const options = claimUserApplyItems.mock.calls[0]![3] as {
      allowedBoards: string[];
      requireTailoredResume: boolean;
    };
    // IranTalent belongs here now: the node runs its HTTP apply from an Iranian IP.
    expect([...options.allowedBoards].sort()).toEqual(
      ["irantalent", "jobinja", "jobvision"].sort(),
    );
    expect(options.requireTailoredResume).toBe(true);
  });

  it("generates a resume only for the next job when none is ready, then claims it", async () => {
    readApplyFilters.mockResolvedValue(filtersWith("jobinja"));
    prepareNextTailoredResumeForQueue.mockResolvedValue({ status: "ready", taskId: "t1" });
    await runFleet();
    expect(prepareNextTailoredResumeForQueue).toHaveBeenCalledTimes(1);
    expect(prepareNextTailoredResumeForQueue.mock.calls[0]![1]).toMatchObject({
      allowedBoards: ["jobinja"],
    });
    expect(claimUserApplyItems).toHaveBeenCalledTimes(2);
  });

  it("leases IranTalent when it is the only enabled provider", async () => {
    readApplyFilters.mockResolvedValue(filtersWith("irantalent"));
    await runFleet();
    const options = claimUserApplyItems.mock.calls[0]![3] as { allowedBoards: string[] };
    expect(options.allowedBoards).toEqual(["irantalent"]);
  });

  it("never leases an extension-only board", async () => {
    // These have no server adapter at all. A node that claimed one would have
    // nothing to run it with, and the task would sit leased until it expired.
    readApplyFilters.mockResolvedValue(filtersWith("jobinja", "karboom"));
    await runFleet();
    const options = claimUserApplyItems.mock.calls[0]![3] as { allowedBoards: string[] };
    expect(options.allowedBoards).not.toContain("linkedin");
    expect(options.allowedBoards).not.toContain("divar");
  });

  it("never leases a board the node has no way to act on", async () => {
    // No session and no credential for IranTalent: leasing it would strand the
    // task — the claim would skip it for want of a session and nothing released it.
    readApplyFilters.mockResolvedValue(filtersWith("jobinja", "irantalent"));
    await runFleet(new Set(["jobinja"]));
    const options = claimUserApplyItems.mock.calls[0]![3] as { allowedBoards: string[] };
    expect(options.allowedBoards).toEqual(["jobinja"]);
  });

  it("leases nothing at all when no board has a session", async () => {
    readApplyFilters.mockResolvedValue(filtersWith("jobinja", "irantalent"));
    const jobs = await runFleet(new Set());
    expect(jobs).toEqual([]);
  });
});
