import { describe, expect, it } from "vitest";

import { hasSubmissionEvidence, isValidSubmissionProof } from "@/lib/apply/submission-proof";

describe("provider submission proof", () => {
  it.each([
    ["jobinja", "flash_message"],
    ["jobinja", "submitted_text"],
    ["jobinja", "apply_form_removed"],
    ["jobinja", "already_applied_text"],
    ["jobinja", "application_history"],
    ["jobvision", "post_apply_path"],
    ["jobvision", "submitted_text"],
    ["jobvision", "already_applied_text"],
    ["e-estekhdam", "apply_api_accepted"],
    ["e-estekhdam", "apply_after_cleanup_api_accepted"],
    ["e-estekhdam", "already_applied_api"],
    ["irantalent", "position_is_applied"],
    ["irantalent", "conditions_is_applied"],
    ["irantalent", "apply_conflict"],
    ["irantalent", "application_history"],
    ["karboom", "wizard_done"],
    ["karboom", "already_applied_response"],
  ])("accepts an allowlisted %s signal", (provider, signal) => {
    expect(isValidSubmissionProof(provider, { provider, signal })).toBe(true);
  });

  it("rejects absent, cross-provider, and unknown evidence", () => {
    expect(isValidSubmissionProof("jobvision", undefined)).toBe(false);
    expect(isValidSubmissionProof("jobvision", { provider: "jobinja", signal: "submitted_text" })).toBe(false);
    expect(isValidSubmissionProof("jobvision", { provider: "jobvision", signal: "clicked_submit" })).toBe(false);
  });

  it("accepts a non-empty external provider receipt", () => {
    expect(hasSubmissionEvidence({ board: "jobvision", externalRef: "JV-123" })).toBe(true);
    expect(hasSubmissionEvidence({ board: "jobvision", externalRef: "   " })).toBe(false);
  });
});
