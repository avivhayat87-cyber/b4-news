import type { Metadata } from 'next';
import Link from 'next/link';
import { ArticleImage, Byline, SectionHeader } from '@/components/ui';
import { searchArticles } from '@/lib/api';
import { articleHref } from '@/lib/site';

export const metadata: Metadata = { title: 'חיפוש', robots: { index: false } };

type Props = { searchParams: Promise<{ q?: string }> };

export default async function SearchPage({ searchParams }: Props) {
  const q = ((await searchParams).q ?? '').trim().slice(0, 120);
  const results = q ? await searchArticles(q) : { items: [], nextCursor: null };

  return (
    <div className="mx-auto w-full max-w-[960px] px-4 pb-10 pt-8 md:px-6">
      <SectionHeader title="חיפוש" className="mb-6" />
      <form action="/search" role="search" className="mb-8 flex gap-2">
        <label htmlFor="search-page-q" className="sr-only">
          מה לחפש
        </label>
        <input
          id="search-page-q"
          name="q"
          type="search"
          defaultValue={q}
          placeholder="חיפוש כתבות, נושאים ואנשים"
          className="h-12 min-w-0 flex-1 rounded-md border-[1.5px] border-ink px-4 text-base"
        />
        <button type="submit" className="h-12 shrink-0 rounded-md bg-ink px-6 font-extrabold text-white hover:bg-black">
          חיפוש
        </button>
      </form>

      {q ? (
        <p className="mb-4 text-sm text-muted" role="status">
          {results.items.length === 0 ? `לא נמצאו כתבות עבור ״${q}״. נסו מילה אחרת או קצרה יותר.` : `${results.items.length} תוצאות עבור ״${q}״`}
        </p>
      ) : null}

      <ul className="flex flex-col">
        {results.items.map((a) => (
          <li key={a.id} className="border-b border-line py-5">
            <Link href={articleHref(a)} className="group flex items-start gap-4">
              <ArticleImage article={a} sizes="200px" iconSize={22} className="w-32 shrink-0 rounded md:w-44" />
              <div className="flex min-w-0 flex-col gap-1.5">
                <span className="text-[13px] font-extrabold text-brand">{a.category.name}</span>
                <h2 className="text-balance text-lg font-extrabold leading-snug group-hover:text-brand">{a.title}</h2>
                <Byline article={a} />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
