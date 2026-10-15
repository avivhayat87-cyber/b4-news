import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Sidebar } from '@/components/sidebar';
import { ArticleImage, Byline, SectionHeader, wrap } from '@/components/ui';
import { getCategoryPage, getMarkets } from '@/lib/api';
import { articleHref, categoryHref } from '@/lib/site';

export const revalidate = 300;

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ cursor?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const data = await getCategoryPage(slug);
  if (!data) return {};
  return { title: data.category.name, alternates: { canonical: categoryHref(slug) } };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const [{ slug }, { cursor }] = await Promise.all([params, searchParams]);
  const [data, markets] = await Promise.all([getCategoryPage(slug, cursor), getMarkets()]);
  if (!data) notFound();

  const [lead, ...rest] = data.page.items;

  return (
    <div className={`${wrap} flex flex-wrap gap-10 pb-8 pt-8`}>
      <div className="min-w-0 flex-[999_1_640px]">
        <SectionHeader as="h1" title={data.category.name} className="mb-6" />
        {!lead ? (
          <p className="py-10 text-lg text-muted">עדיין אין כתבות במדור הזה.</p>
        ) : (
          <>
            <Link href={articleHref(lead)} className="group grid gap-5 border-b border-line pb-7 md:grid-cols-2">
              <ArticleImage article={lead} priority sizes="(min-width: 1280px) 420px, 100vw" iconSize={36} className="rounded-[10px]" />
              <div className="flex flex-col gap-3">
                <h2 className="text-balance text-[26px] font-extrabold leading-tight group-hover:text-brand md:text-[32px]">{lead.title}</h2>
                {lead.excerpt ? <p className="text-base leading-relaxed text-ink-2">{lead.excerpt}</p> : null}
                <Byline article={lead} />
              </div>
            </Link>
            <ul className="flex flex-col">
              {rest.map((a) => (
                <li key={a.id} className="border-b border-line py-5">
                  <Link href={articleHref(a)} className="group flex items-start gap-4">
                    <ArticleImage article={a} sizes="200px" iconSize={22} className="w-32 shrink-0 rounded md:w-48" />
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <h3 className="text-balance text-lg font-extrabold leading-snug group-hover:text-brand md:text-xl">{a.title}</h3>
                      {a.excerpt ? <p className="hidden text-[15px] leading-relaxed text-ink-2 md:block">{a.excerpt}</p> : null}
                      <Byline article={a} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            {data.page.nextCursor ? (
              <div className="mt-8 flex justify-center">
                <Link
                  href={`${categoryHref(slug)}?cursor=${encodeURIComponent(data.page.nextCursor)}`}
                  className="inline-flex h-12 items-center rounded-full border-2 border-ink px-7 font-extrabold hover:bg-ink hover:text-white"
                >
                  כתבות קודמות
                </Link>
              </div>
            ) : null}
          </>
        )}
      </div>
      <Sidebar quotes={markets} />
    </div>
  );
}
