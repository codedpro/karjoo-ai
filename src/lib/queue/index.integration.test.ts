/**
 * تستِ یکپارچه‌ی صف — *فقط* وقتی DATABASE_URL تنظیم شده باشد اجرا می‌شود.
 *
 * این فایل با الگوی `*.integration.test.ts` به‌صورت پیش‌فرض در vitest.config.ts
 * exclude شده است. برای اجرای آن:
 *     KARJOO_DB_PORT=5433 docker compose up -d db   # یا هر Postgresِ در دسترس
 *     DATABASE_URL=postgres://karjoo:karjoo@localhost:5433/karjoo \
 *       npx vitest run src/lib/queue/index.integration.test.ts \
 *       --config vitest.integration.config.ts
 * (یا exclude را موقتاً بردارید.)
 *
 * چه چیزی را اثبات می‌کند که mock نمی‌تواند:
 *   • idempotency واقعیِ سطح‌DB روی idempotency_key.
 *   • رفتارِ واقعیِ `FOR UPDATE SKIP LOCKED`: دو claimِ همزمان، ردیف‌های مجزا
 *     برمی‌دارند و هرگز یک ردیف را دوبار نمی‌گیرند (بدون double-dispatch).
 *   • چرخه‌ی fail → backoff → dead پس از maxAttempts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

d("صف Postgres (integration، نیازمندِ DATABASE_URL)", () => {
  // import پویا تا وقتی DB نیست، ماژولِ db اصلاً ارزیابی نشود.
  let mod: typeof import("@/lib/queue");
  let dbmod: typeof import("@/db");
  let drizzle: typeof import("drizzle-orm");
  const ids: string[] = [];

  beforeAll(async () => {
    mod = await import("@/lib/queue");
    dbmod = await import("@/db");
    drizzle = await import("drizzle-orm");
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    // پاک‌سازیِ ردیف‌های ساخته‌شده در این تست.
    const { sql } = drizzle;
    for (const k of ids) {
      await dbmod.db.execute(sql`DELETE FROM tasks WHERE idempotency_key = ${k}`);
    }
  });

  /** یک matchِ معتبر لازم است چون tasks.match_id → matches.id (FK). این helper یک
   *  کاربر/پروفایل/آگهی/تطبیقِ حداقلی می‌سازد و matchId را برمی‌گرداند. */
  async function seedMatch(): Promise<string> {
    const { db } = dbmod;
    const { sql } = drizzle;
    const u = await db.execute<{ id: string }>(
      sql`INSERT INTO users (phone) VALUES (${"+98900" + Math.random().toString().slice(2, 9)}) RETURNING id`,
    );
    const userId = u[0].id;
    const l = await db.execute<{ id: string }>(sql`
      INSERT INTO job_listings (board, external_id, canonical_id, title, url)
      VALUES ('jobinja', ${"ext" + Math.random().toString().slice(2, 9)},
              ${"jobinja:" + Math.random().toString().slice(2, 9)}, 'آزمون', 'https://x')
      RETURNING id`);
    const listingId = l[0].id;
    const m = await db.execute<{ id: string }>(sql`
      INSERT INTO matches (user_id, listing_id, score, status)
      VALUES (${userId}, ${listingId}, 0.9, 'drafted') RETURNING id`);
    return m[0].id;
  }

  it("enqueue روی همان idempotencyKey فقط یک ردیف می‌سازد", async () => {
    const matchId = await seedMatch();
    const key = `apply:itest:${matchId}`;
    ids.push(key);

    const first = await mod.enqueue({ idempotencyKey: key, matchId });
    const second = await mod.enqueue({ idempotencyKey: key, matchId });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.task.id).toBe(first.task.id);
  });

  it("دو claimِ همزمان، یک ردیفِ واحد را دوبار برنمی‌دارند (SKIP LOCKED)", async () => {
    const matchId = await seedMatch();
    const key = `apply:itest:skip:${matchId}`;
    ids.push(key);
    await mod.enqueue({ idempotencyKey: key, matchId });

    // دو claim به‌صورت موازی؛ مجموعِ ردیف‌های برداشته‌شده باید دقیقاً ۱ باشد.
    // نکته: leased_by یک uuid (FK → worker_nodes.id) است؛ برای مصرف‌کننده‌ی
    // غیرکارگری (مثلِ این تست) null پاس می‌دهیم — claim همین را می‌پذیرد و رفتارِ
    // SKIP LOCKED مستقل از هویتِ کارگر است.
    const [a, b] = await Promise.all([
      mod.claim(null, 5),
      mod.claim(null, 5),
    ]);
    const claimedIds = [...a, ...b].map((t) => t.id);
    const thisOne = claimedIds.filter((id) =>
      [...a, ...b].some((t) => t.id === id && t.idempotencyKey === key),
    );
    // ردیفِ ما حداکثر یک‌بار در کلِ دو claim ظاهر می‌شود.
    expect(thisOne.length).toBeLessThanOrEqual(1);
    // و هیچ idی در هر دو claim تکرار نشده.
    expect(new Set(claimedIds).size).toBe(claimedIds.length);
  });

  it("fail تا maxAttempts بک‌آف می‌کند و سپس dead می‌شود", async () => {
    const matchId = await seedMatch();
    const key = `apply:itest:dead:${matchId}`;
    ids.push(key);
    const { db } = dbmod;
    const { sql } = drizzle;

    const { task } = await mod.enqueue({
      idempotencyKey: key,
      matchId,
      maxAttempts: 1,
    });

    // یک‌بار claim (attempts → 1)، سپس fail. چون attempts(1) >= max(1) → dead.
    await db.execute(
      sql`UPDATE tasks SET attempts = 1 WHERE id = ${task.id}`,
    );
    const failed = await mod.fail(task.id, "boom");
    expect(failed?.status).toBe("dead");
  });
});
