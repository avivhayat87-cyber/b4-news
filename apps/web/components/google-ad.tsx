'use client';
// A Google AdSense unit in one of our places (the API decides when: a place no campaign of ours
// takes, allowed for Google). The AdSense script loads once per page, and only ever after the
// reader agreed to advertising cookies (AdSlot checks); a unit Google leaves empty folds away. In
// development a labeled stand-in shows where Google would fill: AdSense serves nothing on an
// address it hasn't approved, and the workshop never calls Google.
import { useEffect, useRef } from 'react';

const SCRIPT = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js';
const LIVE = process.env.NODE_ENV === 'production';

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

let scriptAdded = false;

function addScript(client: string) {
  if (scriptAdded) return;
  scriptAdded = true;
  const el = document.createElement('script');
  el.async = true;
  el.crossOrigin = 'anonymous';
  el.src = `${SCRIPT}?client=${encodeURIComponent(client)}`;
  document.head.appendChild(el);
}

/** wide: a strip at the top of a page (a horizontal unit); otherwise Google picks the size that fits. */
export function GoogleAd({ client, unit, wide }: { client: string; unit: string; wide: boolean }) {
  const asked = useRef(false);
  useEffect(() => {
    if (!LIVE || asked.current) return;
    asked.current = true;
    addScript(client);
    try {
      (window.adsbygoogle = window.adsbygoogle ?? []).push({});
    } catch {
      // A blocked script (an ad blocker) leaves the place empty, never the page broken.
    }
  }, [client]);

  if (!LIVE) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-1 rounded-[10px] border-2 border-dashed border-[#4285F4] bg-[#EEF4FE] p-3 text-center ${wide ? 'min-h-[90px]' : 'min-h-[250px]'}`}
      >
        <span className="text-xs font-bold text-[#1A56C4]">מודעת Google תופיע כאן</span>
        <span className="text-[11px] text-ink-2" dir="ltr">
          {client} · {unit}
        </span>
        <span className="text-[11px] text-muted">בסביבת הפיתוח לא פונים ל-Google. באתר החי, אחרי אישור AdSense, תופיע כאן מודעה.</span>
      </div>
    );
  }
  return (
    <ins
      className="adsbygoogle block [&[data-ad-status=unfilled]]:hidden"
      style={{ display: 'block' }}
      data-ad-client={client}
      data-ad-slot={unit}
      data-ad-format={wide ? 'horizontal' : 'auto'}
      data-full-width-responsive="true"
    />
  );
}
