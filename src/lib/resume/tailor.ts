import "server-only";

/**
 * «رزومه‌ی سفارشیِ هر شغل» — فراخوانیِ مترشده‌ی هوش مصنوعی که محتوای رزومه‌ی پایه را برای یک
 * آگهیِ خاص بازنویسی/هدف‌گیری می‌کند. هزینه به کیف‌پولِ *همان کاربر* با نرخِ 1xAi بسته می‌شود.
 */
import { buildResumeTailorPrompt } from "@/lib/ai/prompts";
import { resumeTailorSchema, type ResumeTailorOutput } from "@/lib/ai/schema";
import { meteredChatJson, type MeteringOptions } from "@/lib/billing/metering";

export class ResumeTailorError extends Error {
  readonly code = "resume_tailor_invalid" as const;
}

/**
 * رزومه‌ی هدف‌گیری‌شده برای یک آگهی تولید می‌کند. `profileText` خلاصه‌ی کاملِ رزومه‌ی کاربر و
 * `jobText` عنوان+شرحِ آگهی است. خروجی با schema اعتبارسنجی می‌شود.
 */
export async function meteredTailorResume(
  userId: string,
  profileText: string,
  jobText: string,
  opts: MeteringOptions = {},
): Promise<ResumeTailorOutput> {
  const messages = buildResumeTailorPrompt(profileText, jobText);
  const out = await meteredChatJson(userId, "resume_tailor", { messages, temperature: 0.5 }, opts);
  const parsed = resumeTailorSchema.safeParse(out.result.data);
  if (!parsed.success) {
    throw new ResumeTailorError(`tailored résumé output invalid: ${parsed.error.message}`);
  }
  return parsed.data;
}
