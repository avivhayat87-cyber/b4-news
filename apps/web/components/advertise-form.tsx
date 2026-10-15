'use client';
// "Advertise with us": a business leaves its details, the newsroom gets an email and sees the
// inquiry in the CMS ("פרסום" > "לידים ופניות"). Consent to be contacted is asked explicitly.
import { AD_INQUIRY_CONSENT } from '@b4/shared';
import { useState, type FormEvent } from 'react';
import { ApiFailure, adsApi } from '@/lib/client-api';

const INPUT = 'mt-1 block w-full rounded-md border border-line bg-white px-3 py-2.5 text-[16px] focus:border-ink focus:outline-none';

export function AdvertiseForm() {
  const [f, setF] = useState({ name: '', company: '', phone: '', email: '', message: '' });
  const [consent, setConsent] = useState(false);
  const [trap, setTrap] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setState('busy');
    setError(null);
    try {
      await adsApi.inquiry({ ...f, consent: consent as true, ...(trap ? { website: trap } : {}) });
      setState('done');
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : 'השליחה נכשלה. נסו שוב.');
      setState('idle');
    }
  }

  if (state === 'done') {
    return (
      <p role="status" className="mt-8 rounded-[10px] bg-stone p-5 text-[17px] font-bold">
        תודה! קיבלנו את הפרטים, ונחזור אליכם בהקדם.
      </p>
    );
  }
  const field = (k: keyof typeof f, label: string, opts: { type?: string; required?: boolean; ltr?: boolean; auto?: string } = {}) => (
    <label className="block text-[15px] font-bold">
      {label}
      <input type={opts.type ?? 'text'} required={opts.required} dir={opts.ltr ? 'ltr' : undefined} autoComplete={opts.auto} maxLength={k === 'email' ? 254 : 120} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} className={INPUT} />
    </label>
  );
  return (
    <form onSubmit={submit} className="mt-8 space-y-4 rounded-[10px] border border-line p-5" aria-labelledby="advertise-form-title">
      <h2 id="advertise-form-title" className="text-[22px] font-extrabold">
        השאירו פרטים ונחזור אליכם
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {field('name', 'שם', { required: true, auto: 'name' })}
        {field('company', 'העסק', { auto: 'organization' })}
        {field('phone', 'טלפון', { type: 'tel', ltr: true, auto: 'tel' })}
        {field('email', 'אימייל', { type: 'email', required: true, ltr: true, auto: 'email' })}
      </div>
      <label className="block text-[15px] font-bold">
        במה מדובר (לא חובה)
        <textarea rows={4} maxLength={2000} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} className={INPUT} />
      </label>
      {/* Left empty by people; bots fill it. */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" value={trap} onChange={(e) => setTrap(e.target.value)} className="hidden" />
      <label className="flex items-start gap-2 text-[15px]">
        <input type="checkbox" required checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />
        <span>{AD_INQUIRY_CONSENT}</span>
      </label>
      {error ? (
        <p role="alert" className="font-bold text-brand-deep">
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={state === 'busy'} className="inline-flex h-12 items-center rounded-full bg-ink px-8 font-extrabold text-white hover:bg-brand disabled:opacity-60">
        {state === 'busy' ? 'שולח…' : 'שליחה'}
      </button>
    </form>
  );
}
