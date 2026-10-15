'use client';
// "הרשמה לניוזלטר" in the footer's red band: a small window with the sign-up form, over the page,
// instead of a jump to the form at the bottom. The browser's own modal dialog keeps the focus
// inside, closes with Escape, and gives the focus back to the button.
import { useRef } from 'react';
import { NewsletterForm } from './newsletter-form';

export function NewsletterDialogButton({ className }: { className: string }) {
  const dialog = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button type="button" onClick={() => dialog.current?.showModal()} className={className}>
        הרשמה לניוזלטר
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="nl-dialog-title"
        // A click on the dimmed page around the window closes it (the window itself fills the dialog).
        onClick={(e) => e.target === e.currentTarget && dialog.current?.close()}
        className="on-dark m-auto w-[min(440px,calc(100%-32px))] rounded-[14px] bg-ink text-white shadow-[0_24px_60px_rgba(0,0,0,.45)] backdrop:bg-black/60"
      >
        <div className="relative px-6 pb-6 pt-7">
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            aria-label="סגירה"
            className="absolute end-3 top-3 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-mist hover:bg-white/10 hover:text-white"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
          <h2 id="nl-dialog-title" className="pe-10 text-[24px] font-extrabold leading-tight">
            הניוזלטר של B4
          </h2>
          <p className="mb-4 mt-2 text-[15px] leading-relaxed text-mist">פעם ביום, הכתבות החשובות של הכלכלה הישראלית והעולמית במייל אחד.</p>
          <NewsletterForm id="nl-email-dialog" layout="stacked" />
        </div>
      </dialog>
    </>
  );
}
