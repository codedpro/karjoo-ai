/**
 * مهاجرتِ یک‌باره به کیف‌پول/هویتِ واحدِ 1xai — با tsx اجرا می‌شود:
 *   npx tsx --conditions=react-server src/scripts/backfill-onexai.ts
 *
 * دو کار (هر دو idempotent — اجرای دوباره امن است):
 *   ۱) گره: هر کاربرِ کارجو که email دارد و onexai_user_id ندارد → resolve در استخرِ
 *      مشترک (find-or-create با email+googleSub) و ذخیره‌ی شناسه.
 *   ۲) پول: هر کاربری که در کیف‌پولِ محلیِ بازنشسته موجودیِ مثبت دارد → همان مبلغ به
 *      کیف‌پولِ واحدِ 1xai واریز (kind=adjustment، reference=karjoo:migrate:<userId> —
 *      ایندکسِ یکتای سمتِ 1xai دوباره‌واریزی را ناممکن می‌کند)، سپس کیف‌پولِ محلی با
 *      یک ردیفِ دفترِ 'charge' (refType=migration) صفر می‌شود تا حسابرسی شفاف بماند.
 *
 * مثلِ seed-catalog.ts بیرونِ Next اجرا می‌شود: اول dotenv، بعد importِ پویا تا
 * اعتبارسنجیِ env نشکند.
 */
import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

async function main() {
  const { db } = await import("@/db");
  const { users, wallets } = await import("@/db/schema");
  const { isNull, isNotNull, and, eq, gt } = await import("drizzle-orm");
  const { resolveUser, creditPool } = await import("@/lib/onexai/svc");
  const { debit } = await import("@/lib/billing/wallet");

  // ۱) گرهِ هویت.
  const unlinked = await db
    .select({ id: users.id, email: users.email, googleSub: users.googleSub })
    .from(users)
    .where(and(isNull(users.onexaiUserId), isNotNull(users.email)));

  let linked = 0;
  const linkErrors: string[] = [];
  for (const u of unlinked) {
    try {
      const pool = await resolveUser({
        email: u.email!,
        ...(u.googleSub ? { googleSub: u.googleSub } : {}),
      });
      await db
        .update(users)
        .set({ onexaiUserId: pool.id, updatedAt: new Date() })
        .where(eq(users.id, u.id));
      linked += 1;
      console.log(`گره: ${u.email} → pool #${pool.id}${pool.created ? " (تازه)" : ""}`);
    } catch (err) {
      linkErrors.push(`${u.email}: ${err instanceof Error ? err.message : err}`);
    }
  }

  // ۲) مهاجرتِ موجودی‌های مثبتِ محلی به کیف‌پولِ واحد.
  const positive = await db
    .select({
      userId: wallets.userId,
      balanceToman: wallets.balanceToman,
      onexaiUserId: users.onexaiUserId,
    })
    .from(wallets)
    .innerJoin(users, eq(wallets.userId, users.id))
    .where(gt(wallets.balanceToman, 0));

  let migratedCount = 0;
  let migratedToman = 0;
  const moneyErrors: string[] = [];
  for (const w of positive) {
    if (!w.onexaiUserId) {
      moneyErrors.push(`${w.userId}: بدونِ گره — موجودیِ ${w.balanceToman} مهاجرت نکرد`);
      continue;
    }
    try {
      const res = await creditPool({
        onexaiUserId: w.onexaiUserId,
        amountToman: w.balanceToman,
        kind: "adjustment",
        reference: `karjoo:migrate:${w.userId}`,
      });
      // صفرکردنِ محلی فقط پس از واریزِ موفق/از-قبل-انجام‌شده (already=true هم امن است).
      await debit(w.userId, "charge", w.balanceToman, {
        refType: "migration",
        refId: `migrate:${w.userId}`,
        description: "انتقالِ موجودی به کیف‌پولِ واحدِ 1xai",
      });
      migratedCount += 1;
      migratedToman += w.balanceToman;
      console.log(
        `پول: ${w.userId} → ${w.balanceToman} تومان (already=${res.already}) — موجودیِ pool: ${res.balanceToman}`,
      );
    } catch (err) {
      moneyErrors.push(`${w.userId}: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log("──────────");
  console.log(`گره‌ها: ${linked}/${unlinked.length} | مهاجرتِ پول: ${migratedCount} کاربر، ${migratedToman} تومان`);
  if (linkErrors.length) console.log("خطاهای گره:", linkErrors);
  if (moneyErrors.length) console.log("خطاهای پول:", moneyErrors);
  process.exit(linkErrors.length + moneyErrors.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("backfill ناموفق:", err);
  process.exit(1);
});
