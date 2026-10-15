import Image from 'next/image';
import Link from 'next/link';
import type { ArticleCard } from '@/lib/types';
import { articleHref, toneBackground } from '@/lib/site';
import { HeroCarousel } from './hero-carousel';
import { TickerMotion } from './ticker-motion';
import { CategoryTag, PublishedTime, wrap } from './ui';

/**
 * The 7 main articles, opened by the breaking-news ticker: one big image that
 * rotates through the lead story and stories 4-7, and stories 2-3 fixed beside it.
 */
export function Hero({ articles, latest }: { articles: ArticleCard[]; latest: ArticleCard[] }) {
  const [lead, ...rest] = articles;
  if (!lead) return null;
  const fixed = rest.slice(0, 2);
  const rotating = [lead, ...rest.slice(2, 6)];

  return (
    <section aria-label="כתבות ראשיות" className={`${wrap} pb-2 pt-5`}>
      <BreakingTicker items={latest} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:gap-6">
        <HeroCarousel articles={rotating} />
        {fixed.length > 0 ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1 lg:grid-rows-2 lg:gap-6">
            {fixed.map((a) => (
              <FeatureCard key={a.id} article={a} />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** A fixed main article: the image fills the card, the headline sits on it. */
function FeatureCard({ article: a }: { article: ArticleCard }) {
  return (
    <Link
      href={articleHref(a)}
      className="group relative flex min-h-[230px] flex-col justify-end overflow-hidden rounded-xl p-5 text-white lg:min-h-0"
      style={{ background: toneBackground(a.id) }}
    >
      {a.image ? (
        <Image
          src={a.image.url}
          alt={a.image.alt}
          fill
          sizes="(min-width: 1280px) 410px, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
          className="object-cover transition-transform duration-500 group-hover:scale-[1.04] motion-reduce:transition-none"
        />
      ) : null}
      <span aria-hidden="true" className="absolute inset-0 bg-linear-to-b from-ink/0 from-25% via-ink/50 via-55% to-ink/95" />
      <CategoryTag name={a.category.name} className="absolute right-4 top-4" />
      <h2 className="relative text-balance text-[21px] font-extrabold leading-[1.25] [text-shadow:0_2px_12px_rgba(0,0,0,.45)] md:text-[23px]">{a.title}</h2>
      <span className="relative mt-2 text-[13px] text-[#BEBEC7]">
        {a.author ? <>מאת {a.author.name} · </> : null}
        <PublishedTime iso={a.publishedAt} />
      </span>
    </Link>
  );
}
function BreakingTicker({ items }: { items: ArticleCard[] }) {
  if (items.length === 0) return null;
  const row = (hidden: boolean) =>
    items.map((a) => (
      <span
        key={`${hidden ? 'b' : 'a'}-${a.id}`}
        aria-hidden={hidden || undefined}
        className="inline-flex items-baseline gap-2.5 whitespace-nowrap text-sm"
      >
        <PublishedTime iso={a.publishedAt} className="text-[13px] text-brand" />
        <Link href={articleHref(a)} tabIndex={hidden ? -1 : undefined} className="font-semibold hover:text-brand">
          {a.title}
        </Link>
      </span>
    ));

  return (
    <div className="mb-5 flex items-center gap-4 border-b border-line pb-3">
      <span className="inline-flex shrink-0 items-center gap-2 rounded-full bg-brand py-[5px] pe-3.5 ps-3 text-[13px] font-extrabold text-white">
        <span aria-hidden="true" className="h-2 w-2 rounded-full bg-white" />
        מבזקים
      </span>
      {/* Two copies so the loop is seamless; the copy is hidden from screen readers. */}
      <TickerMotion>
        {row(false)}
        {row(true)}
      </TickerMotion>
    </div>
  );
}
