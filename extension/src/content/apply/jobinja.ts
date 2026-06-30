/**
 * Jobinja APPLY content script — BEST-EFFORT REAL.
 *
 * Runs the APPLY_SPEC executor for jobinja when the background auto-apply runner
 * sends CONTENT_APPLY (after the §10 gate: toggle ON + under daily cap + above
 * threshold). Jobinja is server-rendered and the user's session is a cookie, so
 * the user's OWN logged-in session is used as-is. Selectors are best-effort
 * (c-jobView*, c-applyForm*) and should be validated against a real jobinja
 * account before release.
 *
 * §10: no detection-evasion — fills + submits the public "ارسال رزومه" form the
 * user could submit by hand, in the user's own browser.
 */
import { registerApplyHandler } from "@ext/content/apply/register";

registerApplyHandler("jobinja");
