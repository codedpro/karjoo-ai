import "server-only";

/**
 * کلاینت گیت‌وی 1xai (server-only).
 *
 * تمام فراخوانی‌های مدل کارجو از همین‌جا می‌گذرند. هیچ‌جای کد نباید URL یا کلید یک
 * provider خاص را hard-wire کند؛ همه‌چیز از env (ONEXAI_BASE_URL/API_KEY/MODEL)
 * می‌آید و در صورت نبودنشان `requireOneXai()` خطای روشن می‌دهد.
 *
 * طراحی با «درز آداپتور» (adapter seam):
 *   • به‌صورت پیش‌فرض شکل OpenAI-compatible `POST {baseUrl}/chat/completions` را می‌زند.
 *   • اما منطق ساخت درخواست و خواندن پاسخ در یک آبجکت `ChatAdapter` کپسوله شده تا اگر
 *     روزی گیت‌وی پروتکل دیگری خواست، فقط یک آداپتور تازه تزریق شود — نه بازنویسی کل لایه.
 *   • تزریق `fetch` و `adapter` از طریق options، تست بدون شبکه را ممکن می‌کند.
 *
 * خروجی ساختاریافته (JSON): با `responseFormat: "json"` فیلد
 * `response_format: { type: "json_object" }` به درخواست افزوده می‌شود و پاسخ به‌صورت
 * JSON پارس می‌شود. اعتبارسنجی شکل نهایی با zod، در فراخواننده (scoring/ai) انجام می‌گیرد.
 */
import { requireOneXai } from "@/lib/env";

/** نقش‌های استاندارد پیام چت (سازگار با OpenAI). */
export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatCompletionRequest {
  messages: ChatMessage[];
  /** override مدل پیش‌فرضِ env (اختیاری). */
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /**
   * شکل خروجی موردانتظار:
   *   • `text` (پیش‌فرض) — متن آزاد.
   *   • `json`           — به مدل گفته می‌شود فقط JSON بدهد (response_format).
   */
  responseFormat?: "text" | "json";
}

/** پاسخ نرمال‌شده‌ی یک فراخوانی چت. */
export interface ChatCompletionResult {
  /** متن خام پاسخ مدل. */
  content: string;
  /** مدلی که واقعاً پاسخ داد (طبق گزارش گیت‌وی، در صورت وجود). */
  model?: string;
  /** مصرف توکن، در صورت گزارش گیت‌وی. */
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
}

/** پیکربندیِ حل‌شده‌ی گیت‌وی (از env). */
export interface GatewayConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/**
 * درز آداپتور: تبدیل قرارداد داخلی ما ↔ سیم پروتکل گیت‌وی.
 *   • `buildRequest` — از یک درخواست داخلی، URL/هدر/بدنه‌ی HTTP می‌سازد.
 *   • `parseResponse` — از بدنه‌ی JSONِ خام پاسخ، نتیجه‌ی نرمال‌شده درمی‌آورد.
 * پیاده‌سازی پیش‌فرض، OpenAI-compatible است (پایین).
 */
export interface ChatAdapter {
  buildRequest(
    config: GatewayConfig,
    req: ChatCompletionRequest,
  ): { url: string; init: RequestInit };
  parseResponse(raw: unknown): ChatCompletionResult;
}

/** نوع تزریق‌پذیرِ fetch (برای تست بدون شبکه). */
export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface GatewayOptions {
  /** override پیکربندی env (برای تست/سناریوهای خاص). */
  config?: GatewayConfig;
  /** override fetch (برای تست بدون شبکه). */
  fetchImpl?: FetchLike;
  /** override آداپتور پروتکل (پیش‌فرض: OpenAI-compatible). */
  adapter?: ChatAdapter;
}

/** کدهای خطای پایدارِ این لایه — برای مدیریت دقیق در فراخواننده. */
export type GatewayErrorCode =
  | "not_configured" // env تنظیم نشده (از requireOneXai)
  | "http_error" // گیت‌وی کد غیر-۲xx برگرداند
  | "network_error" // fetch شکست خورد (قطعی/تایم‌اوت)
  | "invalid_response" // بدنه‌ی پاسخ غیرقابل‌پارس یا بدون محتوا
  | "invalid_json"; // responseFormat=json بود اما محتوا JSON معتبر نبود

/** خطای typed این لایه. */
export class GatewayError extends Error {
  readonly code: GatewayErrorCode;
  readonly status?: number;
  readonly cause?: unknown;

  constructor(
    code: GatewayErrorCode,
    message: string,
    opts?: { status?: number; cause?: unknown },
  ) {
    super(message);
    this.name = "GatewayError";
    this.code = code;
    this.status = opts?.status;
    this.cause = opts?.cause;
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * آداپتور پیش‌فرض: OpenAI-compatible chat/completions
 * ────────────────────────────────────────────────────────────────────────── */

/** اتصال baseUrl و مسیر بدون «//» اضافه یا مسیر گم‌شده. */
function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export const openAiChatAdapter: ChatAdapter = {
  buildRequest(config, req) {
    const body: Record<string, unknown> = {
      model: req.model ?? config.model,
      messages: req.messages,
    };
    if (typeof req.temperature === "number") body.temperature = req.temperature;
    if (typeof req.maxTokens === "number") body.max_tokens = req.maxTokens;
    if (req.responseFormat === "json") {
      body.response_format = { type: "json_object" };
    }

    return {
      url: joinUrl(config.baseUrl, "chat/completions"),
      init: {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
      },
    };
  },

  parseResponse(raw) {
    // شکل موردانتظار OpenAI: { choices: [{ message: { content } }], model, usage }
    const obj = raw as {
      choices?: { message?: { content?: unknown } }[];
      model?: unknown;
      usage?: {
        prompt_tokens?: unknown;
        completion_tokens?: unknown;
        total_tokens?: unknown;
      };
    };

    const content = obj?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.length === 0) {
      throw new GatewayError(
        "invalid_response",
        "پاسخ گیت‌وی فاقد محتوای متنی معتبر بود (choices[0].message.content).",
      );
    }

    const usage = obj.usage
      ? {
          promptTokens: numOrUndef(obj.usage.prompt_tokens),
          completionTokens: numOrUndef(obj.usage.completion_tokens),
          totalTokens: numOrUndef(obj.usage.total_tokens),
        }
      : undefined;

    return {
      content,
      model: typeof obj.model === "string" ? obj.model : undefined,
      usage,
    };
  },
};

function numOrUndef(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/* ──────────────────────────────────────────────────────────────────────────
 * کلاینت گیت‌وی
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * یک فراخوانی چت به گیت‌وی 1xai.
 *
 * اگر env هوش مصنوعی تنظیم نشده باشد، `requireOneXai()` یک `GatewayError` با کد
 * `not_configured` می‌اندازد (نه ۴۰۱ مبهم). خطاهای HTTP/شبکه/پارس هم typed برمی‌گردند.
 */
export async function chatComplete(
  req: ChatCompletionRequest,
  opts: GatewayOptions = {},
): Promise<ChatCompletionResult> {
  const config = opts.config ?? resolveConfig();
  const adapter = opts.adapter ?? openAiChatAdapter;
  const doFetch = (opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike)) satisfies FetchLike;

  const { url, init } = adapter.buildRequest(config, req);

  let res: { ok: boolean; status: number; text(): Promise<string> };
  try {
    res = await doFetch(url, init);
  } catch (cause) {
    throw new GatewayError(
      "network_error",
      "اتصال به گیت‌وی 1xai ناموفق بود (شبکه/تایم‌اوت).",
      { cause },
    );
  }

  const bodyText = await res.text();

  if (!res.ok) {
    throw new GatewayError(
      "http_error",
      `گیت‌وی 1xai کد ${res.status} برگرداند: ${truncate(bodyText, 300)}`,
      { status: res.status },
    );
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(bodyText);
  } catch (cause) {
    throw new GatewayError(
      "invalid_response",
      "بدنه‌ی پاسخ گیت‌وی JSON معتبر نبود.",
      { cause },
    );
  }

  return adapter.parseResponse(parsedBody);
}

/**
 * نسخه‌ی راحتِ «خروجی JSON ساختاریافته».
 *
 * `responseFormat: "json"` را تنظیم می‌کند، متن پاسخ را JSON.parse می‌کند و در صورت
 * شکستِ پارس، `GatewayError("invalid_json")` می‌اندازد. اعتبارسنجی شکل دقیق (zod)
 * مسئولیت فراخواننده است؛ این تابع فقط تضمین می‌کند خروجی یک «شیء JSON» است.
 */
export async function chatCompleteJson(
  req: Omit<ChatCompletionRequest, "responseFormat">,
  opts: GatewayOptions = {},
): Promise<{ data: unknown; result: ChatCompletionResult }> {
  const result = await chatComplete({ ...req, responseFormat: "json" }, opts);

  let data: unknown;
  try {
    data = JSON.parse(stripJsonFence(result.content));
  } catch (cause) {
    throw new GatewayError(
      "invalid_json",
      `خروجی مدل JSON معتبر نبود: ${truncate(result.content, 300)}`,
      { cause },
    );
  }

  return { data, result };
}

/**
 * حل پیکربندی از env. اگر هر متغیر 1xai غایب باشد، خطای `not_configured` (typed)
 * می‌دهد به‌جای خطای خام `requireOneXai`.
 */
function resolveConfig(): GatewayConfig {
  try {
    return requireOneXai();
  } catch (cause) {
    throw new GatewayError(
      "not_configured",
      cause instanceof Error
        ? cause.message
        : "سرویس هوش مصنوعی پیکربندی نشده است (ONEXAI_*).",
      { cause },
    );
  }
}

/**
 * گاهی مدل‌ها خروجی JSON را داخل بلوک ```json می‌پیچند؛ این تابع چنین حصاری را
 * (در صورت وجود) برمی‌دارد تا JSON.parse موفق شود. اگر حصاری نبود، متن دست‌نخورده برمی‌گردد.
 */
function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fence ? fence[1].trim() : trimmed;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
