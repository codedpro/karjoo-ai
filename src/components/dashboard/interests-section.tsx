import "server-only";

/**
 * بخشِ «زمینه‌های شغلی» — حالا داخلِ صفحه‌ی «اپلای خودکار» زندگی می‌کند.
 *
 * پیش‌تر این یک صفحه‌ی جدا بود و همان مشکلی را می‌ساخت که خودِ صفحه هم اعترافش کرده بود:
 * این انتخاب و ویرایشگرِ فیلترهای «اپلای خودکار» هر دو یک کلیدِ واحد
 * (`candidate_profiles.preferences.categorySlugs`) را می‌نویسند، پس هر کدام آخر ذخیره
 * می‌شد دیگری را پاک می‌کرد — و کاربر در دو صفحه‌ی جدا هیچ‌وقت نمی‌فهمید چرا. کنارِ هم
 * بودنشان در یک صفحه، هم‌پوشانی را دیدنی می‌کند به‌جای اینکه پنهانش کند.
 *
 * کش: تاکسونومیِ دسته‌ها *مستقل از کاربر* است (جدولِ سراسریِ job_categories) → با
 * `unstable_cache` بین درخواست‌ها کش می‌شود. انتخابِ کاربر مقید به userId و کش‌نشده می‌ماند.
 *
 * گروه‌بندی نمایشی این‌جا تعریف شده (نه در DB)؛ slugِ ناشناخته در گروهِ «سایر» می‌افتد،
 * پس افزودنِ دسته‌ی تازه هیچ‌وقت چیزی را ناپدید نمی‌کند.
 */
import { unstable_cache } from "next/cache";

import {
  InterestsPicker,
  type PickerGroup,
} from "@/components/dashboard/interests-picker";
import { IconHeart } from "@/components/dashboard/icons";
import { ButtonLink, EmptyState, Skeleton } from "@/components/dashboard/ui";
import {
  getAllCategories,
  getSelectedSlugs,
  type CategoryRow,
} from "@/lib/interests/store";

const getCachedCategories = unstable_cache(
  async () => getAllCategories(),
  ["interests-taxonomy"],
  { tags: ["interests-taxonomy"], revalidate: 60 * 60 * 24 },
);

/* ───────────────────────── بخشِ async (Suspense) ───────────────────────── */

export async function InterestsPickerSection({ userId }: { userId: string }) {
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
export function InterestsPickerSkeleton() {
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
