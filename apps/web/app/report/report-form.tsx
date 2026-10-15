'use client';

import { TAKEDOWN_KINDS, TAKEDOWN_KIND_LABELS, TAKEDOWN_RESPONSE_HOURS, type TakedownKind } from '@b4/shared';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { NewWindowHint } from '@/components/ui';
import { ApiFailure, takedownApi } from '@/lib/client-api';

const field = 'w-full rounded-xl border-[1.5px] border-line bg-white px-4 py-2.5 text-base focus:border-ink focus:outline-none';
const label = 'text-sm font-bold';

export function ReportForm({ url: initialUrl, commentId }: { url: string; commentId: string | null }) {
  const [kind, setKind] = useState<TakedownKind>('defamation');
  const [url, setUrl] = useState(initialUrl);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [details, setDetails] = useState('');
  const [website, setWebsite] = useState('');
  const [declaration, setDeclaration] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ reference: string } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await takedownApi.submit({ kind, url: url.trim(), commentId, name, email, details, declaration: true, website: website || undefined });
      setDone({ reference: res.reference });
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : 'השליחה נכשלה. נסו שוב.');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div role="status" className="flex flex-col items-start gap-3 rounded-xl bg-stone p-6">
        <h2 className="text-2xl font-extrabold">הפנייה התקבלה</h2>
        <p className="text-lg text-ink-2">
          מספר הפנייה: <strong className="font-mono text-ink">{done.reference}</strong>. שלחנו אישור למייל שלך. נבדוק את הבקשה ונעדכן אותך, ואנחנו משתדלים להשיב בתוך {TAKEDOWN_RESPONSE_HOURS} שעות.
        </p>
        <Link href="/" className="font-bold text-brand underline underline-offset-2">
          לדף הבית
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      {commentId ? <p className="rounded-lg bg-brand-soft px-4 py-2.5 text-[15px] font-semibold text-brand-deep">הבקשה נוגעת לתגובה מסוימת בכתבה. היא תצורף לפנייה.</p> : null}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="r-kind" className={label}>
          מה הבעיה?
        </label>
        <select id="r-kind" value={kind} onChange={(e) => setKind(e.target.value as TakedownKind)} className={field}>
          {TAKEDOWN_KINDS.map((k) => (
            <option key={k} value={k}>
              {TAKEDOWN_KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="r-url" className={label}>
          קישור לכתבה או לתוכן
        </label>
        <input id="r-url" type="url" required dir="ltr" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" className={`${field} text-right`} />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="r-name" className={label}>
            שם מלא
          </label>
          <input id="r-name" required autoComplete="name" minLength={2} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} className={field} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="r-email" className={label}>
            מייל לתשובה
          </label>
          <input id="r-email" type="email" required autoComplete="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} className={`${field} text-right`} />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="r-details" className={label}>
          פירוט
        </label>
        <textarea
          id="r-details"
          required
          minLength={20}
          maxLength={5000}
          rows={6}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          aria-describedby="r-details-hint"
          className={`${field} resize-y leading-relaxed`}
        />
        <p id="r-details-hint" className="text-xs text-muted">
          ציטוט של הקטע הבעייתי והסבר קצר למה הוא פוגע בך או מפר זכות שלך.
        </p>
      </div>
      {/* Honeypot: hidden from people and screen readers. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="r-website">אתר</label>
        <input id="r-website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </div>
      <div className="flex items-start gap-2.5 text-[15px] text-ink-2">
        <input
          id="r-declaration"
          type="checkbox"
          required
          checked={declaration}
          onChange={(e) => setDeclaration(e.target.checked)}
          className="mt-0.5 h-[18px] w-[18px] shrink-0 accent-brand"
        />
        <label htmlFor="r-declaration">
          הפרטים שמסרתי נכונים, ואני מסכים/ה ששמי ופרטי הפנייה יישמרו לצורך הטיפול בה, לפי{' '}
          <Link href="/privacy" target="_blank" className="font-bold text-brand underline underline-offset-2">
            מדיניות הפרטיות
            <NewWindowHint />
          </Link>
          .
        </label>
      </div>
      <button type="submit" disabled={busy || !declaration} className="h-12 self-start rounded-full bg-brand px-7 font-extrabold text-white hover:bg-brand-deep disabled:opacity-50">
        {busy ? 'שולח…' : 'שליחת הבקשה'}
      </button>
      {error ? (
        <p role="alert" className="font-semibold text-brand-deep">
          {error}
        </p>
      ) : null}
    </form>
  );
}
