import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Comments } from '@/components/comments';
import { PersonIcon } from '@/components/icons';
import { ShareBar } from '@/components/share';
import { AdSlot, ArticleImage, RankBadge, SectionHeader, wrap } from '@/components/ui';
import { getArticle, getHome, getRelated } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { SITE, articleHref, categoryHref } from '@/lib/site';

export const revalidate = 300;

type Props = { params: Promise<{ slug: string }> };

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const article = await getArticle(safeDecode((await params).slug));
  if (!article) return {};
  const description = article.subtitle || article.excerpt || SITE.description;
  return {
    title: article.title,
    description,
    alternates: { canonical: articleHref(article) },
    openGraph: {
      type: 'article',
      title: article.title,
      description,
      url: articleHref(article),
      publishedTime: article.publishedAt,
      modifiedTime: article.updatedAt,
      section: article.category.name,
      tags: article.tags.map((t) => t.name),
      images: article.image ? [{ url: article.image.url, width: article.image.width, height: article.image.height, alt: article.image.alt }] : undefined,
    },
    twitter: { card: 'summary_large_image' },
  };
}

export default async function ArticlePage({ params }: Props) {
  const article = await getArticle(safeDecode((await params).slug));
  if (!article) notFound();

  const [related, home] = await Promise.all([getRelated(article), getHome()]);
  const url = new URL(articleHref(article), SITE.url).toString();

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: article.title,
    description: article.subtitle || article.excerpt || undefined,
    datePublished: article.publishedAt,
    dateModified: article.updatedAt,
    articleSection: article.category.name,
    inLanguage: 'he-IL',
    mainEntityOfPage: url,
    image: article.image ? [article.image.url] : undefined,
    author: article.author ? [{ '@type': 'Person', name: article.author.name }] : undefined,
    publisher: {
      '@type': 'Organization',
      name: SITE.name,
      logo: { '@type': 'ImageObject', url: new URL('/brand/b4-logo.svg', SITE.url).toString() },
    },
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />

      <div className={`${wrap} flex flex-wrap gap-12 pb-6 pt-8`}>
        <article className="min-w-0 flex-[999_1_640px]">
          <nav aria-label="פירורי לחם" className="mb-4 text-sm text-muted">
            <Link href="/" className="hover:text-brand">ראשי</Link>
            <span aria-hidden="true" className="mx-2">›</span>
            <Link href={categoryHref(article.category.slug)} className="font-bold text-brand hover:text-brand-deep">
              {article.category.name}
            </Link>
          </nav>

          <h1 className="text-balance text-[32px] font-extrabold leading-[1.12] tracking-[-0.01em] md:text-[46px]">{article.title}</h1>
          {article.subtitle ? <p className="mt-4 max-w-[60ch] text-xl leading-relaxed text-ink-2 md:text-[22px]">{article.subtitle}</p> : null}

          <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-y border-line py-4">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-stone text-[#8C8A86]">
                <PersonIcon size={22} />
              </span>
              <div className="flex flex-col text-sm leading-snug">
                <span>
                  <strong className="font-extrabold">{article.author?.name ?? 'מערכת B4'}</strong>
                  {article.editor ? <span className="text-muted"> · עריכה: {article.editor.name}</span> : null}
                </span>
                <span className="text-muted">
                  <time dateTime={article.publishedAt} className="font-mono">{formatDateTime(article.publishedAt)}</time>
                  {' · '}
                  {article.readingMinutes} דק׳ קריאה
                </span>
              </div>
            </div>
            <ShareBar url={url} title={article.title} />
          </div>

          <figure className="mt-6">
            <ArticleImage
              article={article}
              priority
              sizes="(min-width: 1280px) 860px, 100vw"
              iconSize={48}
              className="rounded-[10px]"
            />
            {article.image?.credit ? (
              <figcaption className="mt-2 text-[13px] text-muted">{article.image.credit}</figcaption>
            ) : null}
          </figure>

          <div className="article-body mx-auto mt-8 max-w-[68ch]" dangerouslySetInnerHTML={{ __html: article.bodyHtml }} />

          <footer className="mx-auto mt-10 flex max-w-[68ch] flex-col gap-5">
            {article.tags.length > 0 ? (
              <ul className="flex flex-wrap gap-2" aria-label="תגיות">
                {article.tags.map((tag) => (
                  <li key={tag.slug}>
                    <Link href={`/search?q=${encodeURIComponent(tag.name)}`} className="inline-flex h-9 items-center rounded-full bg-stone px-4 text-sm font-bold hover:bg-brand hover:text-white">
                      {tag.name}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
            {article.source ? (
              <p className="text-sm text-muted">
                על בסיס דיווח ב-
                <a href={article.source.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-brand">
                  {article.source.name}
                </a>
              </p>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
              <span className="text-sm font-bold">אהבתם? שתפו:</span>
              <ShareBar url={url} title={article.title} />
            </div>
          </footer>

          <Comments articleId={article.id} enabled={article.commentsEnabled} initialCount={article.commentCount ?? 0} />
        </article>

        <aside className="flex min-w-0 flex-[1_1_300px] flex-col gap-7 lg:sticky lg:top-6 lg:self-start">
          <section aria-labelledby="side-trending">
            <SectionHeader id="side-trending" title="חדשות חמות" size="sm" rule={false} className="mb-2" />
            <ol className="flex flex-col">
              {home.trending.slice(0, 5).map((a, i) => (
                <li key={a.id} className="border-t border-line py-3">
                  <Link href={articleHref(a)} className="group flex items-start gap-3">
                    <RankBadge n={i + 1} size="sm" />
                    <span className="text-[15px] font-bold leading-snug group-hover:text-brand">{a.title}</span>
                  </Link>
                </li>
              ))}
            </ol>
          </section>
          <AdSlot />
        </aside>
      </div>

      {related.length > 0 ? (
        <section aria-labelledby="related-title" className="mt-4 bg-stone">
          <div className={`${wrap} py-10`}>
            <SectionHeader id="related-title" title="עוד בנושא" href={categoryHref(article.category.slug)} className="mb-5" />
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(240px,100%),1fr))] gap-6">
              {related.slice(0, 6).map((a) => (
                <Link key={a.id} href={articleHref(a)} className="group flex min-w-0 flex-col gap-2">
                  <ArticleImage article={a} sizes="(min-width: 1280px) 300px, 50vw" className="rounded-[10px]" />
                  <span className="text-[13px] font-extrabold text-brand">{a.category.name}</span>
                  <h3 className="text-balance text-[17px] font-bold leading-snug group-hover:text-brand">{a.title}</h3>
                </Link>
              ))}
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}
