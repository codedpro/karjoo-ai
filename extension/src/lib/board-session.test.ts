import { describe, expect, it } from "vitest";
import { boardTabPatterns } from "@ext/lib/board-session";

describe("boardTabPatterns", () => {
  it("checks the root JobVision host and every subdomain", () => {
    expect(boardTabPatterns("https://jobvision.ir")).toEqual([
      "https://jobvision.ir/*",
      "https://*.jobvision.ir/*",
    ]);
  });

  it("normalizes configured www hosts", () => {
    expect(boardTabPatterns("https://www.irantalent.com")).toEqual([
      "https://irantalent.com/*",
      "https://*.irantalent.com/*",
    ]);
  });
});

