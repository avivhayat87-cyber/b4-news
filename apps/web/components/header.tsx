import Link from 'next/link';
import { getLatest, getMarkets } from '@/lib/api';
import { formatToday } from '@/lib/format';
import { SITE, articleHref } from '@/lib/site';
import type { ArticleCard, MarketQuote } from '@/lib/types';
import { SearchIcon } from './icons';
import { SectionNav } from './section-nav';
import { PublishedTime, wrap } from './ui';

export async function SiteHeader() {
  const [latest, markets] = await Promise.all([getLatest(), getMarkets()]);
  return (
    <>
      <UtilityBar markets={markets.slice(0, 4)} />
      <Masthead />
      <SectionNav />
      <BreakingTicker items={latest} />
    </>
  );
}

function UtilityBar({ markets }: { markets: MarketQuote[] }) {
  return (
    <div className="on-dark bg-ink text-[13px] text-mist">
      <div className={`${wrap} flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5 py-2`}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className="font-bold text-white">{formatToday()}</span>
          <Link href="/about" className="hover:text-white">אודות</Link>
          <Link href="/contact" className="hover:text-white">צור קשר</Link>
          <Link href="/advertise" className="hover:text-white">פרסמו אצלנו</Link>
        </div>
        {markets.length > 0 ? (
          <ul className="flex flex-wrap items-center gap-x-5 gap-y-1.5" aria-label="מדדים">
            {markets.map((m) => (
              <li key={m.symbol} className="inline-flex items-baseline gap-2">
                <span className="font-semibold text-white">{m.name}</span>
                <span dir="ltr" className="font-mono text-xs tabular-nums">{m.value}</span>
                <span dir="ltr" className="font-mono text-xs tabular-nums text-[#9A9AA3]">{m.change}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function Masthead() {
  return (
    <header className="bg-white">
      <div className={`${wrap} flex flex-wrap items-center justify-between gap-x-8 gap-y-4 py-5`}>
        <Link href="/" aria-label={`${SITE.name}, לדף הבית`} className="flex flex-col gap-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element -- static SVG logo */}
          <img
            src="/brand/b4-logo.svg"
            alt={SITE.name}
            width={190}
            height={71}
            className="block h-auto w-[150px] md:w-[190px]"
          />
          <span className="ps-0.5 text-[13px] font-bold text-muted">{SITE.tagline}</span>
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <form
            action="/search"
            role="search"
            className="flex h-11 flex-[1_1_260px] items-center overflow-hidden rounded-full border-[1.5px] border-ink bg-white"
          >
            <label htmlFor="site-search" className="sr-only">
              חיפוש באתר
            </label>
            <input
              id="site-search"
              name="q"
              type="search"
              placeholder="חיפוש כתבות, נושאים ואנשים"
              className="h-full min-w-0 flex-1 bg-transparent px-[18px] text-sm outline-none placeholder:text-muted"
            />
            <button
              type="submit"
              aria-label="חיפוש"
              className="flex h-11 w-11 shrink-0 items-center justify-center bg-ink text-white"
            >
              <SearchIcon size={20} />
            </button>
          </form>
          <Link
            href="#newsletter"
            className="inline-flex h-11 items-center whitespace-nowrap rounded-full bg-brand px-[22px] text-sm font-extrabold text-white hover:bg-brand-deep"
          >
            הרשמה לניוזלטר
          </Link>
        </div>
      </div>
    </header>
  );
}

function BreakingTicker({ items }: { items: ArticleCard[] }) {
  if (items.length === 0) return null;
  const row = (hidden: boolean) =>
    items.map((a) => (
      <span key={`${hidden ? 'b' : 'a'}-${a.id}`} aria-hidden={hidden || undefined} className="inline-flex items-baseline gap-2.5 whitespace-nowrap text-sm">
        <PublishedTime iso={a.publishedAt} className="text-[13px] text-brand" />
        <Link href={articleHref(a)} tabIndex={hidden ? -1 : undefined} className="font-semibold hover:text-brand">
          {a.title}
        </Link>
      </span>
    ));

  return (
    <div className="border-b border-line bg-white">
      <div className={`${wrap} flex items-center gap-4 py-2.5`}>
        <span className="inline-flex shrink-0 items-center gap-2 rounded-[3px] bg-ink px-3 py-[5px] text-[13px] font-extrabold text-white">
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-brand" />
          מבזקים
        </span>
        <div className="group min-w-0 flex-1 overflow-hidden">
          {/* Two copies so the loop is seamless; the copy is hidden from screen readers. */}
          <div className="flex w-max gap-10 animate-ticker group-hover:[animation-play-state:paused] motion-reduce:animate-none">
            {row(false)}
            {row(true)}
          </div>
        </div>
      </div>
    </div>
  );
}
