'use client';

import { useState, type FormEvent } from 'react';

type State = 'idle' | 'sending' | 'done' | 'error';

export function NewsletterForm({ id, layout }: { id: string; layout: 'stacked' | 'inline' }) {
  const [state, setState] = useState<State>('idle');

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get('email') ?? '').trim();
    setState('sending');
    try {
      const res = await fetch('/api/newsletter', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      setState(res.ok ? 'done' : 'error');
    } catch {
      setState('error');
    }
  }

  if (state === 'done') {
    return (
      <p role="status" className="text-[15px] font-semibold text-white">
        כמעט סיימנו: שלחנו לך מייל עם קישור לאישור ההרשמה.
      </p>
    );
  }

  const input = (
    <input
      id={id}
      name="email"
      type="email"
      required
      autoComplete="email"
      placeholder="name@example.com"
      dir="ltr"
      className="h-11 min-w-0 flex-1 rounded-md border-[1.5px] border-night-line bg-[#1E1E22] px-3.5 text-right text-[15px] text-white placeholder:text-[#8C8C94] focus:border-white"
    />
  );
  const button = (
    <button
      type="submit"
      disabled={state === 'sending'}
      className="h-11 shrink-0 rounded-md bg-brand px-[18px] text-[15px] font-extrabold text-white hover:bg-brand-deep disabled:opacity-70"
    >
      {state === 'sending' ? 'שולח…' : 'הרשמה'}
    </button>
  );

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2.5">
      {layout === 'stacked' ? (
        <>
          <label htmlFor={id} className="text-[13px] font-semibold text-mist">
            כתובת מייל
          </label>
          {input}
          {button}
        </>
      ) : (
        <>
          <label htmlFor={id} className="sr-only">
            כתובת מייל
          </label>
          <div className="flex gap-2">
            {input}
            {button}
          </div>
        </>
      )}
      {state === 'error' ? (
        <p role="alert" className="text-sm text-[#FF8A91]">
          ההרשמה לא עברה. בדקו שהכתובת נכונה ונסו שוב.
        </p>
      ) : null}
    </form>
  );
}
