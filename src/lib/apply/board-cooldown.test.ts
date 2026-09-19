/**
 * Board-cooldown classifier tests.
 *
 * The classifier decides whether a failure means "this listing didn't work out"
 * or "the board just pushed back on us". Getting that wrong is expensive in both
 * directions: too eager and one dead ad freezes a user's queue for six hours;
 * too lax and we keep hammering a board that has already shown us a captcha,
 * which is the pattern that actually gets an account flagged.
 *
 * The reason strings here are the literal ones the board adapters produce.
 */
import { describe, expect, it } from "vitest";

import {
  BOARD_COOLDOWN_MINUTES,
  classifyBoardRefusal,
  COOLDOWN_MARKER,
} from "@/lib/apply/board-cooldown";

describe("classifyBoardRefusal — security checks", () => {
  it("catches every adapter's challenge wording", () => {
    for (const reason of [
      "jobinja_security_check: cloudflare",
      "jobvision_captcha_required",
      "eestekhdam_captcha_required",
      "eestekhdam_security_challenge",
      "403 بررسی امنیتی mosparo",
      "لطفاً تأیید کنید انسان هستید — من ربات نیستم",
    ]) {
      expect(classifyBoardRefusal(reason), reason).toBe("security_check");
    }
  });
});

describe("classifyBoardRefusal — rate limits", () => {
  it("catches status-code and worded rate limits", () => {
    for (const reason of [
      "karboom_step_failed: job_status 429",
      "rate limit exceeded",
      "Too Many Requests",
      "محدودیت درخواست",
    ]) {
      expect(classifyBoardRefusal(reason), reason).toBe("rate_limited");
    }
  });
});

describe("classifyBoardRefusal — rejected sessions", () => {
  it("catches every board's login_required", () => {
    for (const reason of [
      "karboom_login_required",
      "eestekhdam_login_required",
      "irantalent_login_required",
      "jobvision_login_required",
      "401 unauthorized",
    ]) {
      expect(classifyBoardRefusal(reason), reason).toBe("session_rejected");
    }
  });
});

describe("classifyBoardRefusal — everything that must NOT freeze the queue", () => {
  it("ignores ordinary per-listing outcomes", () => {
    for (const reason of [
      undefined,
      null,
      "",
      // The ad simply cannot be applied to on-site.
      "this listing has no on-site apply form (external/email apply)",
      "karboom_job_closed",
      "eestekhdam_external_apply_only",
      "eestekhdam_position_required",
      "eestekhdam_gender_mismatch",
      // Our own side of things — retrying is fine and costs the board nothing.
      "tailored_resume_missing",
      "jobvision_resume_setup_required",
      "already_applied_on_board",
      "selector not found: #apply-form",
      // A profile gap is the user's to fix; it is not the board pushing back.
      "karboom_profile_incomplete: personal_info",
    ]) {
      expect(classifyBoardRefusal(reason as string | null | undefined), String(reason)).toBeNull();
    }
  });

  it("does not read a 404 or a 500 as a rate limit", () => {
    expect(classifyBoardRefusal("karboom_step_unavailable: final 404")).toBeNull();
    expect(classifyBoardRefusal("karboom_step_failed: options 500")).toBeNull();
    // 4290 is not 429 — the word boundary matters.
    expect(classifyBoardRefusal("karboom_step_failed: options 4290")).toBeNull();
  });
});

describe("cooldown policy", () => {
  it("backs off hardest on a security check", () => {
    expect(BOARD_COOLDOWN_MINUTES.security_check).toBeGreaterThan(
      BOARD_COOLDOWN_MINUTES.rate_limited,
    );
    expect(BOARD_COOLDOWN_MINUTES.security_check).toBeGreaterThanOrEqual(60);
  });

  it("marks deferred tasks so the pause can be lifted again", () => {
    // clearBoardCooldown only releases tasks carrying this marker, so an
    // unmarked deferral (a missing résumé, say) is never cleared by accident.
    expect(COOLDOWN_MARKER.endsWith(":")).toBe(true);
    expect(`${COOLDOWN_MARKER}security_check`).toMatch(/^board_cooldown:/);
  });
});
