import "server-only";

/**
 * GET /api/categories
 *
 * تاکسونومیِ seedشده‌ی دسته‌بندیِ مشاغل (id/slug/برچسبِ فارسی و انگلیسی/والد/ترتیب) را
 * برمی‌گرداند — هم به‌صورتِ فهرستِ تخت (به ترتیبِ نمایش) و هم گروه‌بندی‌شده بر اساسِ
 * والد (آماده برای پیکرِ گروهیِ UI). فقط-خواندنی و عمومی: هیچ داده‌ی کاربری/حساسی نیست،
 * پس نشست لازم نیست (همه‌ی کاربران همان تاکسونومی را می‌بینند).
 *
 * تاکسونومیِ فعلی تک‌سطحی است (همه parentId=null) → هر دسته یک گروهِ مستقل می‌شود؛ ساختار
 * از زیرشاخه پشتیبانی می‌کند و وقتی parentId پر شود خودبه‌خود زیرِ والد جمع می‌شود.
 */
import { json, withErrorHandling } from "@/lib/api/http";
import { getAllCategories, type CategoryRow } from "@/lib/interests/store";

// به DB دست می‌زند → اجرای Node لازم است.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** یک گروه: دسته‌ی والد (یا ریشه‌ی مجازی) + دسته‌های زیرِ آن. */
interface CategoryGroup {
  parent: CategoryRow | null;
  categories: CategoryRow[];
}

/**
 * دسته‌ها را به گروه‌ها تبدیل می‌کند: دسته‌های ریشه (parentId=null) هرکدام یک گروه با
 * `parent=null` می‌شوند؛ دسته‌های دارای والد زیرِ گروهِ والدِ خود جمع می‌شوند. ترتیبِ
 * گروه‌ها و درون‌گروه با sortOrder (که store از پیش اعمال کرده) پایدار می‌ماند.
 */
function groupByParent(rows: CategoryRow[]): CategoryGroup[] {
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

  return roots.map((root) => {
    const children = childrenOf.get(root.id);
    return children && children.length > 0
      ? { parent: root, categories: children }
      : { parent: null, categories: [root] };
  });
}

export async function GET(): Promise<Response> {
  return withErrorHandling(async () => {
    const categories = await getAllCategories();
    return json({
      count: categories.length,
      categories,
      groups: groupByParent(categories),
    });
  });
}
