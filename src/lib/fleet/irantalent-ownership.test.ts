/**
 * IranTalent is extension-only in this release: a server-owned fleet run must
 * skip its tasks WITHOUT leasing them, while still draining the other enabled
 * providers. This drives the real default claim path (no injected claimItems)
 * and inspects the options the fleet hands to the queue.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EMPTY_APPLY_FILTERS } from "@/lib/apply/filters";

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

const { claimFleetJobs } = await import("@/lib/fleet/dispatch");

function filtersWith(...enabled: string[]) {
  const boardFilters = { ...EMPTY_APPLY_FILTERS.boardFilters };
  for (const board of ["jobinja", "jobvision", "e-estekhdam", "irantalent"] as const) {
    boardFilters[board] = { ...boardFilters[board], enabled: enabled.includes(board) };
  }
  return { ...EMPTY_APPLY_FILTERS, boardFilters };
}

async function runFleet() {
  return claimFleetJobs("node-1", 5, {
    readAssignedUserIds: async () => ["u1"],
    readPlan: async () => "max",
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
});

describe("server-owned runs and IranTalent", () => {
  it("drops IranTalent from the allowed boards while keeping the others", async () => {
    readApplyFilters.mockResolvedValue(filtersWith("jobinja", "jobvision", "irantalent"));
    await runFleet();
    expect(claimUserApplyItems).toHaveBeenCalledTimes(1);
    const options = claimUserApplyItems.mock.calls[0]![3] as {
      allowedBoards: string[];
      requireTailoredResume: boolean;
    };
    expect(options.allowedBoards).toEqual(["jobinja", "jobvision"]);
    expect(options.allowedBoards).not.toContain("irantalent");
    expect(options.requireTailoredResume).toBe(true);
  });

  it("leases nothing when IranTalent is the only enabled provider", async () => {
    readApplyFilters.mockResolvedValue(filtersWith("irantalent"));
    const jobs = await runFleet();
    const options = claimUserApplyItems.mock.calls[0]![3] as { allowedBoards: string[] };
    expect(options.allowedBoards).toEqual([]);
    expect(jobs).toEqual([]);
  });
});
