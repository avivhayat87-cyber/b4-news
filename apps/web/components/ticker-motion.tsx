'use client';
// The breaking-news ticker's motion. Moving text needs a way to stop it: it stops under the
// mouse, while a link in it has keyboard focus, and with its button. With reduced motion
// it never moves, so the button is not shown.
import { useState, type ReactNode } from 'react';

export function TickerMotion({ children }: { children: ReactNode }) {
  const [paused, setPaused] = useState(false);
  return (
    <>
      <div className="group min-w-0 flex-1 overflow-hidden">
        <div
          className={`flex w-max gap-10 animate-ticker group-focus-within:[animation-play-state:paused] group-hover:[animation-play-state:paused] motion-reduce:animate-none ${paused ? '[animation-play-state:paused]' : ''}`}
        >
          {children}
        </div>
      </div>
      <button
        type="button"
        onClick={() => setPaused((p) => !p)}
        aria-label={paused ? 'הפעלת המבזקים הרצים' : 'עצירת המבזקים הרצים'}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-[1.5px] border-line text-ink hover:border-ink motion-reduce:hidden"
      >
        {paused ? (
          <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true">
            <path d="M7 4.5v15l12-7.5z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true">
            <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
          </svg>
        )}
      </button>
    </>
  );
}
