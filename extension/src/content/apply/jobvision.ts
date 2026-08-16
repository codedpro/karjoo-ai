import type { BackgroundToContent, ContentApplyResult } from "@ext/lib/messages";

const APPLY_SELECTOR = ".jvt-btn-send-resume, button[class*='send-resume']";

function pageText(): string {
  return document.body?.innerText?.replace(/\s+/g, " ").trim() ?? "";
}

function visibleButtons(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].filter((button) =>
    button.offsetParent !== null && !button.disabled,
  );
}

function buttonWithText(pattern: RegExp): HTMLButtonElement | undefined {
  return visibleButtons().find((button) => pattern.test(button.innerText.replace(/\s+/g, " ").trim()));
}

async function waitForOutcome(timeoutMs = 15_000): Promise<ContentApplyResult> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const text = pageText();
    if (/\/post-apply(?:\/|$)/.test(location.pathname) || /رزومه.{0,20}(?:ارسال شد|ارسال شده|با موفقیت ارسال)/.test(text)) {
      return { ok: true, ranSteps: ["native-apply", "confirmed"] };
    }
    if (/captcha|کپچا|من ربات نیستم|بررسی امنیتی|تأیید کنید انسان/.test(text.toLowerCase())) {
      return { ok: false, ranSteps: ["native-apply"], reason: "jobvision_captcha_required" };
    }
    const personalResume = buttonWithText(/ارسال رزومه شخصی/);
    if (personalResume) {
      personalResume.click();
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
    if (document.querySelector("input[type='file']") && !personalResume) {
      return { ok: false, ranSteps: ["native-apply"], reason: "jobvision_resume_setup_required" };
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  return { ok: false, ranSteps: ["native-apply"], reason: "jobvision_apply_unconfirmed" };
}

export async function executeJobvisionApply(): Promise<ContentApplyResult> {
  const text = pageText();
  if (/captcha|کپچا|من ربات نیستم|بررسی امنیتی/.test(text.toLowerCase())) {
    return { ok: false, ranSteps: [], reason: "jobvision_captcha_required" };
  }
  if (/رزومه.{0,20}(?:ارسال شد|ارسال شده)/.test(text) || /\/post-apply(?:\/|$)/.test(location.pathname)) {
    return { ok: true, alreadyApplied: true, ranSteps: ["already-applied"] };
  }
  const apply = document.querySelector<HTMLButtonElement>(APPLY_SELECTOR) ?? buttonWithText(/^ارسال رزومه$/);
  if (!apply) {
    if (buttonWithText(/ورود|ثبت.?نام/)) return { ok: false, ranSteps: [], reason: "jobvision_login_required" };
    return { ok: false, ranSteps: [], reason: "jobvision_apply_button_missing" };
  }
  apply.click();
  return waitForOutcome();
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener(
    (msg: BackgroundToContent, _sender, sendResponse: (result: ContentApplyResult) => void) => {
      if (msg.type !== "CONTENT_APPLY" || msg.plan.board !== "jobvision") return undefined;
      executeJobvisionApply().then(sendResponse).catch((error: unknown) => sendResponse({
        ok: false,
        ranSteps: [],
        reason: error instanceof Error ? error.message : String(error),
      }));
      return true;
    },
  );
}
