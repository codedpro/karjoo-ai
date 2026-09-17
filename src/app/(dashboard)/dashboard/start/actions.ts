"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ONBOARDING_DONE_COOKIE } from "@/lib/onboarding/setup-status";

/**
 * راهنمای شروع را برای این مرورگر تمام‌شده علامت می‌زند (پایان یا «بعداً») و به خانه
 * برمی‌گرداند؛ خانه دیگر کاربر را خودکار به راهنما نمی‌فرستد. چک‌لیستِ خانه تا کامل‌شدنِ
 * گام‌ها سرِ جایش می‌ماند.
 */
export async function finishOnboardingAction(): Promise<void> {
  const store = await cookies();
  store.set(ONBOARDING_DONE_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect("/dashboard");
}
