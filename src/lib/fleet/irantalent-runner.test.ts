/**
 * Server-side IranTalent runner tests.
 *
 * The behaviours that matter: a disabled provider or a closed gate does nothing,
 * a missing session triggers exactly one credential login before giving up, every
 * outcome is reported back to the queue, and a mid-run logout stops the batch
 * instead of burning the rest of the queue against a dead session.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EMPTY_APPLY_FILTERS } from "@/lib/apply/filters";

const readApplyFilters = vi.fn<(...a: unknown[]) => Promise<unknown>>();
const claimUserApplyItems = vi.fn<(...a: unknown[]) => Promise<unknown[]>>(() => Promise.resolve([]));
const assertServerAutoApplyAllowed = vi.fn<(...a: unknown[]) => Promise<{ minScore: number }>>();
const readUserPlan = vi.fn(async () => "max");
const readSessionBlob = vi.fn<(...a: unknown[]) => Promise<Record<string, unknown> | null>>(
  async () => null,
);
const decryptSession = vi.fn(() => "SESSION");
const refreshSessionFromStoredCredential = vi.fn<(...a: unknown[]) => Promise<boolean>>(
  async () => false,
);
const applyToIranTalent = vi.fn<(...a: unknown[]) => Promise<{ status: string; reason?: string; ranSteps: string[] }>>();
const recordFleetResult = vi.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({}));

vi.mock("@/lib/apply/filters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/apply/filters")>();
  return { ...actual, readApplyFilters: (...a: unknown[]) => readApplyFilters(...a) };
});
vi.mock("@/lib/apply/extension-queue", () => ({
  claimUserApplyItems: (...a: unknown[]) => claimUserApplyItems(...a),
}));
vi.mock("@/lib/apply/auto-apply", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/apply/auto-apply")>();
  return { ...actual, assertServerAutoApplyAllowed: (...a: unknown[]) => assertServerAutoApplyAllowed(...a) };
});
vi.mock("@/lib/billing/apply-quota-guard", () => ({ readUserPlan: () => readUserPlan() }));
vi.mock("@/lib/vault/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/vault/store")>();
  return { ...actual, readSessionBlob: (...a: unknown[]) => readSessionBlob(...a) };
});
vi.mock("@/lib/vault/crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/vault/crypto")>();
  return { ...actual, decryptSession: () => decryptSession() };
});
vi.mock("@/lib/apply/login/session-provider", () => ({
  refreshSessionFromStoredCredential: (...a: unknown[]) => refreshSessionFromStoredCredential(...a),
  boardsWithCredentialLogin: () => ["jobinja", "irantalent"],
}));
vi.mock("@/lib/apply/boards/irantalent-apply", () => ({
  applyToIranTalent: (...a: unknown[]) => applyToIranTalent(...a),
}));
vi.mock("@/lib/fleet/dispatch", () => ({
  recordFleetResult: (...a: unknown[]) => recordFleetResult(...a),
}));

const { runIranTalentForUser } = await import("@/lib/fleet/irantalent-runner");

function withIranTalent(enabled: boolean) {
  return {
    ...EMPTY_APPLY_FILTERS,
    boardFilters: {
      ...EMPTY_APPLY_FILTERS.boardFilters,
      irantalent: { ...EMPTY_APPLY_FILTERS.boardFilters.irantalent, enabled },
    },
  };
}

const ITEM = {
  taskId: "11111111-1111-4111-8111-111111111111",
  listingId: "listing-1",
  coverLetter: "سلام",
  listing: { title: "Dev", company: "Acme", city: "تهران", url: "https://www.irantalent.com/job/dev/1" },
};

const deps = { fetchImpl: (async () => new Response("{}")) as unknown as typeof fetch };

beforeEach(() => {
  vi.clearAllMocks();
  readApplyFilters.mockResolvedValue(withIranTalent(true));
  assertServerAutoApplyAllowed.mockResolvedValue({ minScore: 0.7 });
  claimUserApplyItems.mockResolvedValue([]);
  readSessionBlob.mockResolvedValue({ ciphertext: "c", iv: "i", keyVersion: 1 });
  refreshSessionFromStoredCredential.mockResolvedValue(false);
  applyToIranTalent.mockResolvedValue({ status: "submitted", ranSteps: ["confirmed"] });
});

describe("provider and plan gates", () => {
  it("does nothing when the user has not enabled IranTalent", async () => {
    readApplyFilters.mockResolvedValue(withIranTalent(false));
    const summary = await runIranTalentForUser("u1", 3, deps);
    expect(summary.reasons).toHaveProperty("provider_disabled");
    expect(claimUserApplyItems).not.toHaveBeenCalled();
  });

  it("does nothing when the server auto-apply gate refuses", async () => {
    assertServerAutoApplyAllowed.mockRejectedValue(Object.assign(new Error("no"), { code: "disabled" }));
    const summary = await runIranTalentForUser("u1", 3, deps);
    expect(summary.attempted).toBe(0);
    expect(claimUserApplyItems).not.toHaveBeenCalled();
  });

  it("claims only IranTalent items without requiring a tailored resume", async () => {
    await runIranTalentForUser("u1", 3, deps);
    const options = claimUserApplyItems.mock.calls[0]![3] as {
      allowedBoards: string[];
      requireTailoredResume: boolean;
    };
    expect(options.allowedBoards).toEqual(["irantalent"]);
    expect(options.requireTailoredResume).toBe(false);
  });
});

describe("session acquisition", () => {
  it("logs in with the stored credential exactly once when the vault is empty", async () => {
    readSessionBlob.mockResolvedValueOnce(null).mockResolvedValue({ ciphertext: "c", iv: "i", keyVersion: 1 });
    refreshSessionFromStoredCredential.mockResolvedValue(true);
    claimUserApplyItems.mockResolvedValue([ITEM]);
    const summary = await runIranTalentForUser("u1", 3, deps);
    expect(refreshSessionFromStoredCredential).toHaveBeenCalledTimes(1);
    expect(summary.submitted).toBe(1);
  });

  it("stops cleanly when there is neither a session nor a usable credential", async () => {
    readSessionBlob.mockResolvedValue(null);
    claimUserApplyItems.mockResolvedValue([ITEM]);
    const summary = await runIranTalentForUser("u1", 3, deps);
    expect(summary.reasons).toHaveProperty("no_session");
    expect(applyToIranTalent).not.toHaveBeenCalled();
  });
});

describe("applying and reporting", () => {
  it("reports every outcome back to the queue", async () => {
    claimUserApplyItems.mockResolvedValue([ITEM]);
    applyToIranTalent.mockResolvedValue({ status: "skipped", reason: "irantalent_already_applied", ranSteps: [] });
    const summary = await runIranTalentForUser("u1", 3, deps);
    expect(summary.skipped).toBe(1);
    expect(applyToIranTalent.mock.calls[0]![0]).toEqual({
      session: "SESSION",
      jobUrl: ITEM.listing.url,
      coverLetter: "سلام",
    });
    expect(recordFleetResult).toHaveBeenCalledTimes(1);
    expect(recordFleetResult.mock.calls[0]![1]).toMatchObject({
      taskId: ITEM.taskId,
      userId: "u1",
      status: "skipped",
      reason: "irantalent_already_applied",
    });
  });

  it("stops the batch when the session dies mid-run", async () => {
    claimUserApplyItems.mockResolvedValue([ITEM, { ...ITEM, taskId: "22222222-2222-4222-8222-222222222222" }]);
    applyToIranTalent.mockResolvedValue({
      status: "failed", reason: "irantalent_login_required", ranSteps: [],
    });
    const summary = await runIranTalentForUser("u1", 3, deps);
    expect(applyToIranTalent).toHaveBeenCalledTimes(1);
    expect(summary.attempted).toBe(1);
  });
});
