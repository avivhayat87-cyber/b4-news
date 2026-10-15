'use client';

// Every reader accepts the terms once per version: a bar at the bottom of the screen
// that doesn't block reading, stays until answered, and comes back when the terms
// change. The answer is kept in the browser and recorded by the API (anonymous id).
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { consentApi } from '@/lib/client-api';

const KEY = 'b4.consent';
export const OPEN_CONSENT_EVENT = 'b4:consent-open';
/** Fired when the reader answers, so the ad places see a new choice about advertising cookies at once. */
export const CONSENT_CHANGED_EVENT = 'b4:consent-changed';

/** askedAds: whether the bar asked about advertising cookies (it does only while third-party ads are on). */
type Stored = { visitorId: string; version: string; ads: boolean; askedAds?: boolean; at: string };

function read(): Stored | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    return null;
  }
}

function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Whether this reader agreed to third-party advertising cookies (for loading ad scripts). */
export function adsConsented(version: string): boolean {
  const c = typeof window === 'undefined' ? null : read();
  return Boolean(c && c.version === version && c.ads);
}

export function ConsentBanner({ version, adsCookies }: { version: string; adsCookies: boolean }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // A new terms version, or ad cookies came into use after this reader answered without being asked about them.
    const stored = read();
    if (stored?.version !== version || (adsCookies && !stored?.askedAds)) setOpen(true);
    const reopen = () => setOpen(true);
    window.addEventListener(OPEN_CONSENT_EVENT, reopen);
    return () => window.removeEventListener(OPEN_CONSENT_EVENT, reopen);
  }, [version, adsCookies]);

  const answer = useCallback(
    (ads: boolean) => {
      const stored: Stored = { visitorId: read()?.visitorId ?? newId(), version, ads, askedAds: adsCookies, at: new Date().toISOString() };
      try {
        window.localStorage.setItem(KEY, JSON.stringify(stored));
      } catch {
        // Private mode or blocked storage: the bar returns on the next visit.
      }
      setOpen(false);
      window.dispatchEvent(new Event(CONSENT_CHANGED_EVENT));
      // The record is evidence, not a gate: reading goes on even if the API is unreachable.
      void consentApi.record({ visitorId: stored.visitorId, version, ads }).catch(() => undefined);
    },
    [version, adsCookies],
  );

  if (!open) return null;
  return (
    <section
      aria-label="אישור תנאי השימוש"
      className="on-dark fixed inset-x-0 bottom-0 z-40 border-t-4 border-brand bg-ink text-mist shadow-[0_-8px_24px_rgba(0,0,0,.25)]"
    >
      <div className="mx-auto flex w-full max-w-[1280px] flex-wrap items-center justify-between gap-x-8 gap-y-3 px-4 py-4 md:px-6">
        <p className="min-w-0 flex-[1_1_480px] text-[15px] leading-relaxed">
          <strong className="font-extrabold text-white">השימוש באתר כפוף ל</strong>
          <Link href="/terms" className="font-extrabold text-white underline underline-offset-2">
            תנאי השימוש
          </Link>
          <strong className="font-extrabold text-white"> ול</strong>
          <Link href="/privacy" className="font-extrabold text-white underline underline-offset-2">
            מדיניות הפרטיות
          </Link>
          <strong className="font-extrabold text-white">.</strong>{' '}
          {adsCookies
            ? 'נשמח גם להשתמש בעוגיות פרסום של צד שלישי, כדי להציג מודעות שמתאימות לך. אפשר לשנות את הבחירה בכל עת ב״ניהול הסכמה״ בתחתית האתר.'
            : 'התוכן נועד למידע כללי ואינו ייעוץ השקעות. אנחנו לא משתמשים בעוגיות פרסום.'}
        </p>
        <div className="flex flex-wrap gap-2">
          {adsCookies ? (
            <button
              type="button"
              onClick={() => answer(false)}
              className="inline-flex h-11 items-center rounded-full border-2 border-white px-5 text-[15px] font-extrabold text-white hover:bg-white/10"
            >
              מסכים/ה, בלי עוגיות פרסום
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => answer(adsCookies)}
            className="inline-flex h-11 items-center rounded-full bg-brand px-6 text-[15px] font-extrabold text-white hover:bg-brand-deep"
          >
            {adsCookies ? 'מסכים/ה לכל' : 'אני מסכים/ה'}
          </button>
        </div>
      </div>
    </section>
  );
}

/** "ניהול הסכמה" in the footer: shows the bar again. */
export function ManageConsentButton({ className = '' }: { className?: string }) {
  return (
    <button type="button" onClick={() => window.dispatchEvent(new Event(OPEN_CONSENT_EVENT))} className={className}>
      ניהול הסכמה
    </button>
  );
}
