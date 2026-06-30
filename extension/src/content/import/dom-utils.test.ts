/**
 * Tests for the pure DOM helpers used by the import scrapers. We parse small HTML
 * fixtures with linkedom (a lightweight, pure-JS DOM — no real browser) so the
 * helpers can be exercised against a real `Document` in plain Node/vitest.
 */
import { describe, it, expect } from "vitest";
import { parseHTML } from "linkedom";
import {
  cleanText,
  textOf,
  attrOf,
  textListOf,
  elementsOf,
  parseYears,
  toAsciiDigits,
  splitSkills,
  compact,
  hasAnyValue,
  toScrapeResult,
} from "@ext/content/import/dom-utils";

function doc(html: string): Document {
  return parseHTML(`<!doctype html><html><body>${html}</body></html>`).document;
}

describe("cleanText", () => {
  it("collapses whitespace and trims", () => {
    expect(cleanText("  a   b\n c ")).toBe("a b c");
  });
  it("returns undefined for empty/whitespace/null", () => {
    expect(cleanText("   ")).toBeUndefined();
    expect(cleanText(null)).toBeUndefined();
    expect(cleanText(undefined)).toBeUndefined();
  });
});

describe("textOf / attrOf", () => {
  const d = doc(`<h1 class="name">  علی   رضایی </h1><a class="lnk" href="/jobs/9">شغل</a>`);
  it("reads cleaned text of the first matching selector", () => {
    expect(textOf(d, [".missing", ".name"])).toBe("علی رضایی");
  });
  it("returns undefined when nothing matches", () => {
    expect(textOf(d, [".nope"])).toBeUndefined();
  });
  it("reads an attribute", () => {
    expect(attrOf(d, [".lnk"], "href")).toBe("/jobs/9");
  });
  it("tolerates an invalid selector and continues", () => {
    expect(textOf(d, ["::::bad", ".name"])).toBe("علی رضایی");
  });
});

describe("textListOf / elementsOf", () => {
  const d = doc(`<ul class="s"><li>Node</li><li>SQL</li><li>node</li></ul>`);
  it("collects cleaned, deduped (case-insensitive) text", () => {
    expect(textListOf(d, [".s li"])).toEqual(["Node", "SQL"]);
  });
  it("returns elements for the first non-empty selector", () => {
    expect(elementsOf(d, [".x", ".s li"]).length).toBe(3);
    expect(elementsOf(d, [".x"]).length).toBe(0);
  });
});

describe("parseYears / toAsciiDigits", () => {
  it("converts Persian digits to ASCII", () => {
    expect(toAsciiDigits("۵ سال")).toBe("5 سال");
  });
  it("parses years from Persian and ASCII phrasings", () => {
    expect(parseYears("۵ سال سابقه")).toBe(5);
    expect(parseYears("7 years")).toBe(7);
    expect(parseYears("بدون عدد")).toBeUndefined();
    expect(parseYears(undefined)).toBeUndefined();
  });
  it("rejects out-of-range values", () => {
    expect(parseYears("99")).toBeUndefined();
  });
});

describe("splitSkills", () => {
  it("splits on commas (ASCII + Persian), pipes, slashes, newlines and dedupes", () => {
    expect(splitSkills("Node، SQL | Node /Docker")).toEqual(["Node", "SQL", "Docker"]);
  });
  it("returns [] for empty input", () => {
    expect(splitSkills(undefined)).toEqual([]);
    expect(splitSkills("   ")).toEqual([]);
  });
});

describe("compact / hasAnyValue", () => {
  it("drops undefined, empty strings and empty arrays", () => {
    expect(compact({ a: "x", b: undefined, c: "  ", d: [], e: [1] })).toEqual({ a: "x", e: [1] });
  });
  it("hasAnyValue reflects whether anything meaningful remains", () => {
    expect(hasAnyValue({ a: undefined, b: "" })).toBe(false);
    expect(hasAnyValue({ a: "x" })).toBe(true);
  });
});

describe("toScrapeResult", () => {
  it("ok:true with the profile when fields exist", () => {
    const r = toScrapeResult({ fullName: "x" });
    expect(r.ok).toBe(true);
    expect(r.profile?.fullName).toBe("x");
  });
  it("ok:false with a Persian hint when empty", () => {
    const r = toScrapeResult({});
    expect(r.ok).toBe(false);
    expect(r.message).toBeTruthy();
    expect(r.profile).toBeUndefined();
  });
});
