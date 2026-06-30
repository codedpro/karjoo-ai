/**
 * استنتاجِ ارائه‌دهنده (provider) از پیشوندِ نامِ مدل — هم‌راستا با مسیریابیِ گیت‌وی 1xai:
 *   gpt-* / o[0-9]* → openai، claude-* → anthropic، gemini-* → google.
 *
 * این فایل «server-only» نیست: یک تابعِ خالصِ بدونِ I/O است که هم در کاتالوگ‌سینک و
 * هم در تست استفاده می‌شود.
 */
import type { AiProvider } from "@/db/schema";

/**
 * ارائه‌دهنده را از modelId حدس می‌زند. پیش‌فرضِ امن: openai (خانواده‌ی gpt/o-series).
 */
export function providerFromModelId(modelId: string): AiProvider {
  const id = modelId.trim().toLowerCase();
  if (id.startsWith("claude")) return "anthropic";
  if (id.startsWith("gemini")) return "google";
  // gpt-*، o1/o3/o4-* و سایرِ خانواده‌های OpenAI.
  return "openai";
}
