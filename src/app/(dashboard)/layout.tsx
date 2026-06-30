/**
 * چیدمانِ گروهِ مسیرِ (dashboard) — جدا از هدر/فوترِ لندینگ.
 *
 * `<html>`/`<body>`/فونت در RootLayout تنظیم شده؛ این لایه فقط یک wrapper است تا
 * صفحه‌های داشبورد و لاگین، شِلِ بازاریابی را به ارث نبرند. هر صفحه خودش پوسته‌ی
 * مناسبش (DashboardShell یا قابِ لاگین) را رندر می‌کند.
 */
export default function DashboardGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
