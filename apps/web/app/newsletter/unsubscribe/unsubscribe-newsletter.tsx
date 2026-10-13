'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ApiFailure, newsletterApi } from '@/lib/client-api';

type State = { kind: 'idle' } | { kind: 'working' } | { kind: 'done' } | { kind: 'failed'; message: string };

/** A button, not an automatic request: mail scanners open links, people press buttons. */
export function UnsubscribeNewsletter({ id, token }: { id: string; token: string }) {
  const [state, setState] = useState<State>(id && token ? { kind: 'idle' } : { kind: 'failed', message: 'הקישור חסר. פתחו אותו שוב מתוך המייל.' });

  const run = () => {
    setState({ kind: 'working' });
    newsletterApi
      .unsubscribe(id, token)
      .then(() => setState({ kind: 'done' }))
      .catch((err) => setState({ kind: 'failed', message: err instanceof ApiFailure ? err.message : 'משהו השתבש. נסו שוב.' }));
  };

  return (
    <div className="flex flex-col items-start gap-4">
      <h1 className="text-[32px] font-extrabold leading-tight">{state.kind === 'done' ? 'הוסרת מהניוזלטר' : 'הסרה מהניוזלטר'}</h1>
      <p role="status" className="text-lg text-ink-2">
        {state.kind === 'done'
          ? 'לא נשלח אליך יותר את הניוזלטר. אפשר להירשם מחדש בכל עת בתחתית האתר.'
          : state.kind === 'failed'
            ? state.message
            : 'לחצו על הכפתור כדי להפסיק לקבל את הניוזלטר של B4 NEW\'S.'}
      </p>
      {state.kind === 'idle' || state.kind === 'working' ? (
        <button
          type="button"
          onClick={run}
          disabled={state.kind === 'working'}
          className="inline-flex h-12 items-center rounded-full bg-brand px-6 font-extrabold text-white hover:bg-brand-deep disabled:opacity-60"
        >
          {state.kind === 'working' ? 'מסיר…' : 'הסירו אותי מהניוזלטר'}
        </button>
      ) : (
        <Link href="/" className="inline-flex h-12 items-center rounded-full border-2 border-ink px-6 font-extrabold hover:bg-ink hover:text-white">
          לדף הבית
        </Link>
      )}
    </div>
  );
}
