import Link from 'next/link';
import { getSite } from '@/lib/api';
import { marketsHref } from '@/lib/markets';
import { socialLinks } from '@/lib/site';
import type { MarketQuote } from '@/lib/types';
import { SocialIcon } from './icons';
import { NewsletterForm } from './newsletter-form';
import { MarketOverview } from './tradingview';
import { HousePromo, SectionHeader } from './ui';

const changeStyle: Record<MarketQuote['direction'], string> = {
  up: 'bg-[#E7F6EC] text-[#11743A]',
  down: 'bg-brand-soft text-brand-deep',
  flat: 'bg-stone text-ink-2',
};

/** Official exchange rates; hidden entirely when the data isn't available. */
export function MarketsWidget({ quotes }: { quotes: MarketQuote[] }) {
  if (quotes.length === 0) return null;
  return (
    <section aria-labelledby="markets-title" className="rounded-[10px] border border-line px-5 py-[18px]">
      <SectionHeader id="markets-title" title="שערי מטבע" size="sm" rule={false} className="mb-2" />
      <dl>
        {quotes.map((q) => (
          <div key={q.symbol} className="flex items-center justify-between gap-3 border-t border-line-soft py-2.5">
            <dt className="text-[15px] font-bold">{q.name}</dt>
            <dd dir="ltr" className="flex items-center gap-3 font-mono text-sm tabular-nums">
              <span>{q.value}</span>
              <span className={`min-w-16 rounded px-1.5 py-0.5 text-center text-[13px] ${changeStyle[q.direction]}`}>{q.change}</span>
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-1 text-xs text-muted">שערים יציגים, בנק ישראל</p>
    </section>
  );
}

export function NewsletterBox() {
  return (
    <section aria-labelledby="nl-box-title" className="on-dark rounded-[10px] bg-ink px-5 py-[22px] text-white">
      <h2 id="nl-box-title" className="text-[24px] font-extrabold leading-tight">
        הניוזלטר של B4
      </h2>
      <p className="mb-3.5 mt-2 text-[15px] leading-relaxed text-mist">פעם ביום, הכתבות החשובות של הכלכלה הישראלית והעולמית במייל אחד.</p>
      <NewsletterForm id="nl-email-side" layout="stacked" />
    </section>
  );
}

/** Social profiles set in the CMS; renders nothing until at least one is set. */
export function SocialLinks({ variant, links }: { variant: 'solid' | 'outline'; links: Record<string, string> }) {
  const items = socialLinks(links);
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2.5">
      {items.map((s) => (
        <li key={s.key}>
          <a
            href={s.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={s.label}
            className={
              variant === 'solid'
                ? 'flex h-11 w-11 items-center justify-center rounded-full bg-ink text-white hover:bg-brand'
                : 'flex h-10 w-10 items-center justify-center rounded-full border-[1.5px] border-night-line text-[#E4E4E8] hover:border-white hover:text-white'
            }
          >
            <SocialIcon name={s.key} size={variant === 'solid' ? 20 : 18} />
          </a>
        </li>
      ))}
    </ul>
  );
}

/** Indices, commodities, currencies and crypto in tabs (TradingView), with a way into /markets. */
export function MarketOverviewBox() {
  return (
    <section aria-labelledby="overview-title" className="rounded-[10px] border border-line px-3 pt-[18px]">
      <SectionHeader id="overview-title" title="שווקים" size="sm" rule={false} className="mb-1 px-2">
        <Link href={marketsHref()} className="ms-auto whitespace-nowrap text-[13px] font-extrabold text-brand hover:text-brand-deep">
          לכל נתוני השווקים
        </Link>
      </SectionHeader>
      <MarketOverview />
    </section>
  );
}

export async function Sidebar({ quotes, marketOverview = false }: { quotes: MarketQuote[]; marketOverview?: boolean }) {
  const site = await getSite();
  const hasSocial = socialLinks(site.links).length > 0;
  return (
    <aside className="flex min-w-0 flex-[1_1_300px] flex-col gap-7">
      {marketOverview ? <MarketOverviewBox /> : null}
      <MarketsWidget quotes={quotes} />
      <NewsletterBox />
      {hasSocial ? (
        <section aria-labelledby="follow-title">
          <SectionHeader id="follow-title" title="עקבו אחרינו" size="sm" rule={false} className="mb-3" />
          <SocialLinks variant="solid" links={site.links} />
        </section>
      ) : null}
      <HousePromo />
    </aside>
  );
}
