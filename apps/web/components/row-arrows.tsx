'use client';
// Arrows at the two ends of a row that scrolls sideways: the way to the rest with a mouse or a
// touch screen on a computer. Each one shows only while there is more that way. Phones and
// tablets (no hover) swipe, and the arrows would only cover the little room the row has there.
import type { RefObject } from 'react';

/** How much of the visible width one press moves, so the last item stays in view as a landmark. */
const STEP = 0.8;

export function RowArrows({
  track,
  atStart,
  atEnd,
  name,
}: {
  track: RefObject<HTMLElement | null>;
  atStart: boolean;
  atEnd: boolean;
  /** What the row holds, in the plural, for the buttons' names ("מדורים" → "עוד מדורים"). */
  name: string;
}) {
  const move = (towardsEnd: boolean) => {
    const el = track.current;
    if (!el) return;
    // In RTL the end is on the left, at negative scrollLeft.
    const sign = getComputedStyle(el).direction === 'rtl' ? -1 : 1;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: sign * (towardsEnd ? 1 : -1) * el.clientWidth * STEP, behavior: reduced ? 'auto' : 'smooth' });
  };

  return (
    <>
      {atStart ? null : <Arrow side="start" label={`חזרה ל${name} הקודמים`} onClick={() => move(false)} />}
      {atEnd ? null : <Arrow side="end" label={`עוד ${name}`} onClick={() => move(true)} />}
    </>
  );
}

function Arrow({ side, label, onClick }: { side: 'start' | 'end'; label: string; onClick: () => void }) {
  // The fade under the button hides what it covers, so the button never sits on half a word.
  return (
    <span
      className={`pointer-events-none absolute inset-y-0 z-10 flex w-14 items-center px-1 [@media(hover:none)]:hidden ${
        side === 'start' ? 'start-0 justify-start bg-linear-to-l' : 'end-0 justify-end bg-linear-to-r'
      } from-white from-45% to-white/0`}
    >
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className="pointer-events-auto flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border-[1.5px] border-line bg-white text-ink shadow-[0_1px_4px_rgba(0,0,0,.12)] hover:border-ink"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={side === 'start' ? 'M9 6l6 6-6 6' : 'M15 6l-6 6 6 6'} />
        </svg>
      </button>
    </span>
  );
}
