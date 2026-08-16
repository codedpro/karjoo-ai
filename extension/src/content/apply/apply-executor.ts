/**
 * APPLY_SPEC step EXECUTOR (the ONLY impure part of background apply).
 *
 * Walks a resolved ApplyPlan (from apply-runner.buildApplyPlan) and drives the
 * board's PUBLIC apply form on the current page: click the apply button, wait for
 * the form, fill the cover letter, click submit, confirm success.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * §10 — what this is and is NOT:
 *   • It runs ONLY when the background runner (which already checked the toggle ON
 *     + daily cap + threshold) drives it. The content script does NOT decide on
 *     its own to apply.
 *   • It uses the user's OWN session in the user's OWN browser — it does not touch
 *     cookies/tokens, does not spoof anything, does not solve captchas, does not
 *     rotate identity. It just fills + submits the form the user could fill by hand.
 *   • For "scaffold" boards (jobvision/e-estekhdam/irantalent) the selectors are
 *     placeholders → the executor will simply not find them and report a failure
 *     (it never blindly clicks). Real submit awaits TODO(real-account) selectors.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * The fill primitive is shared with the assisted path (apply-dom.ts): it sets the
 * value framework-friendly and dispatches input/change so SPA frameworks register.
 */
import type { ResolvedApplyStep, ApplyPlan } from "@ext/lib/apply-runner";

export interface ExecuteResult {
  /** Did the flow reach (and confirm, when a confirmSelector exists) submission? */
  ok: boolean;
  /** Which step kinds/selectors ran (for a non-secret debug trail). */
  ranSteps: string[];
  /** Short, non-secret reason on failure (e.g. "selector not found: …"). */
  reason?: string;
}

/** Options (injectable for tests: a fake document + immediate timers). */
export interface ExecuteOptions {
  doc?: Document;
  /** Per-`waitFor` timeout (ms). */
  stepTimeoutMs?: number;
  /** Poll interval while waiting (ms). */
  pollMs?: number;
  /** Injectable sleeper (tests pass an immediate one). */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable clock (tests control elapsed time). */
  now?: () => number;
  /** Injectable PDF attachment primitive for DOM-only tests. */
  uploadPdf?: (input: HTMLInputElement, dataUrl: string, fileName: string) => void;
}

const DEFAULT_TIMEOUT = 15_000;
const DEFAULT_POLL = 200;

function realSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function uploadPdf(input: HTMLInputElement, dataUrl: string, fileName: string): void {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const file = new File([bytes], fileName, { type: "application/pdf" });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
}

/**
 * Realm-safe element-kind checks by tagName. We deliberately avoid
 * `instanceof HTMLInputElement` because the content script and the test realm
 * (linkedom) provide DIFFERENT constructor objects — tagName is stable in both.
 */
function tagOf(el: Element | null): string {
  return el?.tagName ? el.tagName.toUpperCase() : "";
}
function isFillable(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  const t = tagOf(el);
  return t === "INPUT" || t === "TEXTAREA";
}
function isSelect(el: Element | null): el is HTMLSelectElement {
  return tagOf(el) === "SELECT";
}

/**
 * Dispatch a bubbling DOM event using the element's OWN realm `Event` constructor
 * (linkedom in tests provides its own; the real browser has the global). Falls
 * back to the global `Event`. Realm-safe so the same code runs in both.
 */
function dispatch(el: Element, type: string): void {
  const win = (el.ownerDocument?.defaultView ?? undefined) as
    | (Window & typeof globalThis)
    | undefined;
  const Ctor =
    win?.Event ?? (typeof Event !== "undefined" ? Event : undefined);
  if (!Ctor) return;
  el.dispatchEvent(new Ctor(type, { bubbles: true }));
}

/** Set an input/textarea value framework-friendly + dispatch input/change. */
function setFieldValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  // Use the prototype value setter when available (so React/Vue's value tracker
  // sees the change), via the element's OWN realm prototype. Fall back to a plain
  // assignment when the descriptor is not present (e.g. linkedom in tests).
  const proto = Object.getPrototypeOf(el) as object;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  dispatch(el, "input");
  dispatch(el, "change");
}

/** Resolve the first selector (comma-list aware via querySelector) in the doc. */
function find(doc: Document, selector: string): Element | null {
  try {
    return doc.querySelector(selector);
  } catch {
    return null;
  }
}

/** Wait until `selector` exists (or timeout). Uses injected sleep/now for tests. */
async function waitFor(
  doc: Document,
  selector: string,
  opts: Required<Pick<ExecuteOptions, "stepTimeoutMs" | "pollMs" | "sleep" | "now">>,
): Promise<Element | null> {
  const deadline = opts.now() + opts.stepTimeoutMs;
  // Fast path: already there.
  let el = find(doc, selector);
  if (el) return el;
  while (opts.now() < deadline) {
    await opts.sleep(opts.pollMs);
    el = find(doc, selector);
    if (el) return el;
  }
  return find(doc, selector);
}

/**
 * Execute a resolved apply plan against the page. Returns ok=true only if every
 * required step succeeded AND (when the spec has a confirm step) the confirmation
 * appeared. A missing REQUIRED selector aborts with ok=false — we never submit a
 * form we could not properly fill, and we never "guess" past a missing button.
 */
export async function executeApplyPlan(
  plan: ApplyPlan,
  options: ExecuteOptions = {},
): Promise<ExecuteResult> {
  const doc = options.doc ?? document;
  const opts = {
    stepTimeoutMs: options.stepTimeoutMs ?? DEFAULT_TIMEOUT,
    pollMs: options.pollMs ?? DEFAULT_POLL,
    sleep: options.sleep ?? realSleep,
    now: options.now ?? (() => Date.now()),
    uploadPdf: options.uploadPdf ?? uploadPdf,
  };

  const ranSteps: string[] = [];

  const pageText = (doc.body?.textContent ?? "").toLowerCase();
  if (
    pageText.includes("checking your browser before accessing") ||
    pageText.includes("complete the security check") ||
    pageText.includes("recaptcha") ||
    pageText.includes("بررسی امنیتی")
  ) {
    return { ok: false, ranSteps, reason: "jobinja_security_check: security challenge is active" };
  }
  if (doc.querySelector("form[action*='/login'] input[type='password']")) {
    return { ok: false, ranSteps, reason: "jobinja_login_required: sign in to Jobinja" };
  }

  for (const step of plan.steps) {
    const label = `${step.kind}:${step.selector}`;
    const result = await runStep(doc, step, opts);
    ranSteps.push(label);
    if (!result.ok) {
      // Optional step that simply was not present → keep going.
      if (result.skipped) continue;
      return { ok: false, ranSteps, reason: result.reason ?? `step failed: ${label}` };
    }
  }

  return { ok: true, ranSteps };
}

interface StepResult {
  ok: boolean;
  /** The step was optional and absent → not a failure, just skip. */
  skipped?: boolean;
  reason?: string;
}

async function runStep(
  doc: Document,
  step: ResolvedApplyStep,
  opts: Required<Pick<ExecuteOptions, "stepTimeoutMs" | "pollMs" | "sleep" | "now" | "uploadPdf">>,
): Promise<StepResult> {
  switch (step.kind) {
    case "waitFor": {
      const el = await waitFor(doc, step.selector, opts);
      if (el) return { ok: true };
      if (step.optional) return { ok: false, skipped: true };
      return { ok: false, reason: `waitFor timeout: ${step.selector}` };
    }
    case "click": {
      const el = find(doc, step.selector);
      if (!el) {
        if (step.optional) return { ok: false, skipped: true };
        return { ok: false, reason: `selector not found: ${step.selector}` };
      }
      (el as unknown as { click: () => void }).click();
      return { ok: true };
    }
    case "fill": {
      const el = find(doc, step.selector);
      if (!isFillable(el)) {
        if (step.optional) return { ok: false, skipped: true };
        return { ok: false, reason: `fill target not found: ${step.selector}` };
      }
      if (step.value === undefined) {
        if (step.optional) return { ok: false, skipped: true };
        return { ok: false, reason: `no value for fill: ${step.selector}` };
      }
      setFieldValue(el, step.value);
      return { ok: true };
    }
    case "select": {
      const el = find(doc, step.selector);
      if (!isSelect(el)) {
        if (step.optional) return { ok: false, skipped: true };
        return { ok: false, reason: `select target not found: ${step.selector}` };
      }
      if (step.value !== undefined) {
        el.value = step.value;
        dispatch(el, "change");
      }
      return { ok: true };
    }
    case "upload": {
      const el = find(doc, step.selector);
      if (!isFillable(el) || tagOf(el) !== "INPUT") {
        if (step.optional) return { ok: false, skipped: true };
        return { ok: false, reason: `resume_upload_failed: input not found: ${step.selector}` };
      }
      if (!step.value?.startsWith("data:application/pdf;base64,")) {
        return { ok: false, reason: "resume_upload_failed: PDF bytes are missing" };
      }
      try {
        opts.uploadPdf(el as HTMLInputElement, step.value, step.fileName ?? "resume.pdf");
        dispatch(el, "input");
        dispatch(el, "change");
        if ((el as HTMLInputElement).files?.length !== 1) {
          return { ok: false, reason: "resume_upload_failed: browser rejected the file" };
        }
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          reason: `resume_upload_failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }
    default: {
      const _exhaustive: never = step.kind;
      return { ok: false, reason: `unknown step: ${String(_exhaustive)}` };
    }
  }
}
