/**
 * تست‌های اعتبارسنجیِ آپلودِ رزومه (تابعِ خالص، بدونِ I/O).
 *
 * قواعدِ پذیرشِ فایل (نوع/اندازه/امضای %PDF) را روی مرزها بررسی می‌کند.
 */
import { describe, expect, it } from "vitest";

import {
  MAX_RESUME_BYTES,
  MIN_RESUME_BYTES,
  decodeBase64Pdf,
  hasPdfSignature,
  validateResumeUpload,
} from "@/lib/resume/validation";

/** یک «PDF» معتبرِ مینیمال می‌سازد: امضای %PDF- + padding تا از حداقلِ اندازه بگذرد. */
function fakePdf(extraBytes = MIN_RESUME_BYTES): Uint8Array {
  const head = new TextEncoder().encode("%PDF-1.7\n");
  const body = new Uint8Array(extraBytes).fill(0x20);
  const out = new Uint8Array(head.length + body.length);
  out.set(head, 0);
  out.set(body, head.length);
  return out;
}

describe("hasPdfSignature", () => {
  it("امضای %PDF- را تشخیص می‌دهد", () => {
    expect(hasPdfSignature(fakePdf())).toBe(true);
  });
  it("بایت‌های بدونِ امضا را رد می‌کند", () => {
    expect(hasPdfSignature(new TextEncoder().encode("hello world"))).toBe(false);
  });
  it("بایت‌های کوتاه‌تر از امضا را رد می‌کند", () => {
    expect(hasPdfSignature(new Uint8Array([0x25, 0x50]))).toBe(false);
  });
});

describe("validateResumeUpload", () => {
  it("PDF معتبر را می‌پذیرد", () => {
    expect(validateResumeUpload(fakePdf(), "application/pdf")).toEqual({
      ok: true,
    });
  });

  it("بدونِ نوعِ MIME هم با امضای درست می‌پذیرد", () => {
    expect(validateResumeUpload(fakePdf(), null).ok).toBe(true);
  });

  it("نوعِ MIimage غیر-PDF را رد می‌کند", () => {
    const res = validateResumeUpload(fakePdf(), "image/png");
    expect(res.ok).toBe(false);
  });

  it("فایلِ خیلی کوچک را رد می‌کند", () => {
    const tiny = new TextEncoder().encode("%PDF");
    const res = validateResumeUpload(tiny, "application/pdf");
    expect(res.ok).toBe(false);
  });

  it("فایلِ بزرگ‌تر از سقف را رد می‌کند", () => {
    const big = new Uint8Array(MAX_RESUME_BYTES + 1);
    big.set(new TextEncoder().encode("%PDF-"), 0);
    const res = validateResumeUpload(big, "application/pdf");
    expect(res.ok).toBe(false);
  });

  it("بایت‌هایی که PDF نیستند (با اندازه‌ی کافی) را رد می‌کند", () => {
    const notPdf = new Uint8Array(MIN_RESUME_BYTES + 50).fill(0x41); // "AAAA…"
    const res = validateResumeUpload(notPdf, "application/pdf");
    expect(res.ok).toBe(false);
  });
});

describe("decodeBase64Pdf", () => {
  it("base64 خام را به بایت تبدیل می‌کند", () => {
    const original = fakePdf();
    const b64 = Buffer.from(original).toString("base64");
    const decoded = decodeBase64Pdf(b64);
    expect(decoded).toEqual(original);
  });

  it("پیشوندِ data: URL را حذف می‌کند", () => {
    const original = fakePdf();
    const b64 = Buffer.from(original).toString("base64");
    const decoded = decodeBase64Pdf(`data:application/pdf;base64,${b64}`);
    expect(decoded).toEqual(original);
  });
});
