'use client';
// "התחברות בלחיצה": the token comes after "#" in the mailed link (a server never sees it), and this
// page sends it once. Mail scanners that open links don't run it, so they can't use the link up.
import { DisplayName } from '@b4/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { TermsCheckbox } from '@/components/terms-checkbox';
import { ApiFailure, readerApi } from '@/lib/client-api';

type State = { kind: 'working' } | { kind: 'name' } | { kind: 'terms' } | { kind: 'done'; name: string } | { kind: 'failed'; message: string };

const button = 'inline-flex h-11 items-center rounded-full px-5 text-[15px] font-extrabold disabled:opacity-50';

export function SignInLink() {
  const router = useRouter();
  const token = useRef<string | null>(null);
  const [state, setState] = useState<State>({ kind: 'working' });
  const [name, setName] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (opts: { displayName?: string; acceptTerms?: boolean } = {}) => {
    if (!token.current) return;
    setBusy(true);
    setError(null);
    try {
      const { reader, returnTo } = await readerApi.verifyLink(token.current, opts);
      setState({ kind: 'done', name: reader.displayName });
      setTimeout(() => router.replace(returnTo ?? '/'), 1200);
    } catch (err) {
      if (err instanceof ApiFailure && err.code === 'name_required') setState({ kind: 'name' });
      else if (err instanceof ApiFailure && err.code === 'terms_required') setState({ kind: 'terms' });
      else if (state.kind === 'working') setState({ kind: 'failed', message: err instanceof ApiFailure ? err.message : 'משהו השתבש. נסו שוב.' });
      else setError(err instanceof ApiFailure ? err.message : 'משהו השתבש. נסו שוב.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const t = new URLSearchParams(window.location.hash.slice(1)).get('t');
    // The link is used once; it doesn't stay in the address bar or the history.
    window.history.replaceState(null, '', window.location.pathname);
    if (!t) {
      setState({ kind: 'failed', message: 'הקישור לא שלם. אפשר לבקש קוד חדש.' });
      return;
    }
    token.current = t;
    void send();
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitName = (e: FormEvent) => {
    e.preventDefault();
    const parsed = DisplayName.safeParse(name);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'השם לא תקין');
      return;
    }
    // The terms box was ticked when the code was asked for (or on the terms step here).
    void send({ displayName: parsed.data, acceptTerms: accepted || undefined });
  };

  if (state.kind === 'working') return <p className="text-lg text-ink-2">מתחברים…</p>;
  if (state.kind === 'done') {
    return (
      <div role="status">
        <h1 className="text-3xl font-extrabold">ברוכים הבאים, {state.name}!</h1>
        <p className="mt-2 text-lg text-ink-2">התחברתם. מחזירים אתכם לכתבה…</p>
      </div>
    );
  }
  if (state.kind === 'failed') {
    return (
      <div className="flex flex-col items-start gap-4">
        <h1 className="text-3xl font-extrabold">לא הצלחנו לחבר אתכם</h1>
        <p className="text-lg text-ink-2">{state.message}</p>
        <Link href="/account" className={`${button} bg-ink text-white hover:bg-black`}>
          לקבלת קוד חדש
        </Link>
      </div>
    );
  }
  return (
    <div className="rounded-xl bg-stone p-6">
      {state.kind === 'name' ? (
        <form onSubmit={submitName} className="flex flex-col gap-4">
          <h1 className="text-2xl font-extrabold">עוד רגע בפנים</h1>
          <p className="text-ink-2">זו הפעם הראשונה שלכם כאן. בחרו שם שיופיע ליד התגובות.</p>
          <label htmlFor="signin-name" className="sr-only">
            שם תצוגה
          </label>
          <input
            id="signin-name"
            required
            minLength={2}
            maxLength={40}
            autoComplete="nickname"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="השם שיופיע ליד התגובות"
            className="h-11 rounded-full border-[1.5px] border-line bg-white px-4 focus:border-ink focus:outline-none"
          />
          <button type="submit" disabled={busy} className={`${button} self-start bg-brand text-white hover:bg-brand-deep`}>
            {busy ? 'רגע…' : 'סיום והתחברות'}
          </button>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send({ acceptTerms: true, displayName: name.trim() || undefined });
          }}
          className="flex flex-col gap-4"
        >
          <h1 className="text-2xl font-extrabold">התנאים עודכנו</h1>
          <p className="text-ink-2">כדי להמשיך, אשרו את הגרסה החדשה של תנאי השימוש ומדיניות הפרטיות.</p>
          <TermsCheckbox id="signin-terms" checked={accepted} onChange={setAccepted} />
          <button type="submit" disabled={busy || !accepted} className={`${button} self-start bg-brand text-white hover:bg-brand-deep`}>
            {busy ? 'רגע…' : 'אישור והתחברות'}
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm font-semibold text-brand-deep">
          {error}
        </p>
      )}
    </div>
  );
}
