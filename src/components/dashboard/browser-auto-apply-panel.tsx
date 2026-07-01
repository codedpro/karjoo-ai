/**
 * پنلِ ارائه‌ایِ «اپلای خودکار در مرورگر (افزونه)» (server-safe، بدونِ state/I/O).
 *
 * سطحِ *مرورگر* در خودِ افزونه روشن/خاموش می‌شود (تبِ «اپلای خودکار در مرورگر») و در
 * مرورگرِ خودِ کاربر با نشستِ خودش اجرا می‌شود — نه از این صفحه. این کارت فقط توضیح می‌دهد
 * که این سطح در افزونه کنترل می‌شود و به صفحه‌ی افزونه لینک می‌دهد. برای *همه‌ی* پلن‌ها در
 * دسترس است (برخلافِ سطحِ سرور که ویژه‌ی Max/Max+ است).
 *
 * فقط استایل/چیدمان؛ روی پرایمیتیوهای مشترک (Card/Badge/ButtonLink) و آیکن‌های SVG سوار است.
 */
import { Badge, ButtonLink, Card } from "./ui";
import { IconPuzzle, IconArrowEnd, IconCheck } from "./icons";

export function BrowserAutoApplyPanel() {
  return (
    <Card padded>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent"
            aria-hidden
          >
            <IconPuzzle className="h-5 w-5" />
          </span>
          <h3 className="text-balance text-base font-bold leading-tight">
            اپلای خودکار در مرورگر (افزونه)
          </h3>
        </div>
        <div className="shrink-0">
          <Badge tone="muted">همه‌ی پلن‌ها</Badge>
        </div>
      </div>

      <p className="mt-3 text-pretty text-sm leading-7 text-muted">
        این حالت در{" "}
        <strong className="font-semibold text-foreground">افزونه‌ی کارجو</strong> روشن
        می‌شود و در{" "}
        <strong className="font-semibold text-foreground">مرورگرِ خودِ شما</strong> با نشستِ
        خودتان اجرا می‌شود — تا وقتی مرورگر باز باشد. برای فعال‌سازی، افزونه را نصب و متصل
        کنید، سپس در تبِ «اپلای خودکار در مرورگر»‌ی افزونه آن را روشن کنید.
      </p>

      <ul className="mt-4 space-y-2">
        {[
          "برای همه‌ی پلن‌ها (بدونِ نیاز به Max)",
          "اجرا در مرورگرِ خودتان، با نشستِ خودتان",
          "کنترلِ روشن/خاموش و آستانه، داخلِ خودِ افزونه",
        ].map((line) => (
          <li key={line} className="flex items-start gap-2.5 text-sm leading-6">
            <span
              className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md bg-emerald-500/12 text-emerald-600 dark:text-emerald-400"
              aria-hidden
            >
              <IconCheck className="h-3.5 w-3.5" />
            </span>
            <span className="text-pretty text-muted">{line}</span>
          </li>
        ))}
      </ul>

      <ButtonLink
        href="/dashboard/extension"
        variant="secondary"
        size="sm"
        className="mt-5"
      >
        دریافت و مدیریتِ افزونه
        <IconArrowEnd className="h-4 w-4" />
      </ButtonLink>
    </Card>
  );
}
