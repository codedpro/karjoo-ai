import "server-only";

/**
 * وضعیتِ راه‌اندازیِ کاربر — منبعِ مشترکِ چک‌لیستِ خانه و صفحه‌ی «شروع».
 *
 * هر تشخیص جدا و fail-safe است: خطای یک کوئری آن گام را «ناتمام» نشان می‌دهد، نه اینکه
 * کلِ صفحه را بیندازد.
 */
import { getBoardAccountsForUser } from "@/components/dashboard/data";
import { getResumeFiles, getResumeProfile } from "@/components/dashboard/resume-data";
import { readApplyFilters } from "@/lib/apply/filters";
import {
  isBoardConnected,
  isResumeReady,
  isTargetingReady,
} from "@/lib/onboarding/setup-predicates";

/** کاربر راهنمای شروع را تمام یا رد کرده؛ خانه دیگر او را به آن نمی‌فرستد. */
export const ONBOARDING_DONE_COOKIE = "karjoo_onboarding_done";

export interface SetupStatus {
  resume: boolean;
  targeting: boolean;
  connected: boolean;
  /** نامِ سایت‌های متصل (برای نمایش). */
  connectedBoards: string[];
  completed: number;
  total: number;
}

async function safe<T>(run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch {
    return fallback;
  }
}

export async function getSetupStatus(userId: string): Promise<SetupStatus> {
  const [resume, targeting, accounts] = await Promise.all([
    safe(async () => {
      const [profile, files] = await Promise.all([
        getResumeProfile(userId),
        getResumeFiles(userId),
      ]);
      return isResumeReady(profile, files.length);
    }, false),
    safe(async () => isTargetingReady(await readApplyFilters(userId)), false),
    safe(() => getBoardAccountsForUser(userId), []),
  ]);
  const connected = isBoardConnected(accounts);
  const steps = [resume, targeting, connected];
  return {
    resume,
    targeting,
    connected,
    connectedBoards: accounts.filter((a) => a.status === "connected").map((a) => a.board),
    completed: steps.filter(Boolean).length,
    total: steps.length,
  };
}
