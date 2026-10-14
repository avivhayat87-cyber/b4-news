'use client';

import { type DigestPrefs, DisplayName, type ReaderPrefs } from '@b4/shared';
import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { SignIn } from '@/components/comments';
import { DigestForm } from '@/components/digest-form';
import { ApiFailure, readerApi } from '@/lib/client-api';
import type { ReaderDto } from '@/lib/types';

type State = { kind: 'loading' } | { kind: 'anonymous' } | { kind: 'signed-in'; reader: ReaderDto } | { kind: 'deleted' };

const message = (err: unknown) => (err instanceof ApiFailure ? err.message : 'משהו השתבש. נסו שוב.');
const button = 'inline-flex h-11 items-center rounded-full px-5 text-[15px] font-extrabold disabled:opacity-50';

export function AccountPanel() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    readerApi
      .me()
      .then((reader) => setState(reader ? { kind: 'signed-in', reader } : { kind: 'anonymous' }))
      .catch(() => setState({ kind: 'anonymous' }));
  }, []);

  if (state.kind === 'loading') return <p className="text-ink-2">טוען…</p>;
  if (state.kind === 'deleted') {
    return (
      <div role="status" className="flex flex-col items-start gap-4">
        <h2 className="text-2xl font-extrabold">החשבון נמחק</h2>
        <p className="text-lg text-ink-2">מחקנו את פרטי החשבון ואת התגובות שלך. תודה שקראת אותנו.</p>
        <Link href="/" className={`${button} bg-brand text-white hover:bg-brand-deep`}>
          לדף הבית
        </Link>
      </div>
    );
  }
  if (state.kind === 'anonymous') {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-lg text-ink-2">כדי לנהל את החשבון, להחליף את שם התצוגה או למחוק את החשבון, התחברו עם קוד חד-פעמי למייל.</p>
        <SignIn title="התחברות לחשבון" onSignedIn={(reader) => setState({ kind: 'signed-in', reader })} />
      </div>
    );
  }
  return <SignedIn reader={state.reader} onChange={(reader) => setState({ kind: 'signed-in', reader })} onGone={(kind) => setState({ kind })} />;
}

/** "העיתון שלי": the topics (also the reader's feed), the hour, mail and/or phone. Off until turned on. */
function MyPaper() {
  const load = useCallback(() => readerApi.digest(), []);
  const save = useCallback((p: DigestPrefs) => readerApi.saveDigest(p), []);
  return <DigestForm load={load} save={save} allowPush intro="כתבות מהתחומים שלך, בשעה שבחרת. התחומים קובעים גם מה יופיע ב&quot;הפיד שלי&quot;." />;
}

/** How the reader hears about replies, likes and the editors' pick (the bell on the site is always on). */
function NotificationPrefs() {
  const [prefs, setPrefs] = useState<ReaderPrefs | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => {
    readerApi.prefs().then(setPrefs).catch(() => undefined);
  }, []);
  if (!prefs) return null;
  const save = async (next: ReaderPrefs) => {
    setPrefs(next);
    try {
      setPrefs(await readerApi.savePrefs(next));
      setStatus('נשמר.');
    } catch (err) {
      setStatus(message(err));
    }
  };
  return (
    <section id="notifications" aria-labelledby="acc-notify" className="flex flex-col gap-3 rounded-xl border border-line p-5">
      <h2 id="acc-notify" className="text-xl font-extrabold">
        התראות על התגובות שלך
      </h2>
      <p className="text-[16px] text-ink-2">כשמגיבים לך, אוהבים תגובה שלך או בוחרים אותה ל&quot;בחירת העורכים&quot;. באתר זה תמיד מופיע בפעמון למעלה.</p>
      <label className="flex items-start gap-3 text-[16px]">
        <input type="checkbox" className="mt-1 size-5" checked={prefs.notifyEmail} onChange={(e) => void save({ ...prefs, notifyEmail: e.target.checked })} />
        <span>
          <span className="font-bold">במייל</span>
          <span className="block text-sm text-ink-2">מייל אחד שמרכז הכל, לכל היותר פעם בשעה, ורק על מה שעוד לא ראית.</span>
        </span>
      </label>
      <label className="flex items-start gap-3 text-[16px]">
        <input type="checkbox" className="mt-1 size-5" checked={prefs.notifyPush} onChange={(e) => void save({ ...prefs, notifyPush: e.target.checked })} />
        <span>
          <span className="font-bold">התראה בטלפון</span>
          <span className="block text-sm text-ink-2">באפליקציה, כשמחוברים בה לחשבון.</span>
        </span>
      </label>
      {status ? (
        <p role="status" className="text-sm text-ink-2">
          {status}
        </p>
      ) : null}
    </section>
  );
}

function SignedIn({ reader, onChange, onGone }:{ reader: ReaderDto; onChange: (r: ReaderDto) => void; onGone: (kind: 'anonymous' | 'deleted') => void }) {
  const [name, setName] = useState(reader.displayName);
  const [nameStatus, setNameStatus] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rename = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = DisplayName.safeParse(name);
    if (!parsed.success) {
      setNameStatus(parsed.error.issues[0]?.message ?? 'השם לא תקין');
      return;
    }
    try {
      onChange(await readerApi.rename(parsed.data));
      setNameStatus('השם עודכן.');
    } catch (err) {
      setNameStatus(message(err));
    }
  };

  const signOut = async () => {
    await readerApi.logout().catch(() => undefined);
    onGone('anonymous');
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await readerApi.deleteAccount();
      onGone('deleted');
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="acc-details" className="flex flex-col gap-4 rounded-xl border border-line p-5">
        <h2 id="acc-details" className="text-xl font-extrabold">
          הפרטים שלך
        </h2>
        <dl className="grid gap-2 text-[16px]">
          <div className="flex flex-wrap gap-2">
            <dt className="font-bold">מייל:</dt>
            <dd dir="ltr">{reader.email}</dd>
          </div>
          <div className="flex flex-wrap gap-2">
            <dt className="font-bold">תנאי השימוש:</dt>
            <dd>{reader.termsAccepted ? 'אישרת את הגרסה העדכנית' : 'עודכנו מאז שאישרת. תתבקש/י לאשר לפני התגובה הבאה.'}</dd>
          </div>
        </dl>
        <form onSubmit={rename} className="flex flex-col gap-2">
          <label htmlFor="acc-name" className="text-sm font-bold">
            שם התצוגה ליד התגובות
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id="acc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              className="h-11 min-w-0 flex-[1_1_220px] rounded-full border-[1.5px] border-line bg-white px-4 focus:border-ink focus:outline-none"
            />
            <button type="submit" disabled={name.trim() === reader.displayName} className={`${button} bg-ink text-white hover:bg-black`}>
              שמירת השם
            </button>
          </div>
          {nameStatus ? (
            <p role="status" className="text-sm text-ink-2">
              {nameStatus}
            </p>
          ) : null}
        </form>
        <button type="button" onClick={signOut} className="self-start text-[15px] font-bold text-brand underline-offset-2 hover:underline">
          התנתקות
        </button>
      </section>

      <section id="my-paper" aria-labelledby="acc-paper" className="flex flex-col gap-3 rounded-xl border border-line p-5">
        <h2 id="acc-paper" className="text-xl font-extrabold">
          העיתון שלי
        </h2>
        <MyPaper />
      </section>

      <NotificationPrefs />

      <section aria-labelledby="acc-delete" className="flex flex-col gap-3 rounded-xl border-2 border-brand/40 p-5">
        <h2 id="acc-delete" className="text-xl font-extrabold">
          מחיקת החשבון
        </h2>
        <p className="text-[16px] text-ink-2">
          המחיקה סופית: נמחק את המייל, שם התצוגה, כל התגובות שכתבת (והתגובות להן), הדיווחים ששלחת ורישומי ההתחברות. ההרשמה לניוזלטר נפרדת, ואפשר להסיר אותה בקישור שבכל דיוור.
        </p>
        {confirming ? (
          <div className="flex flex-col gap-3 rounded-lg bg-brand-soft p-4" role="alert">
            <p className="font-bold text-brand-deep">למחוק את החשבון לצמיתות? אי אפשר לבטל את זה.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={remove} disabled={busy} className={`${button} bg-brand text-white hover:bg-brand-deep`}>
                {busy ? 'מוחק…' : 'כן, למחוק את החשבון'}
              </button>
              <button type="button" onClick={() => setConfirming(false)} disabled={busy} className={`${button} border-2 border-ink text-ink hover:bg-ink hover:text-white`}>
                ביטול
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} className={`${button} self-start border-2 border-brand text-brand hover:bg-brand hover:text-white`}>
            מחיקת החשבון
          </button>
        )}
        {error ? (
          <p role="alert" className="text-sm font-semibold text-brand-deep">
            {error}
          </p>
        ) : null}
      </section>
    </div>
  );
}
