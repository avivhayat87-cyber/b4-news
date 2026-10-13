import Link from 'next/link';
import { getMarkets } from '@/lib/api';
import { MARKET_TABS, marketsHref, type MarketTabSlug } from '@/lib/markets';
import { MarketsWidget } from './sidebar';
import { ChartPanel, EconomicCalendar, MarketQuotes, StockHeatmap, StockScreener } from './tradingview';
import { SealDot, wrap } from './ui';

/** /markets and its tabs: each tab is its own address, so it can be linked and shared. */
export async function MarketsPage({ slug }: { slug: MarketTabSlug }) {
  const tab = MARKET_TABS.find((t) => t.slug === slug)!;
  const quotes = slug === '' ? await getMarkets() : [];

  return (
    <div className={`${wrap} pb-8 pt-8`}>
      <div className="flex items-center gap-2.5">
        <SealDot size={26} />
        <h1 className="font-display text-[30px] font-extrabold leading-none md:text-[36px]">שווקים</h1>
        <span aria-hidden="true" className="h-0.5 flex-1 bg-ink" />
      </div>

      <nav aria-label="נתוני שווקים" className="mt-5 border-b border-line">
        <ul className="scrollbar-none -mx-4 flex overflow-x-auto px-4 md:mx-0 md:px-0">
          {MARKET_TABS.map((t) => (
            <li key={t.slug} className="shrink-0">
              <Link
                href={marketsHref(t.slug)}
                aria-current={t.slug === slug ? 'page' : undefined}
                className={`-mb-px block whitespace-nowrap border-b-4 px-3.5 pb-2.5 pt-2 text-base outline-offset-[-3px] ${
                  t.slug === slug ? 'border-brand font-extrabold text-ink' : 'border-transparent font-bold text-brand hover:border-brand/30 hover:text-brand-deep'
                }`}
              >
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <p className="mb-5 mt-4 text-[17px] leading-relaxed text-ink-2">{tab.description}</p>

      {slug === '' ? (
        <div className="flex flex-wrap gap-8">
          <div className="min-w-0 flex-[999_1_620px]">
            <MarketQuotes />
          </div>
          <aside className="min-w-0 flex-[1_1_300px]">
            <MarketsWidget quotes={quotes} />
          </aside>
        </div>
      ) : slug === 'heatmap' ? (
        <StockHeatmap />
      ) : slug === 'screener' ? (
        <StockScreener />
      ) : slug === 'charts' ? (
        <ChartPanel />
      ) : (
        <EconomicCalendar />
      )}

      <p className="mt-6 border-t border-line pt-4 text-[13px] leading-relaxed text-muted">
        הנתונים מוצגים באמצעות TradingView ועשויים להתעדכן בעיכוב. המידע מוצג לצורכי מידע בלבד ואינו מהווה ייעוץ השקעות או המלצה לפעולה בניירות ערך.
      </p>
    </div>
  );
}
