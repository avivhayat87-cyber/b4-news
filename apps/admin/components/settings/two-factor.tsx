'use client';
// Two-step sign-in in the CMS: the QR code to scan, the recovery codes (shown once), and "my
// account" card to turn it on or off and make new recovery codes.
import type { TwoFactorSetupDto, TwoFactorStatus } from '@b4/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { admin, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/labels';
import { Badge, Button, Card, Field, Loading, inputClass, useToast } from '../ui';

/** The QR code (made on our server by the qrcode library) and the secret, to type in by hand. */
export function QrSetup({ setup }: { setup: TwoFactorSetupDto }) {
  return (
    <div className="space-y-3">
      <ol className="list-decimal space-y-1 ps-5 text-sm text-ink-2">
        <li>פותחים בטלפון אפליקציית אימות: Google Authenticator או Microsoft Authenticator.</li>
        <li>סורקים את הקוד (או מקלידים את המפתח שמתחתיו).</li>
        <li>מקלידים כאן את 6 הספרות שהאפליקציה מציגה.</li>
      </ol>
      {/* The SVG comes from our own server's QR generator, not from user input. */}
      <div className="mx-auto w-48 rounded-lg bg-white p-2 ring-1 ring-line" dangerouslySetInnerHTML={{ __html: setup.qrSvg }} aria-label="קוד QR לאפליקציית האימות" role="img" />
      <p className="text-center text-xs text-muted">
        מפתח להקלדה ידנית:{' '}
        <code className="select-all font-mono text-ink" dir="ltr">
          {setup.secret.replace(/(.{4})/g, '$1 ').trim()}
        </code>
      </p>
    </div>
  );
}

/** Shown once: ten codes that each sign in once, for a lost phone. */
export function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  return (
    <div className="rounded-lg bg-warn-soft p-4" role="alert">
      <p className="font-bold text-warn">קודי גיבוי: מוצגים פעם אחת בלבד</p>
      <p className="mt-1 text-sm text-ink-2">אם הטלפון יאבד, כל קוד מכניס פעם אחת במקום הקוד מהאפליקציה. שמרו אותם במקום בטוח (מנהל סיסמאות או דף מודפס).</p>
      <ul className="mt-3 grid grid-cols-2 gap-1 font-mono text-[15px]" dir="ltr">
        {codes.map((c) => (
          <li key={c} className="select-all rounded bg-white px-2 py-1 text-center">
            {c}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" onClick={() => void navigator.clipboard?.writeText(codes.join('\n'))}>
          העתקה
        </Button>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="size-4" />
          שמרתי את הקודים
        </label>
        <Button size="sm" variant="dark" disabled={!saved} onClick={onDone}>
          המשך
        </Button>
      </div>
    </div>
  );
}

const codeInput = (value: string, onChange: (v: string) => void, id: string) => (
  <input
    id={id}
    inputMode="numeric"
    autoComplete="one-time-code"
    maxLength={6}
    dir="ltr"
    value={value}
    onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
    placeholder="000000"
    className={`${inputClass} text-center font-mono text-lg tracking-[.3em]`}
  />
);

/** "החשבון שלי": two-step sign-in. */
export function TwoFactorCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const status = useQuery({ queryKey: ['me', '2fa'], queryFn: () => admin.get<TwoFactorStatus>('/me/2fa') });
  const [setup, setSetup] = useState<TwoFactorSetupDto | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [off, setOff] = useState({ open: false, password: '', code: '' });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['me', '2fa'] });
  const onError = (e: unknown) => toast(errorMessage(e), 'danger');

  const start = useMutation({ mutationFn: () => admin.post<TwoFactorSetupDto>('/me/2fa/setup'), onSuccess: setSetup, onError });
  const enable = useMutation({
    mutationFn: (c: string) => admin.post<{ recoveryCodes: string[] }>('/me/2fa/enable', { code: c }),
    onSuccess: (r) => {
      setSetup(null);
      setCode('');
      setCodes(r.recoveryCodes);
      refresh();
    },
    onError,
  });
  const disable = useMutation({
    mutationFn: () => admin.post('/me/2fa/disable', { password: off.password, code: off.code }),
    onSuccess: () => {
      setOff({ open: false, password: '', code: '' });
      toast('האימות הדו-שלבי כובה.');
      refresh();
    },
    onError,
  });
  const renew = useMutation({
    mutationFn: (c: string) => admin.post<{ recoveryCodes: string[] }>('/me/2fa/recovery-codes', { code: c }),
    onSuccess: (r) => {
      setCodes(r.recoveryCodes);
      refresh();
    },
    onError,
  });

  if (status.isPending) return <Loading />;
  const st = status.data;
  return (
    <Card title="אימות דו-שלבי" actions={st && <Badge tone={st.enabled ? 'ok' : 'warn'}>{st.enabled ? 'פעיל' : 'כבוי'}</Badge>}>
      <p className="mb-4 text-sm text-ink-2">
        בכל כניסה למערכת הניהול, אחרי הסיסמה, מקלידים גם קוד מאפליקציה בטלפון. כך גם מי שגנב סיסמה לא יוכל להיכנס.
        {st?.required && ' במערכת הזו זה חובה לכל הצוות.'}
      </p>
      {codes ? (
        <RecoveryCodes codes={codes} onDone={() => setCodes(null)} />
      ) : st?.enabled ? (
        <div className="space-y-4">
          <p className="text-sm">
            פעיל מ-{formatDateTime(st.enabledAt)} · נשארו {st.recoveryCodesLeft} קודי גיבוי
          </p>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              renew.mutate(code);
            }}
          >
            <Field label="קוד מהאפליקציה, ליצירת קודי גיבוי חדשים" htmlFor="tf-renew">
              {codeInput(code, setCode, 'tf-renew')}
            </Field>
            <Button type="submit" busy={renew.isPending} disabled={code.length !== 6}>
              קודי גיבוי חדשים
            </Button>
          </form>
          {!st.required &&
            (off.open ? (
              <form
                className="grid gap-3 border-t border-line-soft pt-4 md:grid-cols-3"
                onSubmit={(e: FormEvent) => {
                  e.preventDefault();
                  disable.mutate();
                }}
              >
                <Field label="הסיסמה שלך" htmlFor="tf-pw">
                  <input id="tf-pw" type="password" dir="ltr" autoComplete="current-password" value={off.password} onChange={(e) => setOff({ ...off, password: e.target.value })} className={inputClass} />
                </Field>
                <Field label="קוד מהאפליקציה" htmlFor="tf-off">
                  <input id="tf-off" dir="ltr" autoComplete="one-time-code" value={off.code} onChange={(e) => setOff({ ...off, code: e.target.value.trim() })} className={inputClass} />
                </Field>
                <div className="flex items-end gap-2">
                  <Button type="submit" variant="danger" busy={disable.isPending} disabled={!off.password || off.code.length < 6}>
                    כיבוי
                  </Button>
                  <Button variant="ghost" onClick={() => setOff({ open: false, password: '', code: '' })}>
                    ביטול
                  </Button>
                </div>
              </form>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setOff({ ...off, open: true })}>
                כיבוי האימות הדו-שלבי
              </Button>
            ))}
        </div>
      ) : setup ? (
        <form
          className="space-y-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            enable.mutate(code);
          }}
        >
          <QrSetup setup={setup} />
          <Field label="הקוד מהאפליקציה" htmlFor="tf-code">
            {codeInput(code, setCode, 'tf-code')}
          </Field>
          <Button type="submit" variant="primary" busy={enable.isPending} disabled={code.length !== 6}>
            הפעלה
          </Button>
        </form>
      ) : (
        <Button variant="primary" busy={start.isPending} onClick={() => start.mutate()}>
          הפעלת אימות דו-שלבי
        </Button>
      )}
    </Card>
  );
}

/** For admins: require it from everyone. */
export function SecurityCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const security = useQuery({ queryKey: ['security'], queryFn: () => admin.get<{ requireTwoFactor: boolean }>('/security') });
  const save = useMutation({
    mutationFn: (requireTwoFactor: boolean) => admin.put<{ requireTwoFactor: boolean }>('/security', { requireTwoFactor }),
    onSuccess: (v) => {
      qc.setQueryData(['security'], v);
      toast(v.requireTwoFactor ? 'מעכשיו כל הצוות נכנס עם קוד מהאפליקציה. מי שעוד לא הפעיל יגדיר את זה בכניסה הבאה.' : 'האימות הדו-שלבי כבר לא חובה.');
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  if (!security.data) return null;
  return (
    <label className="mb-4 flex items-start gap-3 rounded-lg bg-stone p-4">
      <input type="checkbox" className="mt-1 size-4" checked={security.data.requireTwoFactor} disabled={save.isPending} onChange={(e) => save.mutate(e.target.checked)} />
      <span>
        <span className="block font-bold">לחייב אימות דו-שלבי לכל הצוות</span>
        <span className="block text-sm text-ink-2">מי שעוד לא הפעיל יתבקש לסרוק קוד בכניסה הבאה. מי שאיבד את הטלפון: "איפוס אימות" ברשימה למטה.</span>
      </span>
    </label>
  );
}
