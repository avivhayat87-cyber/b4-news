'use client';
// Staff sign-in: the password, then (when it is on, or required) the code from the
// authenticator app; someone without the app set up yet scans the QR code here first.
import type { StaffDto, StaffLoginResult, StaffTwoFactorResult, TwoFactorSetupDto } from '@b4/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { QrSetup, RecoveryCodes } from '@/components/settings/two-factor';
import { Button, Field, inputClass } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';

/** Only same-app paths: "?next=https://evil.example" must not redirect away. */
function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/';
}

type Step = { kind: 'password' } | { kind: 'code'; challenge: string } | { kind: 'setup'; challenge: string; setup: TwoFactorSetupDto | null } | { kind: 'codes'; codes: string[]; me: StaffDto };

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>({ kind: 'password' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const enter = (me: StaffDto) => {
    qc.setQueryData(['me'], me);
    router.replace(safeNext(params.get('next')));
  };

  const attempt = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err));
      // Too many tries or too slow: back to the password.
      if ((err as { code?: string }).code === 'challenge_expired') {
        setStep({ kind: 'password' });
        setCode('');
      }
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = (e: FormEvent) => {
    e.preventDefault();
    void attempt(async () => {
      const r = await api.post<StaffLoginResult>('/auth/staff/login', { email, password });
      if (r.staff) return enter(r.staff);
      if (r.twoFactor === 'code') return setStep({ kind: 'code', challenge: r.challenge! });
      const setup = await api.post<TwoFactorSetupDto>('/auth/staff/login/2fa-setup', { challenge: r.challenge });
      setStep({ kind: 'setup', challenge: r.challenge!, setup });
    });
  };

  const submitCode = (value: string) => {
    if (step.kind !== 'code' && step.kind !== 'setup') return;
    void attempt(async () => {
      const r = await api.post<StaffTwoFactorResult>('/auth/staff/login/2fa', { challenge: step.challenge, code: value });
      if (r.recoveryCodes) setStep({ kind: 'codes', codes: r.recoveryCodes, me: r.staff });
      else enter(r.staff);
    });
  };

  const onCode = (raw: string) => {
    const next = recovery ? raw.trim().toLowerCase().slice(0, 9) : raw.replace(/\D/g, '').slice(0, 6);
    setCode(next);
    // Six digits from the app: in without another click.
    if (!recovery && next.length === 6 && next !== code && !busy) submitCode(next);
  };

  if (step.kind === 'codes') return <RecoveryCodes codes={step.codes} onDone={() => enter(step.me)} />;

  if (step.kind === 'code' || step.kind === 'setup') {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submitCode(code);
        }}
        className="space-y-4"
        noValidate
      >
        {step.kind === 'setup' ? (
          <>
            <p className="text-sm font-semibold">במערכת הזו כל הצוות נכנס גם עם קוד מאפליקציה בטלפון. מגדירים פעם אחת:</p>
            {step.setup && <QrSetup setup={step.setup} />}
          </>
        ) : (
          <p className="text-sm text-ink-2">{recovery ? 'הקלידו אחד מקודי הגיבוי ששמרתם.' : 'הקלידו את 6 הספרות מאפליקציית האימות בטלפון.'}</p>
        )}
        <Field label={recovery ? 'קוד גיבוי' : 'קוד מהאפליקציה'} htmlFor="code">
          <input
            id="code"
            inputMode={recovery ? 'text' : 'numeric'}
            autoComplete="one-time-code"
            autoFocus
            dir="ltr"
            value={code}
            onChange={(e) => onCode(e.target.value)}
            placeholder={recovery ? 'abcd-efgh' : '000000'}
            className={`${inputClass} text-center font-mono text-lg tracking-[.3em]`}
          />
        </Field>
        {error && (
          <p role="alert" className="rounded-lg bg-brand-soft px-3 py-2 text-sm font-semibold text-brand-deep">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" busy={busy} className="w-full" disabled={recovery ? code.length < 9 : code.length !== 6}>
          כניסה
        </Button>
        {step.kind === 'code' && (
          <button
            type="button"
            className="w-full text-center text-sm font-semibold text-muted underline-offset-2 hover:underline"
            onClick={() => {
              setRecovery(!recovery);
              setCode('');
            }}
          >
            {recovery ? 'חזרה לקוד מהאפליקציה' : 'אין לי את הטלפון: כניסה עם קוד גיבוי'}
          </button>
        )}
      </form>
    );
  }

  return (
    <form onSubmit={submitPassword} className="space-y-4" noValidate>
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
