'use client';
// "Advertise with us": a business leaves a name and a phone (the rest is optional), what it is
// interested in and a few words about itself. The inquiry lands in the CMS ("פרסום" > "פניות
// מפרסמים") and every admin gets an email. Consent to be contacted is asked explicitly. A reader who
// came from a section's banner has that section filled in.
import { AD_INQUIRY_CONSENT, AD_INQUIRY_INTEREST_LABELS, AD_INQUIRY_INTERESTS, CATEGORIES, type AdInquiryInterest } from '@b4/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiFailure, adsApi } from '@/lib/client-api';

const INPUT = 'mt-1.5 block w-full rounded-[8px] border border-line bg-white px-3.5 py-3 text-[16px] focus:border-ink focus:outline-none';
const LABEL = 'block text-[15px] font-bold';

export function AdvertiseForm() {
  const [f, setF] = useState({ name: '', phone: '', email: '', company: '', message: '' });
  const [interests, setInterests] = useState<AdInquiryInterest[]>([]);
  const [section, setSection] = useState<(typeof CATEGORIES)[number] | null>(null);
  const [consent, setConsent] = useState(false);
  const [trap, setTrap] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const slug = new URLSearchParams(window.location.search).get('section');
    const found = CATEGORIES.find((c) => c.slug === slug) ?? null;
    if (found) {
      setSection(found);
      setInterests(['section']);
    }
  }, []);

  const toggle = (i: AdInquiryInterest) => setInterests((list) => (list.includes(i) ? list.filter((x) => x !== i) : [...list, i]));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setState('busy');
    setError(null);
    try {
      await adsApi.inquiry({ ...f, interests, ...(section ? { section: section.slug } : {}), consent: consent as true, ...(trap ? { website: trap } : {}) });
      setState('done');
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : 'השליחה נכשלה. נסו שוב.');
      setState('idle');
    }
  }

  if (state === 'done') {
    return (
      <div role="status" className="flex flex-col items-start gap-3 rounded-[14px] bg-stone p-8">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand text-2xl text-white" aria-hidden="true">
          ✓
        </span>
        <p className="font-display text-[26px] font-extrabold">תודה, קיבלנו!</p>
        <p className="text-[17px] leading-relaxed text-ink-2">הפרטים הגיעו לצוות הפרסום שלנו, ונחזור אליכם בהקדם עם הצעה שמתאימה לכם.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5" aria-label="השארת פרטים לפרסום">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={LABEL}>
          שם מלא <span className="text-brand">*</span>
          <input required autoComplete="name" maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={INPUT} />
        </label>
        <label className={LABEL}>
          טלפון <span className="text-brand">*</span>
          <input required type="tel" dir="ltr" autoComplete="tel" maxLength={20} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} className={`${INPUT} text-right`} />
        </label>
        <label className={LABEL}>
          אימייל <span className="font-normal text-muted">(לא חובה)</span>
          <input type="email" dir="ltr" autoComplete="email" maxLength={254} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} className={`${INPUT} text-right`} />
        </label>
        <label className={LABEL}>
          שם העסק <span className="font-normal text-muted">(לא חובה)</span>
          <input autoComplete="organization" maxLength={120} value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} className={INPUT} />
        </label>
      </div>

      <fieldset>
        <legend className={LABEL}>
          מה מעניין אתכם? <span className="font-normal text-muted">(אפשר לבחור כמה)</span>
        </legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {AD_INQUIRY_INTERESTS.map((i) => (
            <button
              key={i}
              type="button"
              aria-pressed={interests.includes(i)}
              onClick={() => toggle(i)}
              className={`rounded-full px-4 py-2 text-[15px] font-bold ring-1 transition-colors ${interests.includes(i) ? 'bg-ink text-white ring-ink' : 'bg-white text-ink-2 ring-line hover:ring-ink'}`}
            >
              {AD_INQUIRY_INTEREST_LABELS[i]}
              {i === 'section' && section ? `: ${section.name}` : ''}
            </button>
          ))}
        </div>
      </fieldset>

      <label className={LABEL}>
        ספרו לנו על העסק <span className="font-normal text-muted">(לא חובה)</span>
        <textarea
          rows={4}
          maxLength={2000}
          value={f.message}
          onChange={(e) => setF({ ...f, message: e.target.value })}
          placeholder="מה העסק עושה, למי הוא פונה, ומה הייתם רוצים שהפרסום ישיג"
          className={INPUT}
        />
      </label>

      {/* Left empty by people; bots fill it. */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" value={trap} onChange={(e) => setTrap(e.target.value)} className="hidden" />

      <label className="flex items-start gap-2.5 text-[15px] leading-relaxed">
        <input type="checkbox" required checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 h-4 w-4" />
        <span>{AD_INQUIRY_CONSENT}</span>
      </label>
      {error ? (
        <p role="alert" className="font-bold text-brand-deep">
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={state === 'busy'} className="inline-flex h-13 items-center rounded-full bg-brand px-10 py-3.5 text-[17px] font-extrabold text-white hover:bg-brand-deep disabled:opacity-60">
        {state === 'busy' ? 'שולח…' : 'שליחה, ונחזור אליכם'}
      </button>
    </form>
  );
}
