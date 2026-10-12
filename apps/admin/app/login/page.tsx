'use client';
import type { StaffDto } from '@b4/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { Button, Field, inputClass } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';

/** Only same-app paths: "?next=https://evil.example" must not redirect away. */
function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/';
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const me = await api.post<StaffDto>('/auth/staff/login', { email, password });
      qc.setQueryData(['me'], me);
      router.replace(safeNext(params.get('next')));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field label="מייל" htmlFor="email">
        <input id="email" type="email" dir="ltr" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
      </Field>
      <Field label="סיסמה" htmlFor="password">
        <input id="password" type="password" dir="ltr" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
      </Field>
      {error && (
        <p role="alert" className="rounded-lg bg-brand-soft px-3 py-2 text-sm font-semibold text-brand-deep">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" busy={busy} className="w-full">
        כניסה
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-stone px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm ring-1 ring-line">
        {/* eslint-disable-next-line @next/next/no-img-element -- static SVG logo */}
        <img src="/brand/b4-logo.svg" alt="B4 NEW'S" width={180} height={67} className="mx-auto" />
        <h1 className="mt-5 text-center text-xl font-extrabold">מערכת ניהול</h1>
        <p className="mb-6 mt-1 text-center text-sm text-muted">כניסה לעורכים ולמפתחים</p>
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
