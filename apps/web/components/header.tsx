import Link from 'next/link';
import { getMarkets } from '@/lib/api';
import { formatToday } from '@/lib/format';
import { SITE } from '@/lib/site';
import type { MarketQuote } from '@/lib/types';
import { SearchIcon } from './icons';
import { SectionNav } from './section-nav';
import { wrap } from './ui';

export async function SiteHeader() {
  const markets = await getMarkets();
  return (
    <>
      <UtilityBar markets={markets.slice(0, 4)} />
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
                className="block h-auto w-[170px] md:w-[230px] xl:w-[290px]"
              />
              <span className="hidden border-s border-line ps-4 text-[13px] font-bold leading-snug text-muted sm:block">
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

function UtilityBar({ markets }: { markets: MarketQuote[] }) {
  return (
    <div className="on-dark bg-ink text-[13px] text-mist">
      <div className={`${wrap} flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5 py-2`}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className="font-bold text-white">{formatToday()}</span>
          <Link href="/about" className="hover:text-white">
            אודות
          </Link>
          <Link href="/contact" className="hover:text-white">
            צור קשר
          </Link>
          <Link href="/advertise" className="hover:text-white">
            פרסמו אצלנו
          </Link>
        </div>
        {markets.length > 0 ? (
          <ul className="flex flex-wrap items-center gap-x-5 gap-y-1.5" aria-label="מדדים">
            {markets.map((m) => (
              <li key={m.symbol} className="inline-flex items-baseline gap-2">
                <span className="font-semibold text-white">{m.name}</span>
                <span dir="ltr" className="font-mono text-xs tabular-nums">
                  {m.value}
                </span>
                <span dir="ltr" className="font-mono text-xs tabular-nums text-[#9A9AA3]">
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
