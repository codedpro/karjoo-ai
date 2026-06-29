import type { Metadata } from "next";
import Link from "next/link";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { itmaster } from "@/lib/itmaster";

export const metadata: Metadata = {
  title: "وبلاگ",
  description: "راهنماها و نکات کاریابی و مصاحبه — تولیدشده توسط موتور محتوای IT Master.",
};

export default async function BlogIndex() {
  const posts = await itmaster.listArticles({ limit: 50 });

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-16">
        <header className="mb-10 text-center">
          <h1 className="text-4xl font-extrabold">وبلاگ کارجو</h1>
          <p className="mt-3 text-muted">راهنمای کاریابی، نگارش رزومه و موفقیت در مصاحبه.</p>
        </header>

        {posts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card/50 p-12 text-center text-muted">
            <p className="text-lg font-bold text-foreground">هنوز مقاله‌ای منتشر نشده است</p>
            <p className="mt-2 text-sm">
              به‌محض انتشار محتوا در موتور IT Master، مقاله‌ها همین‌جا نمایش داده می‌شوند.
            </p>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2">
            {posts.map((p) => (
              <Link
                key={p.slug}
                href={`/blog/${p.slug}`}
                className="group flex flex-col rounded-2xl border border-border bg-card p-6 transition-all hover:-translate-y-1 hover:border-brand/40 hover:shadow-lg hover:shadow-brand/5"
              >
                <h2 className="text-lg font-bold leading-7 group-hover:text-brand">{p.title}</h2>
                {(p.description || p.excerpt) && (
                  <p className="mt-2 line-clamp-3 text-sm leading-7 text-muted">
                    {p.description || p.excerpt}
                  </p>
                )}
                {p.reading_time_min ? (
                  <span className="ltr-nums mt-4 text-xs text-muted">
                    {p.reading_time_min} دقیقه مطالعه
                  </span>
                ) : null}
              </Link>
            ))}
          </div>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
