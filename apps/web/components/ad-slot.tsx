'use client';
// One ad place on the site. It asks for its ad when the page shows (never cached), labels it
// "פרסומת" with the advertiser's name, counts a view only when it was really seen, and opens a
// short lead form in place when the ad asks for one. How often this reader saw each campaign
// today is counted here in the browser (no cookie, nothing sent about the reader), and two places
// on one page never show the same campaign. An outage leaves the place empty, never the page.
import { AD_LABEL, AD_LEAD_FIELD_LABELS, AD_SIZES, type AdLeadField, type AdSlot as Slot, type PublicAd } from '@b4/shared';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiFailure, adsApi } from '@/lib/client-api';
import { HousePromo, NEW_WINDOW } from './ui';
import { useAdView } from './use-ad-view';

const SEEN_KEY = 'b4_ads_seen';
type Seen = { day: string; campaigns: Record<string, { n: number; cap: number }> };

const israelDay = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });

function readSeen(): Seen {
  try {
    const v = JSON.parse(localStorage.getItem(SEEN_KEY) ?? 'null') as Seen | null;
    if (v && v.day === israelDay() && v.campaigns) return v;
  } catch {
    // Storage blocked: no cap in this browser, which only means the ad may repeat.
  }
  return { day: israelDay(), campaigns: {} };
}

function countSeen(ad: PublicAd) {
  const seen = readSeen();
  const c = seen.campaigns[ad.campaignId] ?? { n: 0, cap: ad.perReaderDaily };
  seen.campaigns[ad.campaignId] = { n: c.n + 1, cap: ad.perReaderDaily };
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    // As above.
  }
}

const reachedCap = () => Object.entries(readSeen().campaigns).filter(([, c]) => c.n >= c.cap).map(([id]) => id);

/** The campaigns already on each page. */
const onPage = new Map<string, Set<string>>();

function Label({ sponsor }: { sponsor: string }) {
  return (
    <p className="mb-1.5 flex items-center gap-2 text-xs text-muted">
      <span className="rounded bg-stone px-1.5 py-0.5 font-bold text-ink-2">{AD_LABEL}</span>
      {sponsor ? <span>בחסות {sponsor}</span> : null}
    </p>
  );
}

const INPUT = 'block w-full rounded-md border border-line bg-white px-3 py-2 text-[15px] focus:border-ink focus:outline-none';

function LeadForm({ ad, onClose }: { ad: PublicAd; onClose(): void }) {
  const lead = ad.lead!;
  const [fields, setFields] = useState<Partial<Record<AdLeadField, string>>>({});
  const [consent, setConsent] = useState(false);
  const [trap, setTrap] = useState('');
  const [state, setState] = useState<{ busy: boolean; error: string | null; done: string | null }>({ busy: false, error: null, done: null });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setState({ busy: true, error: null, done: null });
    try {
      const r = await adsApi.lead({ token: ad.token, fields, consent: consent as true, ...(trap ? { website: trap } : {}) });
      setState({ busy: false, error: null, done: r.thankYou });
    } catch (err) {
      setState({ busy: false, error: err instanceof ApiFailure ? err.message : 'השליחה נכשלה. נסו שוב.', done: null });
    }
  }

  if (state.done) {
    return (
      <p role="status" className="mt-3 rounded-md bg-stone px-4 py-3 text-[15px] font-bold">
        {state.done}
      </p>
    );
  }
  return (
    <form onSubmit={submit} className="mt-3 space-y-3 rounded-[10px] border border-line p-4" aria-label={`השארת פרטים ל${ad.sponsor}`}>
      {lead.question ? <p className="font-bold">{lead.question}</p> : null}
      {lead.fields.map((f) => (
        <label key={f} className="block text-sm font-bold">
          {AD_LEAD_FIELD_LABELS[f]}
          <input
            className={`${INPUT} mt-1`}
            required={f !== 'note'}
            type={f === 'email' ? 'email' : f === 'phone' ? 'tel' : 'text'}
            dir={f === 'email' || f === 'phone' ? 'ltr' : undefined}
            autoComplete={f === 'name' ? 'name' : f === 'phone' ? 'tel' : f === 'email' ? 'email' : f === 'city' ? 'address-level2' : 'off'}
            maxLength={f === 'note' ? 1000 : 300}
            value={fields[f] ?? ''}
            onChange={(e) => setFields({ ...fields, [f]: e.target.value })}
          />
        </label>
      ))}
      {/* Left empty by people; bots fill it. */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" value={trap} onChange={(e) => setTrap(e.target.value)} className="hidden" />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" required checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />
        <span>{lead.consent}</span>
      </label>
      {state.error ? (
        <p role="alert" className="text-sm font-bold text-brand-deep">
          {state.error}
        </p>
      ) : null}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={state.busy} className="inline-flex h-11 items-center rounded-full bg-ink px-6 font-extrabold text-white hover:bg-brand disabled:opacity-60">
          {state.busy ? 'שולח…' : 'שליחה'}
        </button>
        <button type="button" onClick={onClose} className="text-sm font-bold text-muted hover:text-ink">
          סגירה
        </button>
      </div>
      <p className="text-xs text-muted">הפרטים עוברים ל{ad.sponsor} בלבד, כדי שיחזרו אליך.</p>
    </form>
  );
}

/** The ad itself: a banner, or a card with a picture, a headline, a line and a button. */
function AdBody({ ad, device }: { ad: PublicAd; device: 'desktop' | 'mobile' }) {
  if (ad.format === 'native') {
    return (
      <span className="group block overflow-hidden rounded-[10px] border border-line bg-white text-right">
        {ad.image.desktop ? (
          // eslint-disable-next-line @next/next/no-img-element -- the ad server's picture, sized by its own format
          <img src={ad.image.desktop} alt="" loading="lazy" className="aspect-video w-full object-cover" />
        ) : null}
        <span className="flex flex-col gap-1.5 p-4">
          <span className="text-balance text-[17px] font-extrabold leading-snug group-hover:text-brand">{ad.headline}</span>
          {ad.body ? <span className="text-[15px] leading-relaxed text-ink-2">{ad.body}</span> : null}
          {ad.cta ? <span className="mt-1 inline-flex self-start rounded-full bg-ink px-4 py-1.5 text-sm font-bold text-white group-hover:bg-brand">{ad.cta}</span> : null}
        </span>
      </span>
    );
  }
  const size = AD_SIZES[ad.format][device === 'mobile' && ad.format === 'billboard' ? 'mobile' : 'desktop'];
  const src = device === 'mobile' ? (ad.image.mobile ?? ad.image.desktop) : ad.image.desktop;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- the ad server's picture, at its exact size
    <img src={src ?? ''} alt={ad.image.alt} width={size.width} height={size.height} loading="lazy" className="mx-auto block h-auto w-full rounded" style={{ maxWidth: size.width }} />
  );
}

/**
 * fallback "promo": an empty place shows "advertise with B4" (when the CMS allows it).
 * minWidth: a place that exists only on wide screens (beside an article) asks for nothing on a phone.
 */
export function AdSlot({ slot, category, fallback = 'none', minWidth = 0, className = '' }: { slot: Slot; category?: string; fallback?: 'promo' | 'none'; minWidth?: number; className?: string }) {
  const [state, setState] = useState<{ ad: PublicAd | null; promo: boolean } | null>(null);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLElement>(null);

  useEffect(() => {
    if (window.innerWidth < minWidth) {
      setState({ ad: null, promo: false });
      return;
    }
    const dev = window.matchMedia('(max-width: 767px)').matches ? 'mobile' : 'desktop';
    setDevice(dev);
    const page = window.location.pathname;
    const here = onPage.get(page) ?? new Set<string>();
    onPage.set(page, here);
    let alive = true;
    adsApi
      .slot(slot, { device: dev, category, exclude: [...new Set([...reachedCap(), ...here])] })
      .then((r) => {
        if (!alive) return;
        if (r.ad) {
          here.add(r.ad.campaignId);
          countSeen(r.ad);
        }
        setState({ ad: r.ad, promo: r.housePromo });
      })
      .catch(() => alive && setState({ ad: null, promo: true }));
    return () => {
      alive = false;
    };
  }, [slot, category, minWidth]);

  const onView = useCallback((token: string) => void adsApi.view(token), []);
  useAdView(box, state?.ad?.token ?? null, onView);

  if (!state) return fallback === 'promo' ? <div className={`min-h-[250px] ${className}`} aria-hidden="true" /> : null;
  const { ad } = state;
  if (!ad) return fallback === 'promo' && state.promo ? <HousePromo /> : null;

  return (
    <aside ref={box} aria-label={AD_LABEL} className={className}>
      <Label sponsor={ad.sponsor} />
      {ad.action === 'link' && ad.href ? (
        <a href={ad.href} target="_blank" rel="sponsored noopener" aria-label={`${AD_LABEL}: ${ad.headline || ad.image.alt || ad.sponsor}${NEW_WINDOW}`} className="block">
          <AdBody ad={ad} device={device} />
        </a>
      ) : (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => {
            if (!open) void adsApi.view(ad.token, 'open');
            setOpen(true);
          }}
          className="block w-full cursor-pointer"
        >
          <AdBody ad={ad} device={device} />
        </button>
      )}
      {open && ad.lead ? <LeadForm ad={ad} onClose={() => setOpen(false)} /> : null}
    </aside>
  );
}
