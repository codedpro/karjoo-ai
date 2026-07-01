/**
 * version-compare tests — the pure semver-ish comparator behind the extension's
 * "update available" banner (BUG 5). Covers ordering, zero-padding, and the
 * fail-closed behavior for malformed/hostile inputs (must never fake an update).
 */
import { describe, it, expect } from "vitest";
import { parseVersion, compareVersions, isNewerVersion } from "@ext/lib/version-compare";

describe("parseVersion", () => {
  it("parses 1–4 part integer versions", () => {
    expect(parseVersion("1")).toEqual([1]);
    expect(parseVersion("0.2")).toEqual([0, 2]);
    expect(parseVersion("0.2.0")).toEqual([0, 2, 0]);
    expect(parseVersion("1.2.3.4")).toEqual([1, 2, 3, 4]);
  });

  it("trims surrounding whitespace", () => {
    expect(parseVersion("  0.2.0 ")).toEqual([0, 2, 0]);
  });

  it("rejects malformed versions (fail-closed → null)", () => {
    expect(parseVersion("")).toBeNull();
    expect(parseVersion("   ")).toBeNull();
    expect(parseVersion(".")).toBeNull();
    expect(parseVersion("1.")).toBeNull();
    expect(parseVersion(".1")).toBeNull();
    expect(parseVersion("1..2")).toBeNull();
    expect(parseVersion("1.2.3.4.5")).toBeNull(); // too many parts
    expect(parseVersion("v1.2.3")).toBeNull();
    expect(parseVersion("1.2.3-beta")).toBeNull();
    expect(parseVersion("1.2.x")).toBeNull();
    expect(parseVersion("-1.0.0")).toBeNull();
    expect(parseVersion("1,2,3")).toBeNull();
    // @ts-expect-error runtime guard for non-strings
    expect(parseVersion(null)).toBeNull();
  });
});

describe("compareVersions", () => {
  it("orders by numeric component", () => {
    expect(compareVersions("0.1.0", "0.2.0")).toBeLessThan(0);
    expect(compareVersions("0.2.0", "0.1.0")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("0.2.10", "0.2.9")).toBeGreaterThan(0); // numeric, not lexical
  });

  it("treats missing trailing components as zero (0.2 == 0.2.0)", () => {
    expect(compareVersions("0.2", "0.2.0")).toBe(0);
    expect(compareVersions("0.2.0", "0.2")).toBe(0);
    expect(compareVersions("1", "1.0.0.0")).toBe(0);
  });

  it("equal versions compare to 0", () => {
    expect(compareVersions("0.2.0", "0.2.0")).toBe(0);
  });

  it("fails closed to 0 when either side is unparseable", () => {
    expect(compareVersions("garbage", "0.2.0")).toBe(0);
    expect(compareVersions("0.2.0", "garbage")).toBe(0);
    expect(compareVersions("", "")).toBe(0);
  });
});

describe("isNewerVersion", () => {
  it("is true only when latest is strictly greater than current", () => {
    expect(isNewerVersion("0.2.0", "0.1.0")).toBe(true);
    expect(isNewerVersion("0.2.1", "0.2.0")).toBe(true);
    expect(isNewerVersion("0.2.0", "0.2.0")).toBe(false); // equal → no update
    expect(isNewerVersion("0.1.0", "0.2.0")).toBe(false); // older → no update
  });

  it("never nags on a malformed/hostile latest version", () => {
    expect(isNewerVersion("99999999999", "0.2.0")).toBe(true); // valid big number is fine
    expect(isNewerVersion("not-a-version", "0.2.0")).toBe(false);
    expect(isNewerVersion("", "0.2.0")).toBe(false);
    expect(isNewerVersion("9.9.9-hacked", "0.2.0")).toBe(false);
  });
});
