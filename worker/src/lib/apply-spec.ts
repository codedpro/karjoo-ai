/**
 * Worker-side APPLY_SPEC — MIRRORS src/lib/apply/apply-spec.ts (the control-plane
 * source of truth) so the node fills+submits the SAME way the extension does.
 *
 * This is a PURE DATA map (no network/DB/secret): "where to click / what field to
 * fill" as CSS selectors. The actual fill/submit is the executor's job (the
 * Playwright runner). jobinja is "best-effort real"; the others are SCAFFOLD with
 * TODO(real-account) — their authenticated submit form can't be verified without a
 * real account, so the runner refuses to submit on scaffold boards (records a
 * 'skipped' instead of blindly clicking).
 *
 * §10 FIRM LINE: nothing here defeats bot-detection. These are just the public
 * form selectors, filled with the user's OWN drafted data, submitted with the
 * user's OWN session — acting as the authorized user, not evasion.
 *
 * Kept in sync manually with the control-plane spec (the two packages don't share
 * a module). The apply-spec.test.ts asserts the jobinja selectors match.
 */

/** Board ids that have an APPLY_SPEC — aligned with the control-plane registry. */
export type ApplyBoardId = "jobinja" | "jobvision" | "e-estekhdam" | "irantalent";

/** The kind of an interactive step in the apply flow. */
export type ApplyStepKind = "click" | "fill" | "select" | "upload" | "waitFor";

/** Where a fill/select/upload step's value comes from (resolved by the executor). */
export type ApplyValueKey =
  | "coverLetter"
  | "resumeFile"
  | "fullName"
  | "phone"
  | "email";

/** A single step of the apply flow (declarative, interpreted by the executor). */
export interface ApplyStep {
  kind: ApplyStepKind;
  /** Target CSS selector. */
  selector: string;
  /** For fill/select/upload: which value the executor injects. */
  valueKey?: ApplyValueKey;
  /** Human note for logs/debug. */
  note?: string;
  /** Whether a missing selector is an error or an optional step. */
  optional?: boolean;
}

/** The full apply spec for one board — the shared executor contract. */
export interface BoardApplySpec {
  board: ApplyBoardId;
  /**
   *  • "best-effort" — selectors are based on the real form structure (jobinja).
   *  • "scaffold"    — placeholder selectors; must be verified with a real account.
   */
  maturity: "best-effort" | "scaffold";
  /** URL pattern this spec applies to. */
  urlPattern: RegExp;
  /** Button that starts the apply flow on the listing page. */
  applyButtonSelector: string;
  /** Cover-letter field (optional — not every board has one). */
  coverLetterFieldSelector?: string;
  /** Final submit button. */
  submitSelector: string;
  /** Success-state selector to confirm the result. */
  confirmSelector?: string;
  /** Ordered steps (executor runs them in order). */
  steps: ApplyStep[];
  /** Implementation notes/warnings. */
  notes?: string[];
}

/* ──────────────────────────────  jobinja  ──────────────────────────────── */
const JOBINJA_SPEC: BoardApplySpec = {
  board: "jobinja",
  maturity: "best-effort",
  urlPattern: /^https:\/\/jobinja\.ir\/companies\/[^/]+\/jobs\/[A-Za-z0-9]+/,
  applyButtonSelector: "a.c-jobView__applyButton, button.c-jobView__applyButton",
  coverLetterFieldSelector:
    "textarea[name='application[body]'], textarea.c-applyForm__message",
  submitSelector:
    "form.c-applyForm button[type='submit'], button.c-applyForm__submit",
  confirmSelector: ".c-applyForm__success, .c-flashMessage--success",
  steps: [
    {
      kind: "click",
      selector: "a.c-jobView__applyButton, button.c-jobView__applyButton",
      note: "Open the resume-submit form.",
    },
    {
      kind: "waitFor",
      selector: "form.c-applyForm",
      note: "Wait for the apply form to render.",
    },
    {
      kind: "fill",
      selector:
        "textarea[name='application[body]'], textarea.c-applyForm__message",
      valueKey: "coverLetter",
      optional: true,
      note: "Cover letter — filled if the field is present.",
    },
    {
      kind: "click",
      selector:
        "form.c-applyForm button[type='submit'], button.c-applyForm__submit",
      note: "Final submit.",
    },
    {
      kind: "waitFor",
      selector: ".c-applyForm__success, .c-flashMessage--success",
      note: "Confirm the submit succeeded.",
    },
  ],
  notes: [
    "Uses the user's OWN cookie session (sessionShape=cookie).",
    "Selectors are best-effort; verify against a real jobinja account before GA.",
  ],
};

/* ──────────────────────────────  jobvision  ─────────────────────────────── */
const JOBVISION_SPEC: BoardApplySpec = {
  board: "jobvision",
  maturity: "scaffold",
  urlPattern: /^https:\/\/(www\.)?jobvision\.ir\/jobs\/\d+/,
  // TODO(real-account): real jobvision "submit resume" selectors.
  applyButtonSelector: "[data-test='apply-button']",
  coverLetterFieldSelector: "[data-test='cover-letter']",
  submitSelector: "[data-test='apply-submit']",
  confirmSelector: "[data-test='apply-success']",
  steps: [
    { kind: "click", selector: "[data-test='apply-button']", note: "TODO(real-account): start apply." },
    { kind: "waitFor", selector: "[data-test='apply-form']", note: "TODO(real-account): wait for SPA form." },
    {
      kind: "fill",
      selector: "[data-test='cover-letter']",
      valueKey: "coverLetter",
      optional: true,
      note: "TODO(real-account): cover-letter field.",
    },
    { kind: "click", selector: "[data-test='apply-submit']", note: "TODO(real-account): final submit." },
  ],
  notes: [
    "SPA with token in localStorage (sessionShape=token).",
    "TODO(real-account): verify all selectors against a real jobvision account.",
  ],
};

/* ────────────────────────────  e-estekhdam  ─────────────────────────────── */
const E_ESTEKHDAM_SPEC: BoardApplySpec = {
  board: "e-estekhdam",
  maturity: "scaffold",
  urlPattern: /^https:\/\/(www\.)?e-estekhdam\.com\/.+/,
  // TODO(real-account): real e-estekhdam apply-form selectors.
  applyButtonSelector: ".job-apply-btn",
  coverLetterFieldSelector: "textarea[name='message']",
  submitSelector: "form.apply-form button[type='submit']",
  confirmSelector: ".apply-success",
  steps: [
    { kind: "click", selector: ".job-apply-btn", note: "TODO(real-account): start apply (structured listing)." },
    {
      kind: "fill",
      selector: "textarea[name='message']",
      valueKey: "coverLetter",
      optional: true,
      note: "TODO(real-account): message/cover letter.",
    },
    { kind: "click", selector: "form.apply-form button[type='submit']", note: "TODO(real-account): submit." },
  ],
  notes: [
    "Many listings are contact-in-text (applyType=contact); this flow does not apply to them.",
    "TODO(real-account): verify selectors against a real account.",
  ],
};

/* ────────────────────────────  irantalent  ─────────────────────────────── */
const IRANTALENT_SPEC: BoardApplySpec = {
  board: "irantalent",
  maturity: "scaffold",
  urlPattern: /^https:\/\/(www\.)?irantalent\.com\/.+/,
  // TODO(real-account): real irantalent apply-form selectors.
  applyButtonSelector: "[data-qa='apply-button']",
  coverLetterFieldSelector: "[data-qa='cover-letter']",
  submitSelector: "[data-qa='apply-submit']",
  confirmSelector: "[data-qa='apply-success']",
  steps: [
    { kind: "click", selector: "[data-qa='apply-button']", note: "TODO(real-account): start apply." },
    { kind: "waitFor", selector: "[data-qa='apply-form']", note: "TODO(real-account): wait for form." },
    {
      kind: "fill",
      selector: "[data-qa='cover-letter']",
      valueKey: "coverLetter",
      optional: true,
      note: "TODO(real-account): cover letter.",
    },
    { kind: "click", selector: "[data-qa='apply-submit']", note: "TODO(real-account): submit." },
  ],
  notes: [
    "Session/form shape TBD (architecture §7).",
    "TODO(real-account): verify all selectors against a real account.",
  ],
};

/** The full board → spec map (source of truth for the node's executor). */
export const APPLY_SPEC: Record<ApplyBoardId, BoardApplySpec> = {
  jobinja: JOBINJA_SPEC,
  jobvision: JOBVISION_SPEC,
  "e-estekhdam": E_ESTEKHDAM_SPEC,
  irantalent: IRANTALENT_SPEC,
};

/** Return a board's apply spec, or undefined when unsupported. */
export function getApplySpec(board: string): BoardApplySpec | undefined {
  return APPLY_SPEC[board as ApplyBoardId];
}

/** True when we have a "best-effort real" spec (vs a mere scaffold). */
export function isApplySpecReady(board: string): boolean {
  return getApplySpec(board)?.maturity === "best-effort";
}

/** Which spec a URL matches (first match wins). */
export function matchApplySpecByUrl(url: string): BoardApplySpec | undefined {
  for (const spec of Object.values(APPLY_SPEC)) {
    if (spec.urlPattern.test(url)) return spec;
  }
  return undefined;
}
