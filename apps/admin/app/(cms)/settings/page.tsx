'use client';
// Settings: connections (AI, email, social), the agent team and their skills, site details, team, my password.
import { STAFF_ROLES, type StaffRole, type StaffUserDto } from '@b4/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { AgentTeam } from '@/components/agent/team';
import { Connections } from '@/components/settings/connections';
import { SiteDetails } from '@/components/settings/site-details';
import { SecurityCard, TwoFactorCard } from '@/components/settings/two-factor';
import { Badge, Button, Card, Field, Loading, PageHeader, inputClass, useToast } from '@/components/ui';
import { admin, errorMessage } from '@/lib/api';
import { useCan, useStaff } from '@/lib/auth';
import { ROLE, timeAgo } from '@/lib/labels';

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
  const reset2fa = useMutation({
    mutationFn: (u: StaffUserDto) => admin.post(`/users/${u.id}/reset-2fa`),
    onSuccess: () => {
      toast('האימות הדו-שלבי אופס והמשתמש נותק. בכניסה הבאה הוא יגדיר אותו מחדש.');
      refresh();
    },
    onError,
  });

  return (
    <Card title="צוות המערכת">
      <SecurityCard />
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
              <th className="py-2">אימות דו-שלבי</th>
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
                <td className="py-2">
                  <Badge tone={u.twoFactor ? 'ok' : 'muted'}>{u.twoFactor ? 'פעיל' : 'לא הופעל'}</Badge>
                </td>
                <td className="py-2 text-muted">{timeAgo(u.lastLoginAt)}</td>
                <td className="py-2">
                  {u.id !== me.id && (
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => reset.mutate(u)}>
                        איפוס סיסמה
                      </Button>
                      {u.twoFactor && (
                        <Button size="sm" variant="ghost" onClick={() => confirm(`לאפס את האימות הדו-שלבי של ${u.fullName}? (למשל כשאבד הטלפון)`) && reset2fa.mutate(u)}>
                          איפוס אימות
                        </Button>
                      )}
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

type Tab = 'connections' | 'agents' | 'site' | 'team' | 'password';

function Settings() {
  const isAdmin = useCan();
  const params = useSearchParams();
  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: 'connections', label: 'חיבורים', show: isAdmin },
    { id: 'agents', label: 'צוות הסוכנים', show: true },
    { id: 'site', label: 'פרטי האתר', show: true },
    { id: 'team', label: 'צוות', show: isAdmin },
    { id: 'password', label: 'החשבון שלי', show: true },
  ];
  const visible = tabs.filter((t) => t.show);
  const [tab, setTab] = useState<Tab>(visible[0]!.id);
  // "/settings?tab=agents" (from the agent page) opens that tab; "&agent=learning" opens that agent's settings.
  const wanted = params.get('tab');
  useEffect(() => {
    if (visible.some((t) => t.id === wanted)) setTab(wanted as Tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- when the address asks for a tab
  }, [wanted]);

  return (
    <>
      <PageHeader title="הגדרות" subtitle={isAdmin ? 'חיבור ה-AI, הדואר והרשתות החברתיות, צוות הסוכנים והסקילים שלהם, פרטי האתר והצוות.' : undefined} />
      <div className="mb-6 inline-flex flex-wrap rounded-lg bg-white p-1 ring-1 ring-line" role="tablist">
        {visible.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-md px-4 py-2 font-bold ${tab === t.id ? 'bg-ink text-white' : 'text-ink-2 hover:bg-stone'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'connections' && isAdmin && <Connections />}
      {tab === 'agents' && <AgentTeam focus={params.get('agent')} />}
      {tab === 'site' && <SiteDetails canEdit={isAdmin} />}
      {tab === 'team' && isAdmin && <StaffCard />}
      {tab === 'password' && (
        <div className="space-y-6">
          <PasswordCard />
          <TwoFactorCard />
        </div>
      )}
    </>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Settings />
    </Suspense>
  );
}