'use client';
// Settings: my password (everyone), staff and social accounts (admins).
import { SOCIAL_PLATFORMS, STAFF_ROLES, type SocialAccountDto, type SocialPlatform, type StaffRole, type StaffUserDto } from '@b4/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Badge, Button, Card, Field, Loading, PageHeader, inputClass, useToast } from '@/components/ui';
import { admin, errorMessage } from '@/lib/api';
import { useCan, useStaff } from '@/lib/auth';
import { PLATFORM, ROLE, timeAgo } from '@/lib/labels';

function PasswordCard() {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const change = useMutation({
    mutationFn: () => admin.post('/me/password', { current, next }),
    onSuccess: () => {
      setCurrent('');
      setNext('');
      toast('הסיסמה עודכנה. התנתקת מכל שאר המכשירים.');
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  return (
    <Card title="הסיסמה שלי">
      <form
        className="grid gap-4 md:grid-cols-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          change.mutate();
        }}
      >
        <Field label="סיסמה נוכחית" htmlFor="pw-c">
          <input id="pw-c" type="password" dir="ltr" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className={inputClass} />
        </Field>
        <Field label="סיסמה חדשה" htmlFor="pw-n" hint="לפחות 12 תווים">
          <input id="pw-n" type="password" dir="ltr" autoComplete="new-password" minLength={12} value={next} onChange={(e) => setNext(e.target.value)} className={inputClass} />
        </Field>
        <div className="flex items-end">
          <Button type="submit" variant="dark" busy={change.isPending} disabled={!current || next.length < 12}>
            עדכון סיסמה
          </Button>
        </div>
      </form>
    </Card>
  );
}

function StaffCard() {
  const me = useStaff();
  const qc = useQueryClient();
  const toast = useToast();
  const users = useQuery({ queryKey: ['users'], queryFn: () => admin.get<StaffUserDto[]>('/users') });
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<StaffRole>('editor');
  const [secret, setSecret] = useState<{ who: string; password: string } | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['users'] });
  const onError = (e: unknown) => toast(errorMessage(e), 'danger');
  const create = useMutation({
    mutationFn: () => admin.post<{ user: StaffUserDto; temporaryPassword: string }>('/users', { email, fullName, role }),
    onSuccess: (r) => {
      setSecret({ who: r.user.email, password: r.temporaryPassword });
      setEmail('');
      setFullName('');
      refresh();
    },
    onError,
  });
  const update = useMutation({ mutationFn: ({ id, ...body }: { id: string; role?: StaffRole; isActive?: boolean }) => admin.patch(`/users/${id}`, body), onSuccess: refresh, onError });
  const reset = useMutation({
    mutationFn: (u: StaffUserDto) => admin.post<{ temporaryPassword: string }>(`/users/${u.id}/reset-password`).then((r) => ({ who: u.email, password: r.temporaryPassword })),
    onSuccess: setSecret,
    onError,
  });

  return (
    <Card title="צוות המערכת">
      {secret && (
        <div className="mb-4 rounded-lg bg-warn-soft p-4 text-warn" role="alert">
          <p className="font-bold">סיסמה זמנית ל-{secret.who} (מוצגת פעם אחת בלבד):</p>
          <code className="mt-1 block select-all rounded bg-white px-3 py-2 font-mono text-lg text-ink" dir="ltr">
            {secret.password}
          </code>
          <p className="mt-1 text-sm">העבירו אותה בערוץ מאובטח, ובקשו להחליף אותה בכניסה הראשונה.</p>
          <Button size="sm" className="mt-2" onClick={() => setSecret(null)}>
            הסתרה
          </Button>
        </div>
      )}
      {users.isPending ? (
        <Loading />
      ) : (
        <table className="w-full text-right text-sm">
          <thead className="text-ink-2">
            <tr>
              <th className="py-2">שם</th>
              <th className="py-2">מייל</th>
              <th className="py-2">תפקיד</th>
              <th className="py-2">כניסה אחרונה</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {users.data?.map((u) => (
              <tr key={u.id} className={u.isActive ? '' : 'opacity-50'}>
                <td className="py-2 font-semibold">{u.fullName}</td>
                <td className="py-2" dir="ltr">
                  {u.email}
                </td>
                <td className="py-2">
                  <select value={u.role} disabled={u.id === me.id} onChange={(e) => update.mutate({ id: u.id, role: e.target.value as StaffRole })} className={inputClass} aria-label={`תפקיד של ${u.fullName}`}>
                    {STAFF_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE[r]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-2 text-muted">{timeAgo(u.lastLoginAt)}</td>
                <td className="py-2">
                  {u.id !== me.id && (
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => reset.mutate(u)}>
                        איפוס סיסמה
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: u.id, isActive: !u.isActive })}>
                        {u.isActive ? 'השבתה' : 'הפעלה'}
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form
        className="mt-5 grid gap-3 border-t border-line-soft pt-5 md:grid-cols-4"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <Field label="שם מלא" htmlFor="u-name">
          <input id="u-name" required value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputClass} />
        </Field>
        <Field label="מייל" htmlFor="u-email">
          <input id="u-email" type="email" dir="ltr" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
        </Field>
        <Field label="תפקיד" htmlFor="u-role">
          <select id="u-role" value={role} onChange={(e) => setRole(e.target.value as StaffRole)} className={inputClass}>
            {STAFF_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE[r]}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex items-end">
          <Button type="submit" variant="dark" busy={create.isPending}>
            הוספת משתמש
          </Button>
        </div>
      </form>
    </Card>
  );
}

function SocialCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const accounts = useQuery({ queryKey: ['social-accounts'], queryFn: () => admin.get<SocialAccountDto[]>('/social-accounts') });
  const [platform, setPlatform] = useState<SocialPlatform>('facebook');
  const [displayName, setDisplayName] = useState('');
  const [externalId, setExternalId] = useState('');
  const [secretRef, setSecretRef] = useState('');
  const refresh = () => void qc.invalidateQueries({ queryKey: ['social-accounts'] });
  const onError = (e: unknown) => toast(errorMessage(e), 'danger');
  const create = useMutation({
    mutationFn: () => admin.post('/social-accounts', { platform, displayName, externalId, secretRef }),
    onSuccess: () => {
      setDisplayName('');
      setExternalId('');
      setSecretRef('');
      refresh();
    },
    onError,
  });
  const toggle = useMutation({ mutationFn: (a: SocialAccountDto) => admin.patch(`/social-accounts/${a.id}`, { isActive: !a.isActive }), onSuccess: refresh, onError });

  return (
    <Card title="חשבונות ברשתות החברתיות">
      <p className="mb-4 text-sm text-muted">
        הטוקנים לא נשמרים במסד הנתונים: הם מוגדרים בשרת כמשתנה סביבה <code dir="ltr">SOCIAL_SECRET_&lt;שם&gt;</code>. חשבון בלי טוקן מכין את הפוסט לפרסום ידני.
      </p>
      <ul className="space-y-2">
        {accounts.data?.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 ring-1 ring-line">
            <b>{PLATFORM[a.platform]}</b>
            <span>{a.displayName}</span>
            <span className="text-xs text-muted" dir="ltr">
              {a.externalId}
            </span>
            {a.linkInFirstComment && <Badge tone="info">קישור בתגובה הראשונה</Badge>}
            <Badge tone={a.connected ? 'ok' : 'warn'}>{a.connected ? 'מחובר' : 'לא מחובר'}</Badge>
            <Button size="sm" variant="ghost" className="mr-auto" onClick={() => toggle.mutate(a)}>
              {a.isActive ? 'השבתה' : 'הפעלה'}
            </Button>
          </li>
        ))}
      </ul>
      <form
        className="mt-5 grid gap-3 border-t border-line-soft pt-5 md:grid-cols-5"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <Field label="רשת" htmlFor="sa-p">
          <select id="sa-p" value={platform} onChange={(e) => setPlatform(e.target.value as SocialPlatform)} className={inputClass}>
            {SOCIAL_PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {PLATFORM[p]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="שם לתצוגה" htmlFor="sa-n">
          <input id="sa-n" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={inputClass} />
        </Field>
        <Field label="מזהה (עמוד / ערוץ)" htmlFor="sa-e">
          <input id="sa-e" dir="ltr" required value={externalId} onChange={(e) => setExternalId(e.target.value)} className={inputClass} />
        </Field>
        <Field label="שם הסוד בשרת" htmlFor="sa-s">
          <input id="sa-s" dir="ltr" required placeholder="FACEBOOK_PAGE" value={secretRef} onChange={(e) => setSecretRef(e.target.value.toUpperCase())} className={inputClass} />
        </Field>
        <div className="flex items-end">
          <Button type="submit" variant="dark" busy={create.isPending}>
            הוספת חשבון
          </Button>
        </div>
      </form>
    </Card>
  );
}

export default function SettingsPage() {
  const isAdmin = useCan();
  return (
    <>
      <PageHeader title="הגדרות" />
      <div className="space-y-6">
        <PasswordCard />
        {isAdmin && <StaffCard />}
        {isAdmin && <SocialCard />}
      </div>
    </>
  );
}
