/**
 * تست‌های گیت‌وی 1xai — بدون شبکه (fetch تزریق‌شده/mock).
 *
 * پوشش:
 *   • ساخت درخواست OpenAI-compatible (URL، هدر Authorization، بدنه، response_format).
 *   • پارس پاسخ و استخراج content/usage.
 *   • خطای روشن وقتی env تنظیم نشده (not_configured).
 *   • خطاهای HTTP / شبکه / JSON نامعتبر.
 *   • درز آداپتور: تعویض پروتکل بدون بازنویسی کلاینت.
 */
import { describe, expect, it, vi } from "vitest";

import {
  chatComplete,
  chatCompleteJson,
  GatewayError,
  openAiChatAdapter,
  type ChatAdapter,
  type FetchLike,
  type GatewayConfig,
} from "@/lib/ai/gateway";

const CONFIG: GatewayConfig = {
  baseUrl: "https://gw.1xai.example/v1",
  apiKey: "sk-test-key",
  model: "gpt-test",
};

/** یک fetchِ mock که پاسخ دلخواه با وضعیت دلخواه می‌دهد و فراخوانی را ثبت می‌کند. */
function mockFetch(
  bodyObj: unknown,
  init: { ok?: boolean; status?: number } = {},
): { fetchImpl: FetchLike; calls: { url: string; init?: RequestInit }[] } {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl: FetchLike = async (url, reqInit) => {
    calls.push({ url, init: reqInit });
    return {
      ok: init.ok ?? true,
      status: init.status ?? 200,
      text: async () =>
        typeof bodyObj === "string" ? bodyObj : JSON.stringify(bodyObj),
    };
  };
  return { fetchImpl, calls };
}

/** پاسخ OpenAI-مانندِ نمونه. */
function openAiBody(content: string) {
  return {
    model: "gpt-test",
    choices: [{ message: { role: "assistant", content } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

describe("openAiChatAdapter.buildRequest", () => {
  it("URL درست، هدر Bearer و بدنه‌ی استاندارد می‌سازد", () => {
    const { url, init } = openAiChatAdapter.buildRequest(CONFIG, {
      messages: [{ role: "user", content: "سلام" }],
      temperature: 0.4,
      maxTokens: 256,
    });

    expect(url).toBe("https://gw.1xai.example/v1/chat/completions");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-test-key");
    expect(headers["content-type"]).toBe("application/json");

    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("gpt-test");
    expect(body.temperature).toBe(0.4);
    expect(body.max_tokens).toBe(256);
    expect(body.messages).toEqual([{ role: "user", content: "سلام" }]);
    // بدون responseFormat نباید response_format بگذارد.
    expect(body.response_format).toBeUndefined();
  });

  it("با responseFormat=json فیلد response_format را می‌گذارد و override مدل را می‌پذیرد", () => {
    const { init } = openAiChatAdapter.buildRequest(CONFIG, {
      messages: [{ role: "user", content: "x" }],
      responseFormat: "json",
      model: "override-model",
    });
    const body = JSON.parse(init.body as string);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.model).toBe("override-model");
  });
});

describe("chatComplete", () => {
  it("محتوا و usage را از پاسخ استخراج می‌کند و درخواست را درست می‌زند", async () => {
    const { fetchImpl, calls } = mockFetch(openAiBody("پاسخ مدل"));
    const res = await chatComplete(
      { messages: [{ role: "user", content: "سؤال" }] },
      { config: CONFIG, fetchImpl },
    );

    expect(res.content).toBe("پاسخ مدل");
    expect(res.model).toBe("gpt-test");
    expect(res.usage).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://gw.1xai.example/v1/chat/completions");
  });

  it("روی کد غیر-۲xx خطای http_error می‌دهد", async () => {
    const { fetchImpl } = mockFetch("rate limited", { ok: false, status: 429 });
    const err = await chatComplete(
      { messages: [{ role: "user", content: "x" }] },
      { config: CONFIG, fetchImpl },
    ).catch((e) => e);

    expect(err).toBeInstanceOf(GatewayError);
    expect(err.code).toBe("http_error");
    expect(err.status).toBe(429);
  });

  it("روی شکست fetch خطای network_error می‌دهد", async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error("ECONNRESET");
    };
    const err = await chatComplete(
      { messages: [{ role: "user", content: "x" }] },
      { config: CONFIG, fetchImpl },
    ).catch((e) => e);

    expect(err).toBeInstanceOf(GatewayError);
    expect(err.code).toBe("network_error");
  });

  it("روی بدنه‌ی غیرقابل‌پارس یا بدون content خطای invalid_response می‌دهد", async () => {
    const noContent = mockFetch({ choices: [{ message: {} }] });
    const err = await chatComplete(
      { messages: [{ role: "user", content: "x" }] },
      { config: CONFIG, fetchImpl: noContent.fetchImpl },
    ).catch((e) => e);
    expect(err).toBeInstanceOf(GatewayError);
    expect(err.code).toBe("invalid_response");
  });

  it("گاردریل: اگر maxTokens داده نشده باشد، سقفِ پیش‌فرض را اعمال می‌کند", async () => {
    const { fetchImpl, calls } = mockFetch(openAiBody("ok"));
    await chatComplete(
      { messages: [{ role: "user", content: "x" }] },
      { config: CONFIG, fetchImpl, maxOutputTokens: 777 },
    );
    const body = JSON.parse(calls[0].init!.body as string);
    expect(body.max_tokens).toBe(777);
  });

  it("گاردریل: maxTokensِ صریحِ فراخواننده را بازنویسی نمی‌کند", async () => {
    const { fetchImpl, calls } = mockFetch(openAiBody("ok"));
    await chatComplete(
      { messages: [{ role: "user", content: "x" }], maxTokens: 42 },
      { config: CONFIG, fetchImpl, maxOutputTokens: 777 },
    );
    const body = JSON.parse(calls[0].init!.body as string);
    expect(body.max_tokens).toBe(42);
  });

  it("گاردریل: تایم‌اوت ⇒ AbortController و خطای network_error", async () => {
    // fetchِ کند که فقط با لغوِ signal رد می‌شود (شبیه‌سازیِ تایم‌اوت).
    const fetchImpl: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        const signal = (init as RequestInit | undefined)?.signal;
        signal?.addEventListener("abort", () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        });
      });
    const err = await chatComplete(
      { messages: [{ role: "user", content: "x" }] },
      { config: CONFIG, fetchImpl, timeoutMs: 5 },
    ).catch((e) => e);
    expect(err).toBeInstanceOf(GatewayError);
    expect(err.code).toBe("network_error");
    expect(err.message).toMatch(/تایم‌اوت/);
  });

  it("درز آداپتور: پروتکل قابل تعویض است", async () => {
    const customAdapter: ChatAdapter = {
      buildRequest: (cfg, req) => ({
        url: `${cfg.baseUrl}/custom`,
        init: { method: "POST", body: JSON.stringify({ q: req.messages }) },
      }),
      parseResponse: (raw) => ({ content: (raw as { answer: string }).answer }),
    };
    const { fetchImpl, calls } = mockFetch({ answer: "از آداپتور سفارشی" });
    const res = await chatComplete(
      { messages: [{ role: "user", content: "x" }] },
      { config: CONFIG, fetchImpl, adapter: customAdapter },
    );
    expect(res.content).toBe("از آداپتور سفارشی");
    expect(calls[0].url).toBe("https://gw.1xai.example/v1/custom");
  });
});

describe("chatComplete — env پیکربندی‌نشده", () => {
  it("وقتی ONEXAI_* تنظیم نشده، خطای not_configured می‌دهد (نه ۴۰۱ مبهم)", async () => {
    // env واقعی را موقتاً پاک می‌کنیم تا requireOneXai از کار بیفتد. چون env در ماژول
    // یک‌بار خوانده می‌شود، resetModules لازم است تا lib/env دوباره ساخته شود.
    const prev = {
      base: process.env.ONEXAI_BASE_URL,
      key: process.env.ONEXAI_API_KEY,
      model: process.env.ONEXAI_MODEL,
    };
    delete process.env.ONEXAI_BASE_URL;
    delete process.env.ONEXAI_API_KEY;
    delete process.env.ONEXAI_MODEL;
    process.env.DATABASE_URL ??= "postgres://x:y@localhost:5432/z";

    vi.resetModules();
    try {
      const fresh = await import("@/lib/ai/gateway");
      const err = await fresh
        .chatComplete(
          { messages: [{ role: "user", content: "x" }] },
          { fetchImpl: async () => ({ ok: true, status: 200, text: async () => "{}" }) },
        )
        .catch((e) => e);
      expect(err).toBeInstanceOf(fresh.GatewayError);
      expect(err.code).toBe("not_configured");
      expect(err.message).toMatch(/ONEXAI/);
    } finally {
      if (prev.base !== undefined) process.env.ONEXAI_BASE_URL = prev.base;
      if (prev.key !== undefined) process.env.ONEXAI_API_KEY = prev.key;
      if (prev.model !== undefined) process.env.ONEXAI_MODEL = prev.model;
      vi.resetModules();
    }
  });
});

describe("chatCompleteJson", () => {
  it("خروجی JSON را پارس می‌کند", async () => {
    const { fetchImpl } = mockFetch(openAiBody('{"matchScore":0.8}'));
    const { data } = await chatCompleteJson(
      { messages: [{ role: "user", content: "x" }] },
      { config: CONFIG, fetchImpl },
    );
    expect(data).toEqual({ matchScore: 0.8 });
  });

  it("حصار ```json را برمی‌دارد و پارس می‌کند", async () => {
    const fenced = "```json\n{\"coverLetter\":\"سلام\"}\n```";
    const { fetchImpl } = mockFetch(openAiBody(fenced));
    const { data } = await chatCompleteJson(
      { messages: [{ role: "user", content: "x" }] },
      { config: CONFIG, fetchImpl },
    );
    expect(data).toEqual({ coverLetter: "سلام" });
  });

  it("روی JSON نامعتبرِ مدل خطای invalid_json می‌دهد", async () => {
    const { fetchImpl } = mockFetch(openAiBody("این JSON نیست"));
    const err = await chatCompleteJson(
      { messages: [{ role: "user", content: "x" }] },
      { config: CONFIG, fetchImpl },
    ).catch((e) => e);
    expect(err).toBeInstanceOf(GatewayError);
    expect(err.code).toBe("invalid_json");
  });

  it("response_format را روی درخواست تنظیم می‌کند", async () => {
    const { fetchImpl, calls } = mockFetch(openAiBody("{}"));
    await chatCompleteJson(
      { messages: [{ role: "user", content: "x" }] },
      { config: CONFIG, fetchImpl },
    );
    const body = JSON.parse(calls[0].init!.body as string);
    expect(body.response_format).toEqual({ type: "json_object" });
  });
});
