'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ApiFailure, newsletterApi } from '@/lib/client-api';

type State = { kind: 'working' } | { kind: 'done' } | { kind: 'failed'; message: string };

export function ConfirmNewsletter({ token }: { token: string }) {
  const [state, setState] = useState<State>({ kind: 'working' });

  useEffect(() => {
    if (!token) {
      setState({ kind: 'failed', message: 'הקישור חסר. פתחו אותו שוב מתוך המייל.' });
      return;
    }
    newsletterApi
      .confirm(token)
      .then(() => setState({ kind: 'done' }))
      .catch((err) => setState({ kind: 'failed', message: err instanceof ApiFailure ? err.message : 'משהו השתבש. נסו שוב.' }));
  }, [token]);

  return (
    <div className="flex flex-col items-start gap-4" role="status">
      <h1 className="text-[32px] font-extrabold leading-tight">
        {state.kind === 'working' ? 'מאשרים את ההרשמה…' : state.kind === 'done' ? 'נרשמת לניוזלטר' : 'לא הצלחנו לאשר'}
      </h1>
      <p className="text-lg text-ink-2">
        {state.kind === 'done'
          ? 'מעכשיו הכתבות החשובות של היום יגיעו אליך במייל, פעם ביום.'
          : state.kind === 'failed'
            ? state.message
            : 'רק רגע.'}
      </p>
      {state.kind !== 'working' ? (
        <Link href="/" className="inline-flex h-12 items-center rounded-full bg-brand px-6 font-extrabold text-white hover:bg-brand-deep">
          לדף הבית
        </Link>
      ) : null}
    </div>
  );
}
