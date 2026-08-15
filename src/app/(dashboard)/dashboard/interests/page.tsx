/**
 * صفحه‌ی «زمینه‌های شغلی» (Server component) — دنبالِ چه نوع کاری هستی؟
 *
 * الگوی Next 16 (پوسته‌ی فوری): پوسته/هدر در `dashboard/layout.tsx` استاتیک است؛ این صفحه فقط
 * محتوا می‌دهد و هدرِ خودش را با `PageHeader` بی‌درنگ می‌آورد. بخشِ وابسته به DB داخلِ
 * `<Suspense>` با اسکلتِ هم‌شکلِ چیپ‌ها استریم می‌شود.
 *
 * کش: تاکسونومیِ دسته‌ها *مستقل از کاربر* است (جدولِ سراسریِ job_categories) → با `unstable_cache`
 * بین درخواست‌ها کش می‌شود (تگِ `interests-taxonomy`، بازاعتبارِ روزانه). چون پرچمِ سراسریِ
 * `cacheComponents` عمداً خاموش است (تصمیمِ Foundation)، `use cache` در دسترس نیست و این مسیرِ
 * مستندِ «کش بدونِ cacheComponents» است. انتخابِ کاربر مقید به userId و کش‌نشده می‌ماند.
 *
 * ── صداقت درباره‌ی آنچه این صفحه واقعاً می‌کند ──────────────────────────────────
 * ردیابیِ مسیرِ داده (تأییدشده در کد، نه حدس): `replaceInterests` علاوه بر جدولِ
 * `user_interests`، کلیدِ `categorySlugs` را در `candidate_profiles.preferences` می‌نویسد
 * (`lib/interests/to-preferences.ts`). همان کلید را `parseApplyFilters` می‌خواند
 * (`lib/apply/filters.ts`) و `buildSearchUrl` به `filters[job_categories][]`ِ جابینجا تبدیل
 * می‌کند. پس این صفحه واقعاً کشف/امتیازدهی/صفِ اپلای را هدایت می‌کند — *ولی* دقیقاً همان
 * کلید را ویرایشگرِ فیلترهای «اپلای خودکار» هم می‌نویسد. یعنی هر کدام که آخر ذخیره شود،
 * انتخابِ دیگری را جایگزین می‌کند.
 *
 * تا وقتی آن هم‌پوشانی در لایه‌ی داده حل نشده، UI حق ندارد وانمود کند دو چیزِ مستقل‌اند:
 * صفحه صریحاً می‌گوید چه چیزی را می‌نویسد، چه چیزی *این‌جا* نیست (شهر/حقوق/نوعِ همکاری)، و
 * به صفحه‌ی اپلای خودکار لینک می‌دهد.
 *
 * گروه‌بندی: تاکسونومی تک‌سطحی است (همه parentId=null)، پس دیوارِ ۲۶ چیپیِ بی‌ساختار
 * می‌ساخت. گروه‌بندیِ نمایشی این‌جا (نه در DB) تعریف شده تا بدونِ مهاجرت، فهرست خوانا شود؛
 * slugِ ناشناخته در گروهِ «سایر» می‌افتد، پس افزودنِ دسته‌ی تازه هیچ‌وقت چیزی را ناپدید نمی‌کند.
 */
import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import {
  InterestsPicker,
  type PickerGroup,
} from "@/components/dashboard/interests-picker";
import { getDashboardUser } from "@/components/dashboard/session";
import { IconHeart, IconWarn } from "@/components/dashboard/icons";
import {
  ButtonLink,
  Callout,
  EmptyState,
  PageHeader,
  Skeleton,
} from "@/components/dashboard/ui";
import {
  getAllCategories,
  getSelectedSlugs,
  type CategoryRow,
} from "@/lib/interests/store";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "زمینه‌های شغلی",
  robots: { index: false, follow: false },
};

/**
 * تاکسونومیِ دسته‌ها مستقل از کاربر است (بدونِ کوکی/userId) → کشِ بین‌درخواستی امن است.
 * تگ‌گذاری تا با تغییرِ تاکسونومی قابلِ بازاعتبار باشد؛ بازاعتبارِ زمانیِ روزانه به‌عنوانِ سقف.
 */
const getCachedCategories = unstable_cache(
  async () => getAllCategories(),
  ["interests-taxonomy"],
  { tags: ["interests-taxonomy"], revalidate: 60 * 60 * 24 },
);

export default async function InterestsPage() {
  const user = await getDashboardUser();
  if (!user) redirect("/login");

  return (
    <div className="space-y-8">
      <PageHeader
        title="زمینه‌های شغلی"
        subtitle="دنبالِ چه نوع کاری هستی؟ هر زمینه‌ای را که انتخاب کنی، کارجو آگهی‌های همان زمینه را در جابینجا پیدا و امتیازدهی می‌کند."
      />

      <Callout
        tone="warn"
        icon={<IconWarn />}
        title="این انتخاب با «اپلای خودکار» مشترک است"
        action={
          <ButtonLink href="/dashboard/auto-apply" variant="secondary" size="sm">
            رفتن به فیلترها
          </ButtonLink>
        }
      >
        ذخیره‌ی این صفحه، دسته‌های انتخابیِ صفحه‌ی «اپلای خودکار» را جایگزین می‌کند؛ شهر،
        حقوق، نوعِ همکاری و دورکاری فقط آن‌جا تنظیم می‌شوند.
      </Callout>

      <Suspense fallback={<PickerSkeleton />}>
        <PickerSection userId={user.userId} />
      </Suspense>
    </div>
  );
}

/* ───────────────────────── بخشِ async (Suspense) ───────────────────────── */

async function PickerSection({ userId }: { userId: string }) {
  // تاکسونومیِ کش‌شده (مستقل از کاربر) + انتخابِ کش‌نشده‌ی همین کاربر را موازی بخوان.
  // اگر خواندن شکست خورد، صفحه نباید ۵۰۰ بدهد: کاربر باید بفهمد «فهرست نیامد»، نه اینکه
  // با صفحه‌ی خطای سراسری روبه‌رو شود.
  let categories: CategoryRow[];
  let selected: string[];
  try {
    [categories, selected] = await Promise.all([
      getCachedCategories(),
      getSelectedSlugs(userId),
    ]);
  } catch {
    return <TaxonomyUnavailable />;
  }

  if (categories.length === 0) return <TaxonomyUnavailable />;

  return (
    <InterestsPicker groups={toPickerGroups(categories)} initialSelected={selected} />
  );
}

/** فهرستِ زمینه‌ها نیامد (خطای DB یا تاکسونومیِ seed‌نشده) — حالتِ خالیِ صادق. */
function TaxonomyUnavailable() {
  return (
    <EmptyState
      icon={<IconHeart />}
      title="فهرستِ زمینه‌های شغلی در دسترس نیست"
      body="فعلاً نمی‌توانیم زمینه‌ها را بارگذاری کنیم. انتخابِ قبلیِ شما دست‌نخورده است؛ کمی بعد دوباره تلاش کنید."
      action={
        <ButtonLink href="/dashboard/auto-apply" variant="secondary">
          تنظیمِ فیلترها از صفحه‌ی اپلای خودکار
        </ButtonLink>
      }
    />
  );
}

/* ───────────────────────── گروه‌بندیِ نمایشیِ تاکسونومی ───────────────────────── */

/**
 * گروه‌های نمایشی. تاکسونومیِ DB تک‌سطحی است، پس گروه‌بندی *این‌جا* (لایه‌ی نمایش) انجام
 * می‌شود نه با مهاجرتِ DB. slugها منبعِ حقیقت‌اند و هرگز تغییر نمی‌کنند؛ پس این نگاشت پایدار
 * است. هر slugی که این‌جا نباشد خودکار در «سایر» می‌نشیند (هیچ دسته‌ای گم نمی‌شود).
 */
const DISPLAY_GROUPS: Array<{ label: string; slugs: string[] }> = [
  {
    label: "نرم‌افزار، داده و فناوری",
    slugs: [
      "software-development",
      "it-network",
      "data-ai",
      "devops-cloud",
      "cybersecurity",
      "product-management",
    ],
  },
  {
    label: "طراحی و محتوا",
    slugs: ["graphic-ui-design", "content-translation"],
  },
  {
    label: "بازاریابی، فروش و مشتریان",
    slugs: ["marketing-sales", "digital-marketing", "customer-support"],
  },
  {
    label: "مالی، اداری و مدیریت",
    slugs: [
      "finance-accounting",
      "banking-insurance",
      "management-business",
      "human-resources",
      "legal",
    ],
  },
  {
    label: "مهندسی، تولید و لجستیک",
    slugs: [
      "civil-engineering",
      "mechanical-engineering",
      "electrical-engineering",
      "industrial-engineering",
      "architecture",
      "manufacturing-production",
      "logistics-supply-chain",
    ],
  },
  {
    label: "سلامت، آموزش و خدمات",
    slugs: ["healthcare-medical", "education-teaching", "hospitality-tourism"],
  },
];

/**
 * ردیف‌های تاکسونومی → گروه‌های پیکر.
 *
 * اگر روزی `parentId` پر شود (تاکسونومیِ دوسطحی)، همان سلسله‌مراتبِ واقعی برنده است و
 * نگاشتِ نمایشیِ بالا کنار می‌رود — پس این تابع هر دو حالت را می‌فهمد.
 */
function toPickerGroups(rows: CategoryRow[]): PickerGroup[] {
  const byId = new Map(rows.map((r) => [r.id, r] as const));
  const childrenOf = new Map<string, CategoryRow[]>();
  const roots: CategoryRow[] = [];

  for (const row of rows) {
    if (row.parentId && byId.has(row.parentId)) {
      const list = childrenOf.get(row.parentId) ?? [];
      list.push(row);
      childrenOf.set(row.parentId, list);
    } else {
      roots.push(row);
    }
  }

  // حالتِ ۱ — تاکسونومی واقعاً سلسله‌مراتبی است: هر والد یک گروه.
  const hasHierarchy = roots.some((r) => childrenOf.has(r.id));
  if (hasHierarchy) {
    return roots.map((root) => {
      const children = childrenOf.get(root.id) ?? [];
      return {
        label: root.labelFa,
        categories: (children.length > 0 ? children : [root]).map(toPickerCategory),
      };
    });
  }

  // حالتِ ۲ — تک‌سطحی: با نگاشتِ نمایشی گروه‌بندی کن.
  const bySlug = new Map(roots.map((r) => [r.slug, r] as const));
  const used = new Set<string>();
  const groups: PickerGroup[] = [];

  for (const group of DISPLAY_GROUPS) {
    const categories = group.slugs
      .map((slug) => bySlug.get(slug))
      .filter((r): r is CategoryRow => r !== undefined)
      .map((r) => {
        used.add(r.slug);
        return toPickerCategory(r);
      });
    if (categories.length > 0) groups.push({ label: group.label, categories });
  }

  // هر دسته‌ای که در نگاشت نبود (تاکسونومیِ تازه‌تر از این فایل) — به ترتیبِ خودِ DB.
  const leftovers = roots.filter((r) => !used.has(r.slug));
  if (leftovers.length > 0) {
    groups.push({ label: "سایر", categories: leftovers.map(toPickerCategory) });
  }

  return groups;
}

function toPickerCategory(r: CategoryRow) {
  return { slug: r.slug, labelFa: r.labelFa, labelEn: r.labelEn };
}

/* ───────────────────────── اسکلتِ هم‌شکلِ پیکر ───────────────────────── */

/** نوارِ چسبانِ ذخیره + جست‌وجو + گروه‌های عنوان‌دارِ چیپ (هم‌شکلِ InterestsPicker). */
function PickerSkeleton() {
  // عرض‌های متنوع تا اسکلت طبیعی‌تر از یک شبکه‌ی یک‌دست به‌نظر برسد.
  const groups = [
    ["w-32", "w-24", "w-28", "w-36", "w-20", "w-28"],
    ["w-28", "w-32"],
    ["w-24", "w-36", "w-28"],
    ["w-32", "w-24", "w-28", "w-20", "w-32"],
  ];
  return (
    <div aria-hidden>
      {/* نوارِ وضعیت/ذخیره */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-xs">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-9 w-36 rounded-full" />
      </div>
      {/* جست‌وجو */}
      <Skeleton className="mb-6 h-11 w-full rounded-xl" />
      {/* گروه‌های چیپ */}
      <div className="space-y-8">
        {groups.map((widths, gi) => (
          <div key={gi}>
            <Skeleton className="mb-3 h-3.5 w-40" />
            <div className="flex flex-wrap gap-2.5">
              {widths.map((w, i) => (
                <Skeleton key={i} className={`h-9 rounded-full ${w}`} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
