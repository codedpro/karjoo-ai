"use client";

/**
 * دکمه‌ی ارسالِ فرم با تأییدِ صریح (client) — نازک‌ترین لایه‌ی ممکن.
 *
 * چرا وجود دارد؟ چند اکشنِ ادمین برگشت‌ناپذیرند (واریزِ پول، ردِ درخواست). صفحه‌ی
 * میزبان می‌تواند Server component بماند و فقط همین دکمه کلاینت باشد؛ پس هزینه‌ی JS
 * به یک دکمه محدود می‌شود، نه کلِ صفحه.
 *
 * مرزِ امنیت: این فقط محافظِ *خطای انسانی* است، نه کنترلِ دسترسی. اگر JS خاموش باشد
 * فرم مثلِ قبل ارسال می‌شود — و همان‌جا server action دوباره ادمین‌بودن را چک می‌کند.
 */
import { useFormStatus } from "react-dom";

export function ConfirmSubmit({
  confirmText,
  className,
  children,
}: {
  /** متنِ پرسشِ تأیید — باید *پیامدِ واقعی* را بگوید، نه «مطمئنی؟». */
  confirmText: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={className}
      onClick={(event) => {
        if (!confirm(confirmText)) event.preventDefault();
      }}
    >
      {pending ? "در حالِ ثبت…" : children}
    </button>
  );
}
