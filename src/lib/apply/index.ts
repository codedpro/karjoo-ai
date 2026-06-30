import "server-only";

/**
 * بشکه‌ی (barrel) عمومیِ دامنه‌ی «اپلای خودکار» کارجو.
 *
 * این فایل سطحِ عمومیِ ماژول را تثبیت می‌کند: رجیستریِ کانکتورها، موتورِ امتیازدهی
 * (scoreAndDraft) و خط‌لوله‌ی ارکستریتور (runAutoApply / runJobinjaIngest) را صادر
 * مجدد می‌کند، به‌علاوه‌ی قراردادهای نوعِ types.ts. خودِ پیاده‌سازی‌ها در ماژول‌های
 * مجزا زندگی می‌کنند تا قابلِ تست/تزریق بمانند و چرخه‌ی import شکل نگیرد.
 */

/** رجیستریِ کانکتورها — در ماژولِ برگِ registry.ts است (شکستنِ چرخه‌ی import). */
export { connectors, getConnector } from "@/lib/apply/registry";

/**
 * موتور تطبیق هوش مصنوعی (پیاده‌سازی واقعی).
 *
 * آگهی و پروفایل کاربر را از طریق گیت‌وی 1xai امتیاز می‌دهد و یک انگیزه‌نامه‌ی
 * اختصاصی می‌نویسد. پیاده‌سازی در `@/lib/apply/scoring` است (جدا نگه داشته شده تا
 * ارکستریتور بتواند آن را مستقیماً تزریق/mock کند). اینجا فقط آن را به‌عنوان
 * قراردادِ عمومیِ این ماژول صادر مجدد می‌کنیم.
 */
export { scoreAndDraft } from "@/lib/apply/scoring";
export type { ScoreAndDraftResult } from "@/lib/apply/scoring";
export { ScoringError } from "@/lib/apply/scoring";

/**
 * گردش‌کار «اپلای خودکار» (پیاده‌سازی واقعی).
 *
 * خط لوله‌ی کنترل‌پلین: ingest عمومی (scrapePublic) → نرمال‌سازی/ذخیره → امتیازدهی
 * هوش مصنوعی (scoreAndDraft) → upsert تطبیق → ورود idempotent به *صفِ اپلای*
 * (بالای آستانه و زیرِ سقفِ روزانه). اپلایِ واقعی *انجام نمی‌شود* — صرفاً صف‌گذاری؛
 * ارسال کارِ کارگر/افزونه است.
 *
 * پیاده‌سازی در `@/lib/apply/orchestrator` است. علاوه بر این، `runJobinjaIngest`
 * (مسیرِ فقط-خواندنیِ فاز ۱ که مسیرِ API به آن وابسته است) از همان‌جا صادر می‌شود.
 */
export {
  runAutoApply,
  runJobinjaIngest,
  DEFAULT_MATCH_THRESHOLD,
  DEFAULT_DAILY_CAP,
  DEFAULT_SCORE_THRESHOLD,
} from "@/lib/apply/orchestrator";
export type {
  RunAutoApplyOptions,
  RunAutoApplyReport,
  IngestRunInput,
  IngestRunResult,
} from "@/lib/apply/orchestrator";

export type {
  ApplicationResult,
  CandidateProfile,
  JobBoardConnector,
  JobBoardId,
  JobListing,
} from "@/lib/apply/types";
