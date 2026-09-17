/**
 * صفحه‌ی «افزونه‌ی مرورگر» (Server component) — دانلود، نصب و اتصالِ افزونه‌ی کارجو.
 *
 * الگوی Next 16 (پوسته‌ی فوری): پوسته/هدر در `dashboard/layout.tsx` استاتیک است؛ این صفحه
 * فقط محتوا می‌دهد و هدرِ خودش را با `PageHeader` بی‌درنگ می‌آورد. محتوا تماماً استاتیک است
 * (راهنما + دکمه‌ی دانلود)، پس Suspense لازم نیست؛ تنها پنلِ اتصال و فهرستِ دستگاه‌ها client‌اند.
 *
 * تصمیم‌های محتوایی (بازنویسیِ ضدِ دیوارِ متن):
 *   • **یک** دکمه‌ی دانلودِ آشکار (در هدر). پیش‌تر دو دکمه‌ی یکسان بود و کاربر را مردد می‌کرد.
 *   • مراحلِ کروم و اِج تقریباً یکسان‌اند؛ نمایشِ هم‌زمانِ هر دو یعنی ۱۲ گام برای کاری که ۶ گام
 *     است. حالا هر مرورگر یک `<details>` است و با `name` مشترک، آکاردئونِ *انحصاری* می‌سازند
 *     (باز شدنِ یکی دیگری را می‌بندد) — بدونِ ذره‌ای JS و بدونِ client component. کروم پیش‌فرض
 *     باز است چون سهمِ غالبِ کاربران است.
 *   • روشِ توزیع «بارگذاریِ باز» است (تصمیمِ بیرونی، اینجا قابلِ تغییر نیست)؛ پس تنها کارِ ما
 *     زنده‌نگه‌داشتنِ کاربرِ غیرِفنی است: هر گام یک جمله‌ی امری، و هشدارِ حیاتیِ «پوشه را پاک
 *     نکنید» به‌جای پاراگرافِ دفن‌شده، یک `Callout` در بالای راهنما.
 *   • هر جمله‌ای که «دستور» نبود حذف شد؛ توضیحِ ارزشِ افزونه در زیرعنوانِ صفحه خلاصه است.
 *
 * `PairExtensionPanel` عمداً هم اینجا و هم در خانه‌ی داشبورد (آنبوردینگ) رندر می‌شود؛ در این
 * صفحه فقط *یک‌بار* می‌آید.
 *
 * حضورِ نشست پیش‌تر در `proxy.ts` (لبه، بدونِ DB) چک شده؛ اینجا فقط برای اطمینان دوباره
 * راستی‌آزمایی می‌کنیم و در نبودِ نشست به /login می‌رویم. فارسی/RTL؛ آیکن‌های lucide.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getDashboardUser } from "@/components/dashboard/session";
import {
  ConnectedDevicesPanel,
  PairExtensionPanel,
} from "@/components/dashboard/pair-extension-panel";
import { BoardCredentialsPanel } from "@/components/dashboard/board-credentials-panel";
import { readCredentialPanelData } from "@/components/dashboard/board-credentials-data";
import {
  DownloadButton,
  InstallGuide,
} from "@/components/dashboard/extension-install-guide";
import { IconShield, IconWarn } from "@/components/dashboard/icons";
import { Callout, PageHeader } from "@/components/dashboard/ui";

// راستی‌آزماییِ نشست → اجرای Node.
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "افزونه‌ی مرورگر",
  robots: { index: false, follow: false },
};

export default async function ExtensionPage() {
  const user = await getDashboardUser();
  if (!user) redirect("/login");
  const credentialData = await readCredentialPanelData(user.userId);

  return (
    <div className="space-y-8">
      <PageHeader
        title="افزونه‌ی مرورگر"
        subtitle="افزونه در مرورگرِ خودتان نصب می‌شود و اپلای در سایت‌های کاریابی را برایتان انجام می‌دهد. سه کار: دانلود، نصب، اتصال."
        actions={<DownloadButton />}
      />

      <Callout
        tone="warn"
        icon={<IconWarn />}
        title="پوشه‌ی افزونه را پاک یا جابه‌جا نکنید"
      >
        مرورگر افزونه را هر بار از همان پوشه می‌خواند؛ با حذف یا جابه‌جاییِ پوشه، افزونه از
        کار می‌افتد.
      </Callout>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <InstallGuide />
        </div>
        <div className="space-y-6">
          <PairExtensionPanel />
          <ConnectedDevicesPanel />
          <BoardCredentialsPanel {...credentialData} />
          <Callout tone="success" icon={<IconShield />} title="کنترل با شماست">
            افزونه فقط در مرورگرِ خودتان کار می‌کند و تاگلِ «اپلای خودکار» داخلِ خودش هر
            لحظه خاموش‌شدنی است.
          </Callout>
        </div>
      </div>
    </div>
  );
}
