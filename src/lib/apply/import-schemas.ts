/**
 * اسکیماهای zod برای اندپوینتِ ایمپورتِ پروفایل (`POST /api/profile/import`).
 *
 * این فایل در ناحیه‌ی Track C است (نه `src/lib/api/extension-schemas.ts` که مالکِ
 * دیگری دارد) تا تداخلِ مالکیت پیش نیاید. شاملِ:
 *   • `importBoardSchema` — enumِ کاملِ سایت‌ها هم‌راستا با JobBoardId (شاملِ irantalent
 *     که enumِ extension-schemas آن را ندارد).
 *   • `profileImportBodySchema` — بدنه‌ی { board, payload }. payload فقط *داده* است؛
 *     هر کلیدِ شبیهِ اعتبارنامه (در هر عمقی) → ۴۰۰ (قاعده‌ی §10).
 *
 * چرا هم اینجا و هم `assertNoCredentials` در منطق؟ دفاع در عمق: zod ورودیِ HTTP را
 * زود (پیش از منطق) رد می‌کند؛ `normalizeImportedProfile` هم مستقل دوباره بررسی می‌کند
 * تا حتی اگر مسیری اسکیما را دور بزند، اعتبارنامه نشت نکند.
 */
import { z } from "zod";

import { assertNoCredentials, CredentialLeakError } from "@/lib/apply/import";

/** سایت‌های پشتیبانی‌شده — هم‌راستا با JobBoardId/jobBoardEnum (شاملِ irantalent). */
export const importBoardSchema = z.enum([
  "jobvision",
  "jobinja",
  "e-estekhdam",
  "irantalent",
  "karboom",
  "linkedin",
  "iranestekhdam",
  "divar",
  "quera",
  "remoteok",
  "weworkremotely",
  "ponisha",
  "parscoders",
  "bankestekhdam",
]);

export type ImportBoard = z.infer<typeof importBoardSchema>;

/**
 * payload خام — یک شیءِ JSONِ آزاد (per-board). فقط شیء (نه آرایه/اسکالر) در ریشه
 * پذیرفته می‌شود، و هیچ کلیدِ اعتبارنامه‌مانندی (در هر عمقی) نباید داشته باشد.
 *
 * بررسیِ اعتبارنامه را به همان `assertNoCredentials`ِ منطق (تنها منبعِ حقیقت برای
 * کلیدهای ممنوع) واگذار می‌کنیم تا فهرستِ کلیدها دوتکه/دچارِ drift نشود. آن تابع روی
 * نشت throw می‌کند؛ اینجا آن را به یک issueِ zod (با path) تبدیل می‌کنیم → ۴۰۰ تمیز.
 */
export const importPayloadSchema = z
  .record(z.string(), z.unknown())
  .superRefine((value, ctx) => {
    try {
      assertNoCredentials(value);
    } catch (err) {
      if (err instanceof CredentialLeakError) {
        ctx.addIssue({
          code: "custom",
          message:
            "فیلدِ شبیهِ اعتبارنامه در payload مجاز نیست (کوکی/توکن/رمز — قاعده‌ی §10).",
          path: err.field ? err.field.split(/[.[\]]/).filter(Boolean) : [],
        });
      } else {
        throw err;
      }
    }
  });

/**
 * بدنه‌ی POST /api/profile/import. `.strict()` تا فیلدِ ریشه‌ای ناشناخته رد شود؛
 * payload خودش رکوردِ آزاد است (داده‌ی پروفایل) اما از اعتبارنامه پاک‌سازی شده.
 */
export const profileImportBodySchema = z
  .object({
    /** سایتی که داده از آن ایمپورت می‌شود. */
    board: importBoardSchema,
    /** داده‌ی خامِ پروفایل/رزومه/سابقه که افزونه از صفحه‌ی خودِ کاربر خوانده. */
    payload: importPayloadSchema,
  })
  .strict();

export type ProfileImportBody = z.infer<typeof profileImportBodySchema>;

/** اسکیمای query برای GET /api/profile/imports — سقفِ اختیاریِ تعداد. */
export const profileImportsQuerySchema = z
  .object({
    /** حداکثر تعدادِ رکوردِ تاریخچه‌ی ایمپورت (۱..۱۰۰، پیش‌فرض ۲۰). */
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export type ProfileImportsQuery = z.infer<typeof profileImportsQuerySchema>;
