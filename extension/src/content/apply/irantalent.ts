/**
 * IranTalent APPLY content script — SCAFFOLD (TODO(real-account)).
 *
 * Registers the APPLY_SPEC executor for irantalent. IranTalent is an SPA whose
 * session/form shape is still TBD (docs §7), so the apply-spec.ts selectors are
 * PLACEHOLDERS. Until verified against a real account, the executor reports a
 * graceful failure instead of clicking blindly.
 *
 * §10: no detection-evasion; the user's own session in the user's own browser.
 */
import { registerApplyHandler } from "@ext/content/apply/register";

// TODO(real-account): verify irantalent apply selectors in apply-spec.ts.
registerApplyHandler("irantalent");
