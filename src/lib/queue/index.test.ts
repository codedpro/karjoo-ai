/**
 * تست‌های واحدِ صفِ Postgres — بدون DB/شبکه‌ی زنده.
 *
 * استراتژی: یک «DB جعلی» (`FakeQueueDb`) می‌سازیم که فقط `execute(sql)` را پیاده می‌کند.
 * چون منطقِ صف عمداً همه‌ی تصمیم‌ها را در *یک statementِ SQL* می‌گذارد (اتمیک، امن در
 * برابرِ رقابت)، اینجا SQLِ تولیدشده را وارسی می‌کنیم و ردیف‌های جعلی برمی‌گردانیم.
 * این تست‌ها قرارداد (idempotency, claim-then-lease, backoff/dead) را قفل می‌کنند؛
 * رفتارِ واقعیِ SKIP LOCKED در تستِ integration (که DATABASE_URL لازم دارد) پوشش می‌یابد.
 */
import { describe, expect, it } from "vitest";
import type { SQL } from "drizzle-orm";

import {
  backoffMs,
  claim,
  complete,
  enqueue,
  fail,
  DEFAULT_BACKOFF,
  type QueueDb,
} from "@/lib/queue";

/** کمک: SQLِ Drizzle را به متنِ تقریبیِ خوانا تبدیل می‌کند (برای assertion). */
function sqlToText(query: SQL): string {
  // نمایشِ داخلیِ Drizzle: زنجیره‌ای از chunkها. متنِ خام را به‌هم می‌چسبانیم.
  const chunks = (query as unknown as { queryChunks: unknown[] }).queryChunks ?? [];
  return chunks
    .map((c) => {
      if (typeof c === "string") return c;
      if (c && typeof c === "object" && "value" in c) {
        const v = (c as { value: unknown }).value;
        return Array.isArray(v) ? v.join("") : String(v);
      }
      return "";
    })
    .join(" ");
}

/** DBِ جعلی: هر فراخوانیِ execute را ثبت می‌کند و پاسخِ از پیش‌تعیین‌شده می‌دهد. */
class FakeQueueDb implements QueueDb {
  public calls: { text: string; query: SQL }[] = [];
  private responses: Record<string, unknown>[][];
  private idx = 0;

  constructor(responses: Record<string, unknown>[][] = [[]]) {
    this.responses = responses;
  }

  async execute<TRow extends Record<string, unknown> = Record<string, unknown>>(
    query: ReturnType<typeof import("drizzle-orm").sql>,
  ): Promise<Iterable<TRow> & ArrayLike<TRow>> {
    this.calls.push({ text: sqlToText(query as unknown as SQL), query: query as unknown as SQL });
    const rows = (this.responses[this.idx] ?? []) as unknown as TRow[];
    this.idx += 1;
    return rows as unknown as Iterable<TRow> & ArrayLike<TRow>;
  }
}

const sampleTask = (over: Record<string, unknown> = {}) => ({
  id: "11111111-1111-1111-1111-111111111111",
  idempotency_key: "apply:m1",
  match_id: "m1",
  status: "pending",
  attempts: 0,
  max_attempts: 5,
  ...over,
});

describe("backoffMs", () => {
  it("نمایی رشد می‌کند: base، base*2، base*4، …", () => {
    expect(backoffMs(1)).toBe(DEFAULT_BACKOFF.baseMs);
    expect(backoffMs(2)).toBe(DEFAULT_BACKOFF.baseMs * 2);
    expect(backoffMs(3)).toBe(DEFAULT_BACKOFF.baseMs * 4);
  });

  it("به سقفِ maxMs محدود می‌شود", () => {
    expect(backoffMs(100)).toBe(DEFAULT_BACKOFF.maxMs);
  });

  it("ورودیِ نامعتبر (۰/منفی) را امن مدیریت می‌کند → حداقل یک تلاش", () => {
    expect(backoffMs(0)).toBe(DEFAULT_BACKOFF.baseMs);
    expect(backoffMs(-5)).toBe(DEFAULT_BACKOFF.baseMs);
  });

  it("پیکربندیِ سفارشی را رعایت می‌کند", () => {
    expect(backoffMs(2, { baseMs: 1000, maxMs: 10_000 })).toBe(2000);
    expect(backoffMs(10, { baseMs: 1000, maxMs: 10_000 })).toBe(10_000);
  });
});

describe("enqueue", () => {
  it("ردیفِ تازه را با ON CONFLICT DO NOTHING درج می‌کند و created=true می‌دهد", async () => {
    const fake = new FakeQueueDb([[sampleTask()]]);
    const { task, created } = await enqueue(
      { idempotencyKey: "apply:m1", matchId: "m1" },
      fake,
    );

    expect(created).toBe(true);
    expect(task.id).toBe(sampleTask().id);
    expect(fake.calls).toHaveLength(1);
    const text = fake.calls[0].text.toLowerCase();
    expect(text).toContain("insert into tasks");
    expect(text).toContain("on conflict");
    expect(text).toContain("do nothing");
    expect(text).toContain("returning");
  });

  it("idempotent: روی برخورد، ردیفِ موجود را با SELECT می‌خواند و created=false می‌دهد", async () => {
    // درج چیزی برنمی‌گرداند (RETURNING خالی) → سپس SELECT ردیفِ موجود را می‌دهد.
    const existing = sampleTask({ attempts: 2 });
    const fake = new FakeQueueDb([[], [existing]]);

    const { task, created } = await enqueue(
      { idempotencyKey: "apply:m1", matchId: "m1" },
      fake,
    );

    expect(created).toBe(false);
    expect(task.attempts).toBe(2);
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1].text.toLowerCase()).toContain("select * from tasks");
  });

  it("اگر نه درج موفق باشد نه ردیفِ موجود یافت شود، خطای روشن می‌دهد", async () => {
    const fake = new FakeQueueDb([[], []]);
    await expect(
      enqueue({ idempotencyKey: "apply:ghost", matchId: "m1" }, fake),
    ).rejects.toThrow(/نه ردیف تازه/);
  });
});

describe("claim", () => {
  it("با FOR UPDATE SKIP LOCKED به‌صورت اتمیک lease می‌کند و RETURNING می‌دهد", async () => {
    const leased = sampleTask({ status: "leased", attempts: 1 });
    const fake = new FakeQueueDb([[leased]]);

    const tasks = await claim("worker-1", 5, fake);

    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe("leased");
    const text = fake.calls[0].text.toLowerCase();
    expect(text).toContain("update tasks");
    expect(text).toContain("for update skip locked");
    expect(text).toContain("status = 'leased'");
    expect(text).toContain("attempts = t.attempts + 1");
    expect(text).toContain("returning");
  });

  it("limit=0 → بدونِ هیچ کوئری، آرایه‌ی خالی برمی‌گرداند", async () => {
    const fake = new FakeQueueDb([[]]);
    const tasks = await claim("w", 0, fake);
    expect(tasks).toEqual([]);
    expect(fake.calls).toHaveLength(0);
  });

  it("workerId می‌تواند null باشد (مصرف‌کننده‌ی غیرکارگری مثل افزونه)", async () => {
    const fake = new FakeQueueDb([[sampleTask({ status: "leased" })]]);
    const tasks = await claim(null, 1, fake);
    expect(tasks).toHaveLength(1);
  });
});

describe("complete", () => {
  it("وضعیت را succeeded می‌کند، قفل را آزاد و payload را merge می‌کند", async () => {
    const done = sampleTask({ status: "succeeded" });
    const fake = new FakeQueueDb([[done]]);

    const task = await complete("task-1", { externalRef: "JV-42" }, fake);

    expect(task?.status).toBe("succeeded");
    const text = fake.calls[0].text.toLowerCase();
    expect(text).toContain("status = 'succeeded'");
    expect(text).toContain("payload = payload ||");
    expect(text).toContain("leased_by = null");
  });
});

describe("fail", () => {
  it("backoff/dead را در یک statement سمتِ DB تصمیم می‌گیرد", async () => {
    const requeued = sampleTask({ status: "pending", last_error: "boom" });
    const fake = new FakeQueueDb([[requeued]]);

    const task = await fail("task-1", "boom", DEFAULT_BACKOFF, fake);

    expect(task?.status).toBe("pending");
    const text = fake.calls[0].text.toLowerCase();
    // منطقِ dead-vs-retry سمتِ DB با CASE روی attempts>=max_attempts.
    expect(text).toContain("attempts >= max_attempts");
    expect(text).toContain("'dead'");
    expect(text).toContain("run_after = case");
    expect(text).toContain("leased_by = null");
  });

  it("متنِ خطای خیلی بلند را به ۴۰۰۰ کاراکتر برش می‌دهد (محافظ)", async () => {
    const long = "x".repeat(10_000);
    let capturedChunks: unknown[] = [];
    const fake: QueueDb = {
      async execute(query) {
        // مقادیرِ bind در Drizzle به‌صورتِ chunkهای رشته‌ایِ خام ذخیره می‌شوند؛
        // chunkِ مربوط به خطا باید دقیقاً ۴۰۰۰ کاراکترِ 'x' باشد.
        capturedChunks = (query as unknown as { queryChunks: unknown[] }).queryChunks;
        return [sampleTask()] as never;
      },
    };
    await fail("task-1", long, DEFAULT_BACKOFF, fake);
    const errChunk = capturedChunks.find(
      (c) => typeof c === "string" && /^x+$/.test(c),
    );
    expect(errChunk).toBeDefined();
    expect((errChunk as string).length).toBe(4000);
  });
});
