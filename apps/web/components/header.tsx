import Link from 'next/link';
import { getMarkets, getSite } from '@/lib/api';
import { formatToday } from '@/lib/format';
import { SITE } from '@/lib/site';
import type { MarketQuote } from '@/lib/types';
import { SearchIcon } from './icons';
import { SectionNav } from './section-nav';
import { wrap } from './ui';

const UTILITY_PAGES = ['about', 'contact', 'advertise'];

export async function SiteHeader() {
  const [markets, site] = await Promise.all([getMarkets(), getSite()]);
  const pages = site.pages.filter((p) => UTILITY_PAGES.includes(p.slug));
  return (
    <>
      <UtilityBar markets={markets.slice(0, 3)} pages={pages} />
      {/* White header: large seal logo with the section links beside it (owner's design) */}
      <header className="border-b border-line bg-white">
        <div className={`${wrap} flex flex-col gap-1 py-3 lg:flex-row lg:items-center lg:gap-6 lg:py-4`}>
          <div className="flex items-center justify-between gap-4">
            <Link href="/" aria-label={`${SITE.name}, לדף הבית`} className="flex items-center gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element -- static SVG logo */}
              <img
                src="/brand/b4-logo.svg"
                alt={SITE.name}
                width={300}
                height={111}
                className="block h-auto w-[150px] md:w-[210px] xl:w-[250px]"
              />
              <span className="hidden border-s border-line ps-4 text-[13px] font-bold leading-snug text-muted xl:block">
                חדשות. כלכלה.
                <br />
                לפני כולם.
              </span>
            </Link>
            <SearchLink className="flex lg:hidden" />
          </div>
          <SectionNav />
          <SearchLink className="hidden lg:flex" />
        </div>
      </header>
    </>
  );
}

function SearchLink({ className = '' }: { className?: string }) {
  return (
    <Link
      href="/search"
      aria-label="חיפוש באתר"
      className={`h-11 w-11 shrink-0 items-center justify-center rounded-full border-[1.5px] border-line text-ink hover:border-ink ${className}`}
    >
      <SearchIcon size={20} />
    </Link>
  );
}

/** One line on every screen: the date, info links (from md), and the exchange rates. */
function UtilityBar({ markets, pages }: { markets: MarketQuote[]; pages: { slug: string; title: string }[] }) {
  return (
    <div className="on-dark bg-ink text-[13px] text-mist">
      <div className={`${wrap} flex items-center justify-between gap-x-6 py-2`}>
        <div className="flex min-w-0 items-center gap-x-4">
          <span className="whitespace-nowrap font-bold text-white">{formatToday()}</span>
          {pages.map((p) => (
            <Link key={p.slug} href={`/${p.slug}`} className="hidden whitespace-nowrap hover:text-white md:inline">
              {p.title}
            </Link>
          ))}
        </div>
        {markets.length > 0 ? (
          <ul className="scrollbar-none flex min-w-0 items-center gap-x-5 overflow-x-auto" aria-label="שערי מטבע (בנק ישראל)">
            {markets.map((m, i) => (
              <li key={m.symbol} className={`items-baseline gap-2 whitespace-nowrap ${i > 0 ? 'hidden sm:inline-flex' : 'inline-flex'}`}>
                <span className="font-semibold text-white">{m.name}</span>
                <span dir="ltr" className="font-mono text-xs tabular-nums">
                  {m.value}
                </span>
                <span dir="ltr" className={`font-mono text-xs tabular-nums ${m.direction === 'up' ? 'text-[#5BD38A]' : m.direction === 'down' ? 'text-[#FF7A82]' : 'text-[#9A9AA3]'}`}>
                  {m.change}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
