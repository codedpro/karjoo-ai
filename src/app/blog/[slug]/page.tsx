import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { articleJsonLd, articleMetadata, applyMeta } from "@itmaster/sdk/next";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { itmaster } from "@/lib/itmaster";
import { site } from "@/lib/site";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const article = await itmaster.getArticle(slug);
  if (!article) return { title: "مقاله یافت نشد" };

  let meta = articleMetadata(article, { siteUrl: site.url });
  const config = await itmaster.config();
  if (config) meta = applyMeta(meta, config);
  return meta as Metadata;
}

export default async function ArticlePage({ params }: Params) {
  const { slug } = await params;
  const article = await itmaster.getArticle(slug);
  if (!article) notFound();

  const jsonLd = articleJsonLd(article, { siteUrl: site.url });

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-16">
        <article>
          <h1 className="text-3xl font-extrabold leading-[1.4] sm:text-4xl">{article.title}</h1>
          {(article.description || article.excerpt) && (
            <p className="mt-4 text-lg leading-9 text-muted">
              {article.description || article.excerpt}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted">
            {article.author?.name && <span>نویسنده: {article.author.name}</span>}
            {article.reading_time_min ? (
              <span className="ltr-nums">{article.reading_time_min} دقیقه مطالعه</span>
            ) : null}
          </div>

          <hr className="my-8 border-border" />

          <div
            className="prose-fa max-w-none"
            dangerouslySetInnerHTML={{ __html: article.body_html }}
          />
        </article>
      </main>
      <SiteFooter />

      {/* داده‌ی ساختاریافته (JSON-LD) برای سئو و موتورهای هوش مصنوعی */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </>
  );
}
