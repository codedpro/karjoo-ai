import "server-only";

/**
 * مسیرِ تولیدیِ مترشده‌ی scoreAndDraft (server-only).
 *
 * چرا جدا از scoring.ts؟ تابعِ `scoreAndDraft` در scoring.ts عمداً «خالص» می‌ماند
 * (بدونِ بیلینگ) تا تست‌های واحد و قراردادِ ارکستریتور دست‌نخورده بمانند. این لایه
 * همان منطق (پرامپت → گیت‌وی JSON → اعتبارسنجی zod) را اما از طریقِ `meteredChatJson`
 * عبور می‌دهد تا به کیف‌پولِ کاربر مقید شود: گیتِ موجودی پیش از فراخوانی، و کسرِ
 * هزینه‌ی واقعی پس از آن (مدلِ بیلینگِ قفل‌شده).
 *
 * ارکستریتور می‌تواند این را به‌عنوانِ `scoreFn` تزریق کند (با userId بسته‌شده) تا
 * مسیرِ تطبیقِ تولید مترشده شود، بی‌آنکه امضای ScoreAndDraftFn تغییر کند.
 */
import { buildScoreAndDraftPrompt } from "@/lib/ai/prompts";
import { scoreAndDraftSchema } from "@/lib/ai/schema";
import { ScoringError, type ScoreAndDraftResult } from "@/lib/apply/scoring";
import type { CandidateProfile, JobListing } from "@/lib/apply/types";
import { meteredChatJson, type MeteringOptions } from "@/lib/billing/metering";

/**
 * یک آگهی را در برابرِ پروفایلِ کاربر امتیاز می‌دهد و انگیزه‌نامه می‌نویسد — *مترشده*.
 *
 * @param userId کاربری که هزینه به کیف‌پولش بسته می‌شود (به نشست/اجرا مقید، نه کلاینت).
 * @param opts آپشن‌های مترینگ (db/گیت‌وی/استحقاق) — در مسیرِ واقعی خالی، در تست تزریقی.
 *
 * @throws {InsufficientBalanceError} اگر پیش از فراخوانی موجودی کافی نباشد (بدونِ هزینه).
 * @throws {ScoringError} اگر گیت‌وی/مدل خروجیِ نامعتبر بدهد (در این حالت کسری انجام نمی‌شود،
 *         چون metering فقط پس از فراخوانیِ موفقِ گیت‌وی تسویه می‌کند).
 */
export async function meteredScoreAndDraft(
  userId: string,
  job: JobListing,
  profile: CandidateProfile,
  opts: MeteringOptions = {},
): Promise<ScoreAndDraftResult> {
  const messages = buildScoreAndDraftPrompt(job, profile);

  let data: unknown;
  try {
    const out = await meteredChatJson(userId, "match", { messages, temperature: 0.4 }, opts);
    data = out.result.data;
  } catch (cause) {
    // خطای استحقاق (InsufficientBalanceError) را همان‌طور بالا می‌فرستیم تا فراخواننده
    // بتواند «شارژ لازم است» را تشخیص دهد؛ بقیه‌ی خطاها به ScoringError بسته می‌شوند.
    if (cause instanceof ScoringError) throw cause;
    if (isInsufficientBalance(cause)) throw cause;
    throw new ScoringError(
      "فراخوانیِ مترشده‌ی گیت‌وی هوش مصنوعی برای امتیازدهی/نگارش ناموفق بود.",
      cause,
    );
  }

  const parsed = scoreAndDraftSchema.safeParse(data);
  if (!parsed.success) {
    throw new ScoringError(
      `خروجیِ مدل با اسکیمای موردانتظار هم‌خوان نبود: ${parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("؛ ")}`,
      parsed.error,
    );
  }

  const reason =
    parsed.data.reasons.length > 0 ? parsed.data.reasons.join("؛ ") : undefined;

  return {
    matchScore: parsed.data.matchScore,
    coverLetter: parsed.data.coverLetter,
    reason,
  };
}

/**
 * آیا این خطا از نوعِ موجودیِ ناکافیِ بیلینگ است؟ (بدونِ importِ سختِ کلاس در سطحِ ماژول).
 *
 * سه شکل را می‌شناسد: خطای typedِ خودِ بیلینگ، کدِ insufficient_balance، و ۴۰۲ِ
 * میانه‌ی فراخوانی از گیت‌ویِ 1xai (GatewayError با status=402) — چون شارژِ واقعی اکنون
 * سمتِ 1xai با کلیدِ خودِ کاربر رخ می‌دهد، ممکن است گیتِ پیشین (موجودیِ در دسترس > ۰)
 * عبور کند ولی خودِ فراخوانی ۴۰۲ بخورد؛ آن هم باید حلقه‌های ارکستریتور را متوقف کند.
 */
export function isInsufficientBalance(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (
    err.name === "InsufficientBalanceError" ||
    (err as { code?: string }).code === "insufficient_balance"
  ) {
    return true;
  }
  // GatewayError(status=402) از 1xai — بدونِ importِ کلاس، ساختاری بررسی می‌شود.
  return err.name === "GatewayError" && (err as { status?: number }).status === 402;
}
