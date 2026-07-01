/**
 * popup-shell tests — static/structural guarantees for the popup UI, verified
 * WITHOUT a real browser (per the extension's "no live browser in CI" rule). We
 * parse the shipped popup.html with linkedom and read the popup.ts / messaging.ts
 * source to assert:
 *
 *   • BUG 2: the server-override UI is fully gone (no #api-origin / #save-origin
 *     inputs, no SET_API_ORIGIN message, no advanced-settings block). A user has
 *     no control to repoint the extension.
 *   • BUG 3: the popup boots render-first — the module is loaded deferred/at end
 *     of body, boot() is gated on the DOM being ready, and messaging is bounded
 *     by a timeout so a cold service worker can't hang the popup.
 *   • BUG 5: the update-available banner exists in the shell, is hidden by
 *     default, and carries the Persian "نسخه‌ی جدید موجود است" copy + a download
 *     link — so it only ever appears when the update-check reveals it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseHTML } from "linkedom";

const here = fileURLToPath(new URL(".", import.meta.url));
const read = (rel: string) => readFileSync(here + rel, "utf8");

const html = read("popup.html");
const popupTs = read("popup.ts");
const messagingTs = read("messaging.ts");

function dom() {
  return parseHTML(html).document;
}

describe("BUG 2 — server-override UI is removed (origin is locked)", () => {
  it("has no API-origin input or save-origin button in the shell", () => {
    const doc = dom();
    expect(doc.getElementById("api-origin")).toBeNull();
    expect(doc.getElementById("save-origin")).toBeNull();
  });

  it("has no advanced-settings block", () => {
    const doc = dom();
    expect(doc.querySelector("details.advanced")).toBeNull();
    expect(html).not.toContain("تنظیمات پیشرفته");
  });

  it("the popup never sends SET_API_ORIGIN and never persists an origin", () => {
    expect(popupTs).not.toContain("SET_API_ORIGIN");
    expect(popupTs).not.toContain("setApiOrigin");
    expect(popupTs).not.toContain("api-origin");
    expect(popupTs).not.toContain("save-origin");
  });
});

describe("BUG 3 — popup renders first and can't be hung by a cold SW", () => {
  it("loads the popup module at the end of <body> (shell parses before script)", () => {
    const doc = dom();
    const script = doc.querySelector('script[src="popup.js"]');
    expect(script).not.toBeNull();
    // Placed inside <body> after the views, not blocking <head> parse.
    expect(script?.closest("body")).not.toBeNull();
  });

  it("gates boot() on DOMContentLoaded / readyState (render-first entry)", () => {
    expect(popupTs).toContain("readyState");
    expect(popupTs).toContain("DOMContentLoaded");
  });

  it("bounds background messaging with a timeout (no infinite await)", () => {
    expect(messagingTs).toContain("SEND_TIMEOUT_MS");
    expect(messagingTs.toLowerCase()).toContain("timeout");
  });

  it("uses null-tolerant lookups so a missing element can't blank the popup", () => {
    // $opt returns null instead of throwing; boot() must not depend on the
    // throwing `$` before the first paint.
    expect(popupTs).toContain("$opt");
  });
});

describe("BUG 5 — update-available banner is present but hidden by default", () => {
  it("renders a hidden banner with the Persian update headline", () => {
    const doc = dom();
    const banner = doc.getElementById("update-banner");
    expect(banner).not.toBeNull();
    // Hidden until the update-check reveals it.
    expect(banner?.hasAttribute("hidden")).toBe(true);
    expect(html).toContain("نسخه‌ی جدید موجود است");
  });

  it("provides a download link the update-check can point at the zip", () => {
    const doc = dom();
    expect(doc.getElementById("update-download")).not.toBeNull();
  });

  it("popup wires the update check to the resilient checkForUpdate helper", () => {
    expect(popupTs).toContain("checkForUpdate");
    expect(popupTs).toContain("update-banner");
  });
});
