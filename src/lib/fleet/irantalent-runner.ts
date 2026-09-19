import "server-only";

/**
 * اجرا کننده‌ی سمتِ سرورِ ایران‌تلنت — حالا یک پوسته‌ی نازک روی رانرِ مشترک.
 *
 * ایران‌تلنت اولین سایتی بود که اپلایش را از کنترل‌پلین (بدونِ مرورگر و بدونِ نودِ ورکر)
 * انجام دادیم، و همه‌ی گیت‌ها — فیلترِ کاربر، گیتِ اپلای خودکارِ سرور، claim، نشست،
 * ثبتِ نتیجه — این‌جا نوشته شده بود. با اضافه شدنِ کاربوم و ای‌استخدام همان گیت‌ها
 * عیناً تکرار می‌شدند، و کپیِ دوم دیر یا زود از اولی دور می‌افتاد (همان بلایی که سرِ
 * نسخه‌ی دوگانه‌ی APPLY_SPEC آمد). پس بدنه به `fleet/server-apply-runner` منتقل شد و
 * تفاوتِ ایران‌تلنت فقط یک ورودی در `BOARD_EXECUTORS` است.
 *
 * این فایل صرفاً برای سازگاریِ فراخوانندگانِ موجود (مسیرِ internal و تست‌ها) مانده است.
 */
import type { db as defaultDb } from "@/db";
import {
  listServerApplyUsers,
  runServerApplyForUser,
  runServerApplyTick,
  type ServerApplyRunnerDeps,
  type ServerApplySummary,
} from "@/lib/fleet/server-apply-runner";

const BOARD = "irantalent" as const;

export type IranTalentRunSummary = ServerApplySummary;
export type IranTalentRunnerDeps = ServerApplyRunnerDeps;

/** آیتم‌های ایران‌تلنتِ صفِ یک کاربر را از سمتِ سرور اجرا می‌کند. */
export function runIranTalentForUser(
  userId: string,
  limit: number,
  deps: IranTalentRunnerDeps = {},
): Promise<IranTalentRunSummary> {
  return runServerApplyForUser(userId, BOARD, limit, deps);
}

/** کاربرانی که می‌توان ایران‌تلنت را از سمتِ سرور برایشان اجرا کرد. */
export function listIranTalentServerUsers(
  conn?: typeof defaultDb,
  limit = 50,
): Promise<string[]> {
  return listServerApplyUsers(BOARD, conn, limit);
}

/** یک تیکِ کاملِ سمتِ سرورِ ایران‌تلنت روی همه‌ی کاربرانِ واجد. */
export function runIranTalentTick(
  opts: { perUser?: number; deps?: IranTalentRunnerDeps } = {},
): Promise<IranTalentRunSummary> {
  return runServerApplyTick({ ...opts, boards: [BOARD] });
}
