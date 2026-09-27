import { createWebhookRoute } from "@itmaster/sdk/next";
import { revalidatePath } from "next/cache";

/**
 * وب‌هوک انتشار/برداشتن مقاله از موتور IT Master → بازاعتبارسنجی کش.
 * برای فعال‌شدن، PUBLISH_PUSH_SECRET را در .env و در تنظیمات سایت در موتور ست کنید.
 */
export const POST = createWebhookRoute({
  secret: process.env.PUBLISH_PUSH_SECRET ?? "",
  revalidate: (a) => {
    revalidatePath(`/blog/${a.slug}`);
    revalidatePath("/blog");
    // Engine-fed metadata routes (hourly ISR otherwise): a publish shows up at once,
    // and deploy/lightsail/refresh-content.mjs can refresh a new slot through here.
    revalidatePath("/sitemap.xml");
    revalidatePath("/robots.txt");
    revalidatePath("/llms.txt");
  },
});
