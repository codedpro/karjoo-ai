import "server-only";

/**
 * تجزیه‌ی آگهی به «نیازمندی‌های ساخت‌یافته» + سنجشِ پوششِ آن‌ها با تجربه‌ی واقعیِ کاربر.
 *
 * چرا این لایه وجود دارد: دادنِ «کلِ رزومه + کلِ آگهی» به مدل و گفتنِ «بهینه کن» نتیجه‌ی
 * مبهم می‌دهد — مدل باید هم‌زمان بفهمد آگهی چه می‌خواهد، کاربر چه دارد، و چه بنویسد.
 * این‌جا آن را به دو گامِ روشن می‌شکنیم:
 *   ۱) از آگهی، فهرستِ دقیقِ تکنولوژی‌ها/مسئولیت‌ها/الزامات را بیرون بکش (بدونِ رزومه).
 *   ۲) هر نیازمندی را با شواهدِ واقعیِ کاربر تطبیق بده و بگو کدام پوشش دارد و کدام ندارد.
 *
 * خروجی دو مصرف دارد:
 *   • ساختِ رزومه: به مدل می‌گوییم دقیقاً کدام نیازمندی‌ها را برجسته کند (آن‌ها که شاهد دارند).
 *   • خودِ کاربر: می‌بیند این آگهی چه می‌خواهد که او ندارد — یعنی هم تصمیمِ آگاهانه برای
 *     اپلای، هم فهرستِ روشنِ چیزهایی که اگر واقعاً بلد است باید اعلامشان کند.
 */
import { buildJdExtractPrompt } from "@/lib/ai/prompts";
import { jdRequirementsSchema, type JdRequirements } from "@/lib/ai/schema";
import { meteredChatJson, type MeteringOptions } from "@/lib/billing/metering";

/** سقفِ خروجی — فهرستِ نیازمندی‌های یک آگهیِ بلند به‌راحتی از سقفِ عمومی رد می‌شود. */
export const JD_EXTRACT_MAX_TOKENS = 2500;

export class JdExtractError extends Error {
  readonly code = "jd_extract_invalid" as const;
}

/** نیازمندی‌های ساخت‌یافته‌ی یک آگهی را با AIِ مترشده بیرون می‌کشد. */
export async function extractJobRequirements(
  userId: string,
  jobText: string,
  opts: MeteringOptions = {},
): Promise<JdRequirements> {
  const messages = buildJdExtractPrompt(jobText);
  const out = await meteredChatJson(
    userId,
    "match",
    { messages, temperature: 0.1, maxTokens: JD_EXTRACT_MAX_TOKENS },
    opts,
  );
  const parsed = jdRequirementsSchema.safeParse(out.result.data);
  if (!parsed.success) {
    throw new JdExtractError(`jd requirements output invalid: ${parsed.error.message}`);
  }
  return parsed.data;
}

/** یک نیازمندی + این‌که آیا کاربر برایش شاهد دارد. */
export interface RequirementCoverage {
  requirement: string;
  /** آیا در دادهٔ واقعیِ کاربر (پروفایل/رزومه/حوزه‌های اعلامی) شاهدی هست؟ */
  covered: boolean;
}

export interface CoverageReport {
  covered: string[];
  missing: string[];
  /** درصدِ پوشش (۰–۱۰۰) — سیگنالِ ساده‌ی «چقدر به این آگهی می‌خورم». */
  percent: number;
}

const norm = (v: string) => v.toLowerCase().replace(/[\s._-]+/g, "");

/**
 * نیازمندی‌های آگهی را با شواهدِ کاربر تطبیق می‌دهد.
 *
 * تطبیق عمداً سهل‌گیر است (زیررشته‌ی نرمال‌شده): «Next.js» با «nextjs» و «Next JS» یکی
 * شمرده می‌شود. هدف سنجشِ سخت‌گیرانه نیست؛ هدف این است که به مدل بگوییم روی چه چیزهایی
 * تکیه کند و به کاربر بگوییم چه چیزی واقعاً غایب است.
 */
export function assessCoverage(requirements: readonly string[], evidence: string): CoverageReport {
  const hay = norm(evidence);
  const covered: string[] = [];
  const missing: string[] = [];
  for (const r of requirements) {
    const key = norm(r);
    if (key && hay.includes(key)) covered.push(r);
    else missing.push(r);
  }
  const total = covered.length + missing.length;
  return {
    covered,
    missing,
    percent: total === 0 ? 0 : Math.round((covered.length / total) * 100),
  };
}
