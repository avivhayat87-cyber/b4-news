'use client';
// One ad place on the site. It asks for its rotation when the page shows (never cached), labels
// every ad "פרסומת" with the advertiser's name, counts a view only when it was really seen, and
// opens a short lead form in place when the ad asks for one. How often this reader saw each
// campaign today is counted here in the browser (no cookie, nothing sent about the reader), and
// two places on one page never show the same campaign at once. An outage leaves the place empty,
// never the page.
import { AD_LABEL, AD_LEAD_FIELD_LABELS, AD_SIZES, AD_SLOT_FORMATS, AD_SLOT_NAMES, adSize, type AdLeadField, type AdSlot as Slot, type PublicAd, type PublicAdSlot } from '@b4/shared';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ApiFailure, adsApi } from '@/lib/client-api';
import { CONSENT_CHANGED_EVENT, adsConsented } from './consent-banner';
import { GoogleAd } from './google-ad';
import { HouseBillboard, HousePromo, NEW_WINDOW } from './ui';
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

/** What each place on the page shows right now: one campaign is never in two places at once. */
const showing = new Map<string, string>();
const shownElsewhere = (place: string, campaignId: string) => [...showing].some(([p, c]) => p !== place && c === campaignId);

/** One position of a place's rotation: an ad (first: the server counted it when it answered), or our promo (null). */
type Entry = { ad: PublicAd; first: boolean } | null;

/** The next position to show from `from` on: our promo, or an ad this reader may still see that no other place shows now. */
function nextShowable(entries: Entry[], from: number, place: string): number {
  const capped = new Set(reachedCap());
  for (let k = 0; k < entries.length; k++) {
    const i = (from + k) % entries.length;
    const e = entries[i];
    if (e === null || e === undefined || (!capped.has(e.ad.campaignId) && !shownElsewhere(place, e.ad.campaignId))) return i;
  }
  return -1;
}

const reducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

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

const SPOTS_KEY = 'b4_adspots';
const FORMAT_SIZE: Record<string, string> = { billboard: `באנר רחב ${adSize(970, 90)} · בנייד ${adSize(320, 50)}`, rectangle: `מלבן ${adSize(300, 250)}`, native: 'מודעה בסגנון כתבה' };

/**
 * "?adspots=1" on any page (the CMS links to it) shows every ad place as a labeled frame, for the
 * rest of the visit in that tab, so the newsroom sees where ads go before any campaign runs;
 * "?adspots=0" ends it. It only draws frames: nothing is asked of the server or counted.
 */
function spotPreview(): boolean {
  try {
    const q = new URLSearchParams(window.location.search).get('adspots');
    if (q === '1') sessionStorage.setItem(SPOTS_KEY, '1');
    if (q === '0') sessionStorage.removeItem(SPOTS_KEY);
    return sessionStorage.getItem(SPOTS_KEY) === '1';
  } catch {
    return false;
  }
}

function SpotFrame({ slot }: { slot: Slot }) {
  const height = AD_SLOT_FORMATS[slot].includes('billboard') ? 90 : 250;
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-[10px] border-2 border-dashed border-brand bg-brand-soft/60 p-4 text-center" style={{ minHeight: height }}>
      <span className="text-xs font-bold tracking-[.06em] text-brand-deep">מקום פרסום</span>
      <span className="font-display text-xl font-extrabold">{AD_SLOT_NAMES[slot]}</span>
      <span className="text-sm text-ink-2">{AD_SLOT_FORMATS[slot].map((f) => FORMAT_SIZE[f]).join(' · ')}</span>
      <a href="?adspots=0" className="mt-1 text-xs font-bold text-ink-2 underline underline-offset-2">
        יציאה מתצוגת המקומות
      </a>
    </div>
  );
}

/**
 * fallback "promo": an empty side place shows "advertise with B4"; "billboard": an empty wide place
 * shows the house banner (in the section's words when sectionName is given); both when the CMS
 * allows it, and both stand in the rotation for its unsold positions. minWidth: a place that
 * exists only on wide screens (beside an article) asks for nothing on a phone.
 *
 * A place shares its rotation among the campaigns that bought it: the next one comes every few
 * seconds (the CMS sets how many), only while the place is on the screen and the tab is visible,
 * never while the reader points at it, works in it or has its form open, and never for a reader
 * who asked for less motion (they see one per page view).
 */
export function AdSlot({
  slot,
  category,
  sectionName,
  fallback = 'none',
  minWidth = 0,
  className = '',
}: {
  slot: Slot;
  category?: string;
  sectionName?: string;
  fallback?: 'promo' | 'billboard' | 'none';
  minWidth?: number;
  className?: string;
}) {
  const place = useId();
  const [state, setState] = useState<{ entries: Entry[]; rotateSeconds: number; promo: boolean; preview?: boolean; google?: PublicAdSlot['google'] } | null>(null);
  // The position shown (-1: nothing showable), and how many times the place changed (each is a new showing).
  const [view, setView] = useState({ at: -1, turn: 0 });
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [open, setOpen] = useState(false);
  const [held, setHeld] = useState(false);
  const [onScreen, setOnScreen] = useState(false);
  const [tabVisible, setTabVisible] = useState(true);
  const [consented, setConsented] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const counted = useRef(-1);

  // Google only for a reader who agreed to advertising cookies, rechecked the moment they answer the banner.
  const google = state?.google ?? null;
  useEffect(() => {
    if (!google) return;
    const check = () => setConsented(adsConsented(google.consentVersion));
    check();
    window.addEventListener(CONSENT_CHANGED_EVENT, check);
    return () => window.removeEventListener(CONSENT_CHANGED_EVENT, check);
  }, [google]);

  useEffect(() => {
    if (window.innerWidth < minWidth) {
      setState({ entries: [], rotateSeconds: 0, promo: false });
      return;
    }
    if (spotPreview()) {
      setState({ entries: [], rotateSeconds: 0, promo: false, preview: true });
      return;
    }
    const dev = window.matchMedia('(max-width: 767px)').matches ? 'mobile' : 'desktop';
    setDevice(dev);
    let alive = true;
    adsApi
      .slot(slot, { device: dev, category, exclude: reachedCap() })
      .then((r) => {
        if (!alive) return;
        const rotation = r.rotation ?? (r.ad ? [r.ad] : []);
        // An unsold position shows our promo; a place without one shows only what was sold.
        const ownPromo = r.housePromo && fallback !== 'none';
        const entries: Entry[] = rotation.flatMap((ad, i) => (ad ? [{ ad, first: i === 0 }] : ownPromo ? [null] : []));
        setState({ entries, rotateSeconds: reducedMotion() ? 0 : r.rotateSeconds, promo: r.housePromo, google: r.google });
        setView({ at: nextShowable(entries, 0, place), turn: 0 });
      })
      .catch(() => alive && setState({ entries: [], rotateSeconds: 0, promo: true }));
    return () => {
      alive = false;
      showing.delete(place);
    };
  }, [slot, category, minWidth, fallback, place]);

  const entries = state?.entries ?? [];
  const current = view.at >= 0 ? entries[view.at] : undefined;
  const ad = current?.ad ?? null;

  // Each showing: this place now shows that campaign, the reader's daily count goes up, and a
  // showing the server didn't count when it answered is reported.
  useEffect(() => {
    if (current === undefined || counted.current === view.turn) return;
    counted.current = view.turn;
    if (!current) {
      showing.delete(place);
      return;
    }
    showing.set(place, current.ad.campaignId);
    countSeen(current.ad);
    if (!(current.first && view.turn === 0)) void adsApi.view(current.ad.token, 'shown');
  }, [current, view.turn, place]);

  // On the screen, in a visible tab: only then does the rotation move.
  const hasEntries = entries.length > 0;
  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([e]) => setOnScreen(Boolean(e?.isIntersecting)), { threshold: 0.5 });
    observer.observe(el);
    const onVisibility = () => setTabVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [hasEntries]);

  const rotates = Boolean(state && state.rotateSeconds > 0 && new Set(entries.map((e) => e?.ad.token ?? 'promo')).size > 1);
  useEffect(() => {
    if (!rotates || !state || !onScreen || !tabVisible || held || open || view.at < 0) return;
    const timer = setTimeout(() => setView((v) => ({ at: nextShowable(entries, v.at + 1, place), turn: v.turn + 1 })), state.rotateSeconds * 1000);
    return () => clearTimeout(timer);
  }, [rotates, state, entries, onScreen, tabVisible, held, open, view.at, view.turn, place]);

  const onView = useCallback((token: string) => void adsApi.view(token), []);
  useAdView(box, ad?.token ?? null, onView);

  if (!state) return fallback === 'promo' ? <div className={`min-h-[250px] ${className}`} aria-hidden="true" /> : null;
  if (state.preview)
    return (
      <div className={className}>
        <SpotFrame slot={slot} />
      </div>
    );
  if (!hasEntries && google && consented) {
    // Google's unit, in a place no campaign of ours takes; when Google has nothing for it, the place (label and all) folds away.
    return (
      <aside aria-label={AD_LABEL} className={`has-[ins[data-ad-status=unfilled]]:hidden ${className}`}>
        <Label sponsor="" />
        <GoogleAd client={google.client} unit={google.unit} wide={AD_SLOT_FORMATS[slot].includes('billboard')} />
      </aside>
    );
  }
  const promo =
    state.promo && fallback !== 'none' ? fallback === 'promo' ? <HousePromo /> : <HouseBillboard section={category && sectionName ? { slug: category, name: sectionName } : undefined} /> : null;
  if (!hasEntries) return promo ? <div className={className}>{promo}</div> : null;

  return (
    <div
      ref={box}
      className={className}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocusCapture={() => setHeld(true)}
      onBlurCapture={() => setHeld(false)}
    >
      <div key={view.turn} className={view.turn > 0 ? 'motion-safe:animate-ad-in' : undefined}>
        {!ad ? (
          promo
        ) : (
          <aside aria-label={AD_LABEL}>
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
        )}
      </div>
    </div>
  );
}
