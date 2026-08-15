import { describe, expect, it } from "vitest";

import {
  DEFAULT_QUEUE_RESUME_PREP_LIMIT,
  MAX_QUEUE_RESUME_PREP_LIMIT,
} from "@/lib/resume/queue-prep";

describe("queue resume preparation limits", () => {
  it("prepares more than two resumes per server discovery run by default", () => {
    expect(DEFAULT_QUEUE_RESUME_PREP_LIMIT).toBe(20);
  });

  it("keeps a bounded hard cap for one server run", () => {
    expect(MAX_QUEUE_RESUME_PREP_LIMIT).toBe(25);
  });
});
