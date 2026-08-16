import { parseHTML } from "linkedom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { executeJobvisionApply } from "@ext/content/apply/jobvision";

afterEach(() => vi.unstubAllGlobals());

describe("JobVision native apply adapter", () => {
  it("clicks the real native apply button and confirms rendered success", async () => {
    const { document } = parseHTML("<html><body><button class='jvt-btn-send-resume'>ارسال رزومه</button></body></html>");
    document.querySelector("button")!.addEventListener("click", () => {
      document.body.textContent = "رزومه با موفقیت ارسال شد";
    });
    vi.stubGlobal("document", document);
    vi.stubGlobal("location", { pathname: "/jobs/123" });
    await expect(executeJobvisionApply()).resolves.toMatchObject({ ok: true });
  });

  it("does not submit when no native apply control exists", async () => {
    const { document } = parseHTML("<html><body><main>آگهی شغلی</main></body></html>");
    vi.stubGlobal("document", document);
    vi.stubGlobal("location", { pathname: "/jobs/123" });
    await expect(executeJobvisionApply()).resolves.toMatchObject({
      ok: false,
      reason: "jobvision_apply_button_missing",
    });
  });

  it("reconciles an existing board application without clicking submit", async () => {
    const { document } = parseHTML("<html><body>رزومه ارسال شده</body></html>");
    vi.stubGlobal("document", document);
    vi.stubGlobal("location", { pathname: "/jobs/123" });
    await expect(executeJobvisionApply()).resolves.toMatchObject({
      ok: true,
      alreadyApplied: true,
    });
  });
});
