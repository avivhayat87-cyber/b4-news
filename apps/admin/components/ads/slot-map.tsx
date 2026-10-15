'use client';
// The ad places, drawn where they are: sketches of the home page, a section, an article and the
// app, with each place as a button on them. Choosing a place for a campaign is clicking it on the
// sketch; read-only, the same sketches show where ads can go. And a link that opens the real site
// with every place framed (the site's "?adspots=1"), before any campaign runs.
import { AD_SLOT_FORMATS, type AdSlot } from '@b4/shared';
import type { ReactNode } from 'react';
import { SITE_URL } from '@/lib/api';
import { AD_FORMAT, AD_SLOT } from '@/lib/labels';
import { cx } from '../ui';

/** notes: a short line under a place (how much of it is free for the campaign's dates). */
type Pick = { selected: AdSlot[]; onToggle?: (slot: AdSlot) => void; notes?: Partial<Record<AdSlot, { text: string; full: boolean }>> };

const Bar = ({ className }: { className?: string }) => <span className={cx('block rounded-sm bg-line', className)} />;

function Spot({ slot, pick, className, short }: { slot: AdSlot; pick: Pick; className?: string; short?: boolean }) {
  const on = pick.selected.includes(slot);
  const body = (
    <>
      <span className="font-bold leading-tight">{AD_SLOT[slot].name}</span>
      {!short && <span className={cx('text-[10px] leading-tight', on ? 'text-white/80' : 'text-brand-deep/70')}>{AD_SLOT_FORMATS[slot].map((f) => AD_FORMAT[f].name).join(' / ')}</span>}
      {pick.notes?.[slot] && (
        <span className={cx('rounded px-1 text-[10px] font-bold leading-tight', pick.notes[slot]!.full ? 'bg-ink text-white' : on ? 'bg-white/25 text-white' : 'bg-white text-ok')}>{pick.notes[slot]!.text}</span>
      )}
    </>
  );
  const style = cx('flex flex-col items-center justify-center gap-0.5 rounded border-2 border-dashed px-1 text-center text-[11px] transition-colors', on ? 'border-brand bg-brand text-white' : 'border-brand/60 bg-brand-soft text-brand-deep', className);
  return pick.onToggle ? (
    <button type="button" aria-pressed={on} onClick={() => pick.onToggle!(slot)} className={cx(style, 'hover:border-brand')} title={AD_SLOT[slot].where}>
      {body}
    </button>
  ) : (
    <span className={style} title={AD_SLOT[slot].where}>
      {body}
    </span>
  );
}

function Sketch({ title, children, phone }: { title: string; children: ReactNode; phone?: boolean }) {
  return (
    <figure className="flex flex-col gap-2">
      <div className={cx('space-y-1.5 bg-white p-2.5 ring-1 ring-line', phone ? 'mx-auto w-[150px] rounded-[18px] px-3 py-4' : 'rounded-lg')}>{children}</div>
      <figcaption className="text-center text-xs font-bold text-ink-2">{title}</figcaption>
    </figure>
  );
}

const Header = () => (
  <div className="flex items-center justify-between">
    <span className="h-3 w-3 rounded-full bg-brand" />
    <Bar className="h-1.5 w-20" />
  </div>
);

export function SlotMap({ selected, onToggle, notes }: Pick) {
  const pick = { selected, onToggle, notes };
  return (
    <div className="space-y-3">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Sketch title="דף הבית">
          <Header />
          <Bar className="h-10 bg-ink/70" />
          <Spot slot="home_top" pick={pick} className="h-10" />
          <div className="grid grid-cols-[1fr_38%] gap-1.5">
            <div className="space-y-1.5">
              <Bar className="h-6" />
              <Bar className="h-6" />
              <Bar className="h-6" />
            </div>
            <div className="space-y-1.5">
              <Bar className="h-5" />
              <Spot slot="sidebar" pick={pick} className="h-14" short />
            </div>
          </div>
        </Sketch>

        <Sketch title="עמוד מדור">
          <Header />
          <Bar className="h-2 w-16" />
          <Spot slot="category_top" pick={pick} className="h-10" />
          <div className="grid grid-cols-[1fr_38%] gap-1.5">
            <div className="space-y-1.5">
              <Bar className="h-8" />
              <Bar className="h-5" />
              <Bar className="h-5" />
            </div>
            <div className="space-y-1.5">
              <Bar className="h-5" />
              <Spot slot="sidebar" pick={pick} className="h-14" short />
            </div>
          </div>
        </Sketch>

        <Sketch title="כתבה">
          <Header />
          <Bar className="h-2.5 w-3/4" />
          <Bar className="h-9" />
          <div className="grid grid-cols-[1fr_38%] gap-1.5">
            <div className="space-y-1">
              {[0, 1, 2, 3].map((i) => (
                <Bar key={i} className="h-1.5" />
              ))}
              <Spot slot="article_end" pick={pick} className="mt-1.5 h-11" short />
              <Bar className="h-4" />
            </div>
            <div className="space-y-1.5">
              <Bar className="h-6" />
              <Spot slot="article_side" pick={pick} className="h-14" short />
            </div>
          </div>
        </Sketch>

        <Sketch title="אפליקציה: הפיד" phone>
          <Bar className="h-8 bg-ink/70" />
          <Bar className="h-5" />
          <Bar className="h-5" />
          <Spot slot="app_feed" pick={pick} className="h-12" />
          <Bar className="h-5" />
          <Bar className="h-5" />
        </Sketch>

        <Sketch title="אפליקציה: כתבה" phone>
          <Bar className="h-2.5 w-3/4" />
          <Bar className="h-8" />
          {[0, 1, 2].map((i) => (
            <Bar key={i} className="h-1.5" />
          ))}
          <Spot slot="app_article" pick={pick} className="h-12" />
          <Bar className="h-5" />
        </Sketch>
      </div>
      {onToggle && <p className="text-xs text-muted">לוחצים על מקום כדי לבחור אותו (או לבטל). אותו מקום מסומן בכל עמוד שהוא מופיע בו.</p>}
    </div>
  );
}

/** Opens the real site with every ad place framed, so you see where ads go before any runs. */
export function SiteSpotsLinks() {
  const links = [
    ['דף הבית', `${SITE_URL}/?adspots=1`],
    ['עמוד מדור', `${SITE_URL}/category/israeli-economy?adspots=1`],
  ] as const;
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span className="font-bold text-ink-2">לראות את המקומות באתר עצמו:</span>
      {links.map(([label, href]) => (
        <a key={href} href={href} target="_blank" rel="noopener noreferrer" className="font-bold text-info underline underline-offset-2">
          {label}
        </a>
      ))}
      <span className="text-xs text-muted">(כל מקום מסומן במסגרת עם השם והגודל. נכנסים משם לכתבה כדי לראות את המקומות שבה.)</span>
    </p>
  );
}
