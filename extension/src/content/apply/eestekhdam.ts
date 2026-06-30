/**
 * e-estekhdam APPLY content script — SCAFFOLD (TODO(real-account)).
 *
 * Registers the APPLY_SPEC executor for e-estekhdam. Many e-estekhdam postings
 * are "contact-in-text" (apply = sending a message), so the structured apply flow
 * only applies to postings that have a real form. The apply-spec.ts selectors are
 * PLACEHOLDERS — until verified against a real account, the executor reports a
 * graceful failure rather than guessing.
 *
 * §10: no detection-evasion; the user's own cookie session in the user's browser.
 */
import { registerApplyHandler } from "@ext/content/apply/register";

// TODO(real-account): verify e-estekhdam apply selectors in apply-spec.ts.
registerApplyHandler("e-estekhdam");
