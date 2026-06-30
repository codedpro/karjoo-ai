/**
 * استخراجِ متنِ خام از فایلِ PDFِ رزومه (WF1، مسیرِ رایگان).
 *
 * این لایه‌ی «مسیرِ رایگان» است: فقط متنِ خامِ PDF را با کتابخانه‌ی `unpdf` (ESM، بدون
 * وابستگیِ نیتیو، مناسبِ سرورلس) بیرون می‌کشد. ساخت‌یافته‌سازیِ فیلدها (نام/مهارت/سابقه)
 * مسیرِ جداگانه‌ای است که از گیت‌وی 1xai (مثلِ scoreAndDraft) عبور می‌کند — اینجا نیست.
 *
 * عمداً «server-only» نیست: تابعِ خالص و بدونِ راز است؛ منطقِ پاک‌سازیِ متن (نرمال‌سازیِ
 * فاصله/خطوط) به‌صورتِ تابعِ خالصِ صادرشده تست می‌شود و خودِ extractText با یک فیکسچرِ
 * کوچک قابلِ تست است. (importِ unpdf پویا (dynamic) است تا فقط هنگامِ نیاز بار شود و
 * در محیط‌های بدونِ PDF، باندل را سنگین نکند.)
 */

/** نتیجه‌ی استخراجِ متن از یک PDF. */
export interface PdfExtractResult {
  /** متنِ کاملِ همه‌ی صفحه‌ها (به‌هم‌پیوسته، پاک‌سازی‌شده). */
  text: string;
  /** تعدادِ صفحه‌های PDF. */
  pageCount: number;
}

/** خطای typed این لایه — تا فراخواننده «PDFِ خراب» را از خطاهای دیگر تمیز بدهد. */
export class PdfExtractError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "PdfExtractError";
    this.cause = cause;
  }
}

/**
 * متنِ خامِ استخراج‌شده را پاک‌سازی می‌کند: نرمال‌سازیِ انتهای‌خط‌ها، حذفِ فاصله‌های
 * افقیِ تکراری، و فشرده‌سازیِ بیش از دو خطِ خالیِ پشت‌سرهم به یک خطِ خالی. تابعِ خالص
 * (هسته‌ی قابلِ تست؛ بدونِ نیاز به PDF).
 */
export function cleanPdfText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n") // CRLF/CR → LF
    .replace(/[ \t ]+/g, " ") // فاصله‌های افقیِ تکراری (شاملِ nbsp) → یک فاصله
    .replace(/ *\n */g, "\n") // فاصله‌ی دورِ شکستِ خط
    .replace(/\n{3,}/g, "\n\n") // بیش از دو خطِ خالی → یک خطِ خالی
    .trim();
}

/**
 * متنِ یک فایلِ PDF را استخراج می‌کند.
 *
 * @param data بایت‌های خامِ PDF (Uint8Array؛ Buffer هم چون زیرکلاسِ آن است می‌پذیرد).
 * @param deps تزریقِ پیاده‌سازیِ استخراج (برای تست بدونِ بارگذاریِ unpdf). در مسیرِ
 *             واقعی خالی است و از unpdf استفاده می‌شود.
 * @throws {PdfExtractError} اگر داده خالی/غیرPDF باشد یا استخراج شکست بخورد.
 */
export async function extractText(
  data: Uint8Array,
  deps: {
    /** override استخراج‌گرِ متن (تست). امضاءِ سازگار با unpdf.extractText(merged). */
    extractImpl?: (
      d: Uint8Array,
    ) => Promise<{ totalPages: number; text: string }>;
  } = {},
): Promise<PdfExtractResult> {
  if (!data || data.byteLength === 0) {
    throw new PdfExtractError("فایلِ PDF خالی است (۰ بایت).");
  }

  const extractImpl =
    deps.extractImpl ??
    (async (d: Uint8Array) => {
      // importِ پویا: unpdf فقط هنگامِ نیاز بار می‌شود (ESM؛ مناسبِ سرورلس).
      const { extractText: unpdfExtractText } = await import("unpdf");
      return unpdfExtractText(d, { mergePages: true });
    });

  let result: { totalPages: number; text: string };
  try {
    result = await extractImpl(data);
  } catch (cause) {
    throw new PdfExtractError(
      "استخراجِ متن از PDF ناموفق بود (فایل خراب یا رمزگذاری‌شده است؟).",
      cause,
    );
  }

  return {
    text: cleanPdfText(result.text ?? ""),
    pageCount: result.totalPages ?? 0,
  };
}
