import "server-only";

/**
 * نمای عمومیِ امنِ یک ردیفِ نودِ ورکر برای بدنه‌ی پاسخِ API (Track A).
 *
 * ردیفِ خامِ worker_nodes شاملِ `credentialHash` و `enrollmentTokenHash` است — این‌ها
 * رازهای داخلی‌اند (هشِ اعتبارنامه/توکن) و هرگز نباید در پاسخِ هیچ مسیری بیرون بروند،
 * حتی به نودِ خودش یا ادمین. این کمک‌کننده آن‌ها را حذف می‌کند و فقط فیلدهای امنِ
 * وضعیت/متادیتا را برمی‌گرداند. هر مسیری که نود را برمی‌گرداند باید از این عبور دهد.
 */
import type { WorkerNode } from "@/db/schema";

/** نودِ ورکر بدونِ هیچ فیلدِ راز (hashها حذف). */
export type PublicWorkerNode = Omit<
  WorkerNode,
  "credentialHash" | "enrollmentTokenHash"
>;

/**
 * یک ردیفِ نود را به نمای عمومیِ امن تبدیل می‌کند: `credentialHash` و
 * `enrollmentTokenHash` را حذف و بقیه‌ی فیلدها را عیناً نگه می‌دارد.
 */
export function publicNode(node: WorkerNode): PublicWorkerNode {
  const { credentialHash: _c, enrollmentTokenHash: _e, ...safe } = node;
  void _c;
  void _e;
  return safe;
}
