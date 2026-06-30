/**
 * JobVision APPLY content script — SCAFFOLD (TODO(real-account)).
 *
 * Registers the APPLY_SPEC executor for jobvision. JobVision is an SPA whose auth
 * token lives in localStorage; the apply form renders dynamically so the spec
 * uses waitFor. The selectors in apply-spec.ts are PLACEHOLDERS — until they are
 * verified against a real JobVision account, the executor will not find the
 * elements and will report a graceful failure (it never blindly clicks/submits).
 *
 * §10: when wired with real selectors, it will fill + submit the public form
 * using the user's OWN localStorage session in the user's own browser — no
 * detection-evasion.
 */
import { registerApplyHandler } from "@ext/content/apply/register";

// TODO(real-account): verify jobvision apply selectors in apply-spec.ts.
registerApplyHandler("jobvision");
