import type { MarketQuote } from '@/lib/types';
import { SOCIAL } from '@/lib/site';
import { SocialIcon } from './icons';
import { NewsletterForm } from './newsletter-form';
import { AdSlot, SectionHeader } from './ui';

const changeStyle: Record<MarketQuote['direction'], string> = {
  up: 'bg-[#E7F6EC] text-[#11743A]',
  down: 'bg-brand-soft text-brand-deep',
  flat: 'bg-stone text-ink-2',
};

export function MarketsWidget({ quotes }: { quotes: MarketQuote[] }) {
  return (
    <section aria-labelledby="markets-title" className="rounded-[10px] border border-line px-5 py-[18px]">
      <SectionHeader id="markets-title" title="בורסה ומדדים" size="sm" rule={false} className="mb-2" />
      {quotes.length === 0 ? (
        <p className="py-3 text-sm text-muted">נתוני המסחר לא זמינים כרגע.</p>
      ) : (
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
      )}
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

export function SocialLinks({ variant }: { variant: 'solid' | 'outline' }) {
  return (
    <ul className="flex flex-wrap gap-2.5">
      {SOCIAL.map((s) => (
        <li key={s.key}>
          <a
            href={s.href}
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

export function Sidebar({ quotes }: { quotes: MarketQuote[] }) {
  return (
    <aside className="flex min-w-0 flex-[1_1_300px] flex-col gap-7">
      <MarketsWidget quotes={quotes} />
      <NewsletterBox />
      <section aria-labelledby="follow-title">
        <SectionHeader id="follow-title" title="עקבו אחרינו" size="sm" rule={false} className="mb-3" />
        <SocialLinks variant="solid" />
      </section>
      <AdSlot />
    </aside>
  );
}
