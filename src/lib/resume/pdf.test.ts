/**
 * تستِ استخراجِ متنِ PDF (WF1) — هسته‌ی خالص + یک فیکسچرِ کوچکِ واقعی.
 *
 * cleanPdfText کاملاً خالص است؛ extractText هم با تزریقِ extractImpl (بدونِ unpdf) و
 * هم با فیکسچرِ واقعی (__fixtures__/sample-resume.pdf) از مسیرِ unpdf آزموده می‌شود.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { PdfExtractError, cleanPdfText, extractText } from "@/lib/resume/pdf";

describe("cleanPdfText", () => {
  it("CRLF/CR را به LF نرمال می‌کند", () => {
    expect(cleanPdfText("a\r\nb\rc")).toBe("a\nb\nc");
  });

  it("فاصله‌های افقیِ تکراری را جمع می‌کند", () => {
    expect(cleanPdfText("a    b\t\tc")).toBe("a b c");
  });

  it("بیش از دو خطِ خالی را به یک خطِ خالی فشرده می‌کند", () => {
    expect(cleanPdfText("a\n\n\n\nb")).toBe("a\n\nb");
  });

  it("فاصله‌ی دورِ شکستِ خط را پاک می‌کند و trim می‌کند", () => {
    expect(cleanPdfText("  a \n  b  ")).toBe("a\nb");
  });
});

describe("extractText (با تزریقِ extractImpl)", () => {
  it("متن را پاک‌سازی و pageCount را برمی‌گرداند", async () => {
    const out = await extractText(new Uint8Array([1, 2, 3]), {
      extractImpl: async () => ({ totalPages: 2, text: "خط اول\r\n\r\n\r\nخط دوم" }),
    });
    expect(out.pageCount).toBe(2);
    expect(out.text).toBe("خط اول\n\nخط دوم");
  });

  it("برای بافرِ خالی، PdfExtractError می‌اندازد", async () => {
    await expect(extractText(new Uint8Array([]))).rejects.toBeInstanceOf(PdfExtractError);
  });

  it("خطای استخراج را به PdfExtractError تبدیل می‌کند", async () => {
    await expect(
      extractText(new Uint8Array([1]), {
        extractImpl: async () => {
          throw new Error("boom");
        },
      }),
    ).rejects.toBeInstanceOf(PdfExtractError);
  });
});

describe("extractText (فیکسچرِ واقعی از مسیرِ unpdf)", () => {
  it("متنِ یک PDFِ تک‌صفحه‌ایِ واقعی را استخراج می‌کند", async () => {
    const path = fileURLToPath(
      new URL("./__fixtures__/sample-resume.pdf", import.meta.url),
    );
    const bytes = new Uint8Array(readFileSync(path));
    const out = await extractText(bytes);
    expect(out.pageCount).toBe(1);
    expect(out.text).toContain("Karjoo");
  });
});
