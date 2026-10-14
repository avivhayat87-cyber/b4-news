'use client';
// The link in the confirmation mail: confirms, then goes straight on to "העיתון שלי"
// (topics and time), with the same key every issue's "change" link carries.
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { DigestForm } from '@/components/digest-form';
import { ApiFailure, newsletterApi } from '@/lib/client-api';

type State = { kind: 'working' } | { kind: 'done'; id: string; key: string } | { kind: 'failed'; message: string };

export function ConfirmNewsletter({ token }: { token: string }) {
  const [state, setState] = useState<State>({ kind: 'working' });

  useEffect(() => {
    if (!token) {
      setState({ kind: 'failed', message: 'הקישור חסר. פתחו אותו שוב מתוך המייל.' });
      return;
    }
    newsletterApi
      .confirm(token)
      .then((r) => setState({ kind: 'done', id: r.id, key: r.token }))
      .catch((err) => setState({ kind: 'failed', message: err instanceof ApiFailure ? err.message : 'משהו השתבש. נסו שוב.' }));
  }, [token]);

  const id = state.kind === 'done' ? state.id : '';
  const key = state.kind === 'done' ? state.key : '';
  const load = useCallback(() => newsletterApi.prefs(id, key), [id, key]);
  const save = useCallback((p: Parameters<typeof newsletterApi.savePrefs>[2]) => newsletterApi.savePrefs(id, key, p), [id, key]);

  if (state.kind === 'done') {
    return (
      <div className="flex flex-col gap-6">
        <div role="status">
          <h1 className="text-[32px] font-extrabold leading-tight">נרשמת! עכשיו נתאים לך את העיתון</h1>
          <p className="mt-2 text-lg text-ink-2">בחרו מה מעניין אותך ומתי נוח לך לקרוא. אפשר לשנות בכל רגע מהקישור שבכל גיליון.</p>
        </div>
        <DigestForm load={load} save={save} />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-4" role="status">
      <h1 className="text-[32px] font-extrabold leading-tight">{state.kind === 'working' ? 'מאשרים את ההרשמה…' : 'לא הצלחנו לאשר'}</h1>
      <p className="text-lg text-ink-2">{state.kind === 'failed' ? state.message : 'רק רגע.'}</p>
      {state.kind === 'failed' ? (
        <Link href="/" className="inline-flex h-12 items-center rounded-full bg-brand px-6 font-extrabold text-white hover:bg-brand-deep">
          לדף הבית
        </Link>
      ) : null}
    </div>
  );
}
