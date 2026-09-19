/**
 * Server-side apply runner tests — the ROUTING guarantees, for all three
 * control-plane boards.
 *
 * What matters here is what differs per board, because getting it wrong is silent:
 *   • Karboom and e-estekhdam upload a per-job PDF, so they must claim only tasks
 *     that already have a tailored résumé and must be handed the rendered file.
 *   • IranTalent sends the résumé from its own profile, so it must NOT require one
 *     and must NOT pay for a PDF render.
 *   • A board the user turned off, or a closed plan gate, does nothing at all.
 *   • Every outcome is reported back to the queue under that board's runner node.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EMPTY_APPLY_FILTERS } from "@/lib/apply/filters";
import { testEntitlements } from "@/lib/billing/entitlements";

const readApplyFilters = vi.fn<(...a: unknown[]) => Promise<unknown>>();
const claimUserApplyItems = vi.fn<(...a: unknown[]) => Promise<unknown[]>>(() => Promise.resolve([]));
const assertServerAutoApplyAllowed = vi.fn<(...a: unknown[]) => Promise<{ minScore: number }>>();
const readUserEntitlements = vi.fn(async () =>
  testEntitlements({ unlimitedApplies: true, workerIpLimit: 1, status: "active" }),
);
const readSessionBlob = vi.fn<(...a: unknown[]) => Promise<Record<string, unknown> | null>>();
const refreshSessionFromStoredCredential = vi.fn<(...a: unknown[]) => Promise<boolean>>();
const applyToIranTalent = vi.fn<(...a: unknown[]) => Promise<unknown>>();
const applyToKarboom = vi.fn<(...a: unknown[]) => Promise<unknown>>();
const applyToEEstekhdam = vi.fn<(...a: unknown[]) => Promise<unknown>>();
const recordFleetResult = vi.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({}));
const defaultLoadResumeHtml = vi.fn<(...a: unknown[]) => Promise<string | null>>();
const buildResumeFileName = vi.fn<(...a: unknown[]) => Promise<string | null>>();
const renderResumePdf = vi.fn<(...a: unknown[]) => Promise<Uint8Array>>();

vi.mock("@/lib/apply/filters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/apply/filters")>();
  return { ...actual, readApplyFilters: (...a: unknown[]) => readApplyFilters(...a) };
});
vi.mock("@/lib/apply/extension-queue", () => ({
  claimUserApplyItems: (...a: unknown[]) => claimUserApplyItems(...a),
}));
vi.mock("@/lib/apply/auto-apply", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/apply/auto-apply")>();
  return {
    ...actual,
    assertServerAutoApplyAllowed: (...a: unknown[]) => assertServerAutoApplyAllowed(...a),
  };
});
vi.mock("@/lib/billing/apply-quota-guard", () => ({
  readUserEntitlements: () => readUserEntitlements(),
}));
vi.mock("@/lib/vault/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/vault/store")>();
  return { ...actual, readSessionBlob: (...a: unknown[]) => readSessionBlob(...a) };
});
vi.mock("@/lib/vault/crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/vault/crypto")>();
  return { ...actual, decryptSession: () => "SESSION" };
});
vi.mock("@/lib/apply/login/session-provider", () => ({
  refreshSessionFromStoredCredential: (...a: unknown[]) => refreshSessionFromStoredCredential(...a),
  boardsWithCredentialLogin: () => ["jobinja", "irantalent"],
}));
vi.mock("@/lib/apply/boards/irantalent-apply", () => ({
  applyToIranTalent: (...a: unknown[]) => applyToIranTalent(...a),
}));
vi.mock("@/lib/apply/boards/karboom-apply", () => ({
  applyToKarboom: (...a: unknown[]) => applyToKarboom(...a),
}));
vi.mock("@/lib/apply/boards/eestekhdam-apply", () => ({
  applyToEEstekhdam: (...a: unknown[]) => applyToEEstekhdam(...a),
}));
vi.mock("@/lib/fleet/dispatch", () => ({
  recordFleetResult: (...a: unknown[]) => recordFleetResult(...a),
  defaultLoadResumeHtml: (...a: unknown[]) => defaultLoadResumeHtml(...a),
  buildResumeFileName: (...a: unknown[]) => buildResumeFileName(...a),
}));
vi.mock("@/lib/resume/pdf-renderer", () => ({
  renderResumePdf: (...a: unknown[]) => renderResumePdf(...a),
}));

const { runServerApplyForUser, controlPlaneApplyBoards } = await import(
  "@/lib/fleet/server-apply-runner"
);

type Board = "karboom" | "e-estekhdam" | "irantalent";

function filtersWith(board: Board, enabled: boolean) {
  return {
    ...EMPTY_APPLY_FILTERS,
    boardFilters: {
      ...EMPTY_APPLY_FILTERS.boardFilters,
      [board]: { ...EMPTY_APPLY_FILTERS.boardFilters[board], enabled },
    },
  };
}

function item(board: Board) {
  return {
    taskId: "11111111-1111-4111-8111-111111111111",
    listingId: "listing-1",
    board,
    coverLetter: "سلام",
    listing: {
      title: "برنامه‌نویس بک‌اند",
      company: "Acme",
      city: "تهران",
      url: `https://${board}.example/job/1`,
    },
  };
}

const PDF = new Uint8Array([37, 80, 68, 70]);
const USER = "user-1";

beforeEach(() => {
  vi.clearAllMocks();
  assertServerAutoApplyAllowed.mockResolvedValue({ minScore: 0.7 });
  claimUserApplyItems.mockResolvedValue([]);
  readSessionBlob.mockResolvedValue({ ciphertext: "c", iv: "i", keyVersion: 1 });
  refreshSessionFromStoredCredential.mockResolvedValue(false);
  defaultLoadResumeHtml.mockResolvedValue("<html>résumé</html>");
  buildResumeFileName.mockResolvedValue("Ali Karimi_Acme.pdf");
  renderResumePdf.mockResolvedValue(PDF);
  for (const fn of [applyToKarboom, applyToEEstekhdam, applyToIranTalent]) {
    fn.mockResolvedValue({ status: "submitted", ranSteps: ["confirmed"] });
  }
});

describe("the control-plane board set", () => {
  it("is exactly the three HTTP boards", () => {
    expect(controlPlaneApplyBoards().sort()).toEqual(
      ["e-estekhdam", "irantalent", "karboom"].sort(),
    );
  });
});

describe("gates", () => {
  it("does nothing when the user has that board switched off", async () => {
    readApplyFilters.mockResolvedValue(filtersWith("karboom", false));
    const summary = await runServerApplyForUser(USER, "karboom", 3);
    expect(summary.attempted).toBe(0);
    expect(summary.reasons).toEqual({ provider_disabled: 1 });
    expect(claimUserApplyItems).not.toHaveBeenCalled();
  });

  it("does nothing for a board with no control-plane executor", async () => {
    readApplyFilters.mockResolvedValue(filtersWith("karboom", true));
    const summary = await runServerApplyForUser(USER, "jobinja", 3);
    expect(summary.attempted).toBe(0);
    expect(claimUserApplyItems).not.toHaveBeenCalled();
  });

  it("never applies without a session", async () => {
    readApplyFilters.mockResolvedValue(filtersWith("karboom", true));
    claimUserApplyItems.mockResolvedValue([item("karboom")]);
    readSessionBlob.mockResolvedValue(null);

    const summary = await runServerApplyForUser(USER, "karboom", 3);
    expect(summary.reasons).toEqual({ no_session: 1 });
    expect(applyToKarboom).not.toHaveBeenCalled();
  });
});

describe("per-board résumé handling", () => {
  it("hands Karboom the rendered per-job PDF and claims only résumé-ready tasks", async () => {
    readApplyFilters.mockResolvedValue(filtersWith("karboom", true));
    claimUserApplyItems.mockResolvedValue([item("karboom")]);

    const summary = await runServerApplyForUser(USER, "karboom", 3);

    expect(claimUserApplyItems).toHaveBeenCalledWith(
      USER,
      3,
      expect.anything(),
      expect.objectContaining({ requireTailoredResume: true, allowedBoards: ["karboom"] }),
    );
    expect(applyToKarboom).toHaveBeenCalledWith(
      expect.objectContaining({
        session: "SESSION",
        resumePdf: PDF,
        resumeFileName: "Ali Karimi_Acme.pdf",
        coverLetter: "سلام",
      }),
    );
    expect(summary.submitted).toBe(1);
  });

  it("passes e-estekhdam the listing title so it can pick the right position", async () => {
    readApplyFilters.mockResolvedValue(filtersWith("e-estekhdam", true));
    claimUserApplyItems.mockResolvedValue([item("e-estekhdam")]);

    await runServerApplyForUser(USER, "e-estekhdam", 3);

    expect(applyToEEstekhdam).toHaveBeenCalledWith(
      expect.objectContaining({ jobTitle: "برنامه‌نویس بک‌اند", resumePdf: PDF }),
    );
  });

  it("does not render a PDF for IranTalent (it sends its own profile CV)", async () => {
    readApplyFilters.mockResolvedValue(filtersWith("irantalent", true));
    claimUserApplyItems.mockResolvedValue([item("irantalent")]);

    await runServerApplyForUser(USER, "irantalent", 3);

    expect(renderResumePdf).not.toHaveBeenCalled();
    expect(claimUserApplyItems).toHaveBeenCalledWith(
      USER,
      3,
      expect.anything(),
      expect.objectContaining({ requireTailoredResume: false }),
    );
  });

  it("skips rather than substituting a different résumé when the render fails", async () => {
    readApplyFilters.mockResolvedValue(filtersWith("karboom", true));
    claimUserApplyItems.mockResolvedValue([item("karboom")]);
    renderResumePdf.mockRejectedValue(new Error("no chromium"));

    const summary = await runServerApplyForUser(USER, "karboom", 3);

    expect(applyToKarboom).not.toHaveBeenCalled();
    expect(summary.skipped).toBe(1);
    expect(summary.reasons).toEqual({ tailored_resume_missing: 1 });
  });
});

describe("reporting", () => {
  it("reports each outcome under that board's control-plane node", async () => {
    readApplyFilters.mockResolvedValue(filtersWith("karboom", true));
    claimUserApplyItems.mockResolvedValue([item("karboom")]);
    applyToKarboom.mockResolvedValue({
      status: "submitted",
      ranSteps: ["confirmed"],
      proof: { provider: "karboom", signal: "wizard_done" },
    });

    await runServerApplyForUser(USER, "karboom", 3);

    expect(recordFleetResult).toHaveBeenCalledWith(
      "control-plane:karboom",
      expect.objectContaining({
        taskId: item("karboom").taskId,
        userId: USER,
        status: "submitted",
        proof: { provider: "karboom", signal: "wizard_done" },
      }),
      expect.anything(),
    );
  });

  it("stops the batch once the session is gone instead of burning the queue", async () => {
    readApplyFilters.mockResolvedValue(filtersWith("karboom", true));
    claimUserApplyItems.mockResolvedValue([item("karboom"), item("karboom"), item("karboom")]);
    applyToKarboom.mockResolvedValue({
      status: "failed",
      reason: "karboom_login_required",
      ranSteps: [],
    });

    const summary = await runServerApplyForUser(USER, "karboom", 3);

    expect(applyToKarboom).toHaveBeenCalledTimes(1);
    expect(summary.attempted).toBe(1);
    expect(summary.failed).toBe(1);
  });
});
