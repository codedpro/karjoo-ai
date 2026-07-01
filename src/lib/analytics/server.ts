import "server-only";

/**
 * آنالیتیکسِ سمتِ سرور — SDK نودِ PostHog (posthog-node).
 *
 * envها (همه اختیاری — در نبودشان توابع no-op می‌شوند):
 *   POSTHOG_KEY   — کلیدِ پروژه (phc_…)      (fallback: NEXT_PUBLIC_POSTHOG_KEY)
 *   POSTHOG_HOST  — مثلاً https://ph.io9.uk  (fallback: NEXT_PUBLIC_POSTHOG_HOST)
 *
 * تک‌مستأجر: هر رویداد به‌صورتِ خودکار روی groupِ ثابتِ `tenant: 'karjoo'` می‌نشیند
 * (هم‌راستا با تگِ Sentry و super-propertyِ کلاینت). هیچ منطقِ چندبرندی نداریم.
 *
 * مقاومت: هیچ تابعی هرگز throw نمی‌کند؛ خطاها بلعیده می‌شوند تا آنالیتیکس هرگز
 * مسیرِ اصلیِ درخواست (auth/آپلود/parse) را نشکند.
 */
import { PostHog } from "posthog-node";
import { TENANT, type EventName, type EventProps, type IdentifyProps } from "./types";

const POSTHOG_KEY = process.env.POSTHOG_KEY || process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST =
  process.env.POSTHOG_HOST || process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://ph.io9.uk";

let client: PostHog | null = null;
function getClient(): PostHog | null {
  if (!POSTHOG_KEY) return null;
  if (!client) {
    client = new PostHog(POSTHOG_KEY, {
      host: POSTHOG_HOST,
      // هر رویداد بلافاصله ارسال شود. پیش‌فرضِ `flushAt: 20` رویدادها را تا رسیدنِ ۲۰تا
      // بافر می‌کند؛ در route handlerهای request-scoped که یک رویداد می‌زنند و برمی‌گردند،
      // این عملاً همه‌ی رویدادهای سرور را دور می‌ریزد. کارجو کانتینرِ بلندعمر است (نه
      // serverless)، پس ارسالِ فوریِ per-event مطمئن است. flushInterval پشتیبانِ straggler.
      flushAt: 1,
      flushInterval: 10_000,
    });
  }
  return client;
}

export function track(distinctId: string, event: EventName, props: EventProps = {}): void {
  const ph = getClient();
  if (!ph) return;
  try {
    ph.capture({
      distinctId,
      event,
      properties: {
        ...props,
        $set: { tenant: TENANT },
      },
      groups: { tenant: TENANT },
    });
  } catch (err) {
    console.warn("[analytics] track failed:", err);
  }
}

export function identify(distinctId: string, props: IdentifyProps = {}): void {
  const ph = getClient();
  if (!ph) return;
  try {
    ph.identify({
      distinctId,
      properties: {
        email: props.email,
        name: props.name,
      },
    });
    ph.groupIdentify({
      groupType: "tenant",
      groupKey: TENANT,
      properties: { name: TENANT },
    });
  } catch (err) {
    console.warn("[analytics] identify failed:", err);
  }
}

/** رویدادهای صف‌شده‌ی PostHog را flush می‌کند — پیش از خروجِ تابع/پاسخ. هرگز throw نمی‌کند. */
export async function flush(): Promise<void> {
  if (!client) return;
  try {
    await client.flush();
  } catch {
    /* no-op */
  }
}
