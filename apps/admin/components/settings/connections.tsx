'use client';
// Settings > connections: the AI, email and social networks. Keys are write-only:
// the server keeps them encrypted and only shows their last characters.
import {
  INTEGRATIONS,
  LINK_IN_FIRST_COMMENT,
  SOCIAL_PLATFORMS,
  type ConnectionTest,
  type IntegrationStatus,
  type SocialAccountDto,
  type SocialPlatform,
} from '@b4/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { admin, errorMessage } from '@/lib/api';
import { PLATFORM, formatDateTime } from '@/lib/labels';
import { Badge, Button, Card, Field, Loading, cx, inputClass, useToast } from '../ui';

function TestResult({ result }: { result: ConnectionTest | null }) {
  if (!result) return null;
  return (
    <p role="status" className={cx('rounded-lg px-3 py-2 text-sm font-semibold', result.ok ? 'bg-ok-soft text-ok' : 'bg-brand-soft text-brand-deep')}>
      {result.message}
    </p>
  );
}

function IntegrationCard({ status }: { status: IntegrationStatus }) {
  const def = INTEGRATIONS[status.id];
  const qc = useQueryClient();
  const toast = useToast();
  const [values, setValues] = useState<Record<string, string>>({});
  const [test, setTest] = useState<ConnectionTest | null>(null);
  const save = useMutation({
    mutationFn: (v: Record<string, string | null>) => admin.put<IntegrationStatus>(`/integrations/${status.id}`, { values: v }),
    onSuccess: () => {
      setValues({});
      setTest(null);
      toast('נשמר.');
      void qc.invalidateQueries({ queryKey: ['integrations'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  const check = useMutation({
    mutationFn: () => admin.post<ConnectionTest>(`/integrations/${status.id}/test`),
    onSuccess: setTest,
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  const dirty = Object.values(values).some((v) => v.trim() !== '');

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          {def.title}
          <Badge tone={status.connected ? 'ok' : 'warn'}>{status.connected ? (status.source === 'env' ? 'מוגדר בשרת' : 'מוגדר') : 'לא מחובר'}</Badge>
        </span>
      }
      actions={
        <a href={def.docsUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-brand hover:underline">
          איפה מקבלים מפתח? ↗
        </a>
      }
    >
      <p className="mb-4 text-sm text-ink-2">{def.description}</p>
      <form
        className="space-y-4"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          const payload = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== '').map(([k, v]) => [k, v.trim()]));
          if (Object.keys(payload).length) save.mutate(payload);
        }}
      >
        <div className="grid gap-4 md:grid-cols-2">
          {def.fields.map((f) => {
            const state = status.fields.find((x) => x.key === f.key);
            return (
              <Field
                key={f.key}
                label={f.label}
                htmlFor={`${status.id}-${f.key}`}
                hint={f.secret ? (state?.configured ? `שמור: ${state.hint}. השאירו ריק כדי לא לשנות.` : f.help) : `${f.help ? `${f.help} ` : ''}ברירת מחדל: ${f.defaultValue ?? '—'}`}
              >
                <div className="flex gap-2">
                  <input
                    id={`${status.id}-${f.key}`}
                    type={f.secret ? 'password' : 'text'}
                    dir="ltr"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={f.secret ? (state?.configured ? '••••••••' : f.placeholder) : (state?.value ?? f.defaultValue)}
                    value={values[f.key] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                    className={cx(inputClass, 'font-mono text-sm')}
                  />
                  {state?.configured && status.source !== 'env' ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-10"
                      onClick={() => confirm(`להסיר את "${f.label}"?`) && save.mutate({ [f.key]: null })}
                      aria-label={`הסרת ${f.label}`}
                    >
                      הסרה
                    </Button>
                  ) : null}
                </div>
              </Field>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="dark" busy={save.isPending} disabled={!dirty}>
            שמירה
          </Button>
          <Button busy={check.isPending} disabled={!status.connected || dirty} onClick={() => check.mutate()}>
            בדיקת חיבור
          </Button>
          {status.updatedAt ? (
            <span className="text-xs text-muted">
              עודכן {formatDateTime(status.updatedAt)}
              {status.updatedBy ? ` · ${status.updatedBy}` : ''}
            </span>
          ) : null}
        </div>
        <TestResult result={test} />
      </form>
    </Card>
  );
}

// Facebook and Instagram: the personal token is enough; the server makes the page's permanent one from it.
const TOKEN_HELP: Record<SocialPlatform, { id: string; token: string }> = {
  facebook: {
    id: 'מזהה העמוד (Page ID, מספר)',
    token:
      'מדביקים את הטוקן האישי מ-Graph API Explorer (ב-"User or Page" בוחרים User Token), עם ההרשאות pages_show_list, pages_read_engagement, pages_manage_posts ו-pages_manage_engagement (לתגובה עם הקישור). המערכת הופכת אותו לטוקן הקבוע של העמוד. צריך שסוד האפליקציה יהיה מוזן בכרטיס "Meta" שלמעלה.',
  },
  instagram: {
    id: 'מזהה האינסטגרם (IG User ID, מספר; לא @שם)',
    token:
      'מדביקים את הטוקן האישי מ-Graph API Explorer (אפשר את אותו אחד של פייסבוק), עם ההרשאות instagram_basic, instagram_content_publish, instagram_manage_comments (לתגובה עם הקישור), pages_show_list ו-pages_read_engagement. המערכת מוצאת את העמוד שהאינסטגרם מקושר אליו ושומרת את הטוקן הקבוע שלו.',
  },
  telegram: { id: 'שם הערוץ (@channel) או מזהה הצ׳אט', token: 'טוקן של בוט מ-@BotFather. הבוט צריך להיות מנהל בערוץ' },
  whatsapp: { id: 'שם או קישור הערוץ', token: 'לערוצי וואטסאפ אין API לפרסום; הפוסטים יוכנו לפרסום ידני' },
  x: { id: 'שם המשתמש', token: 'פרסום אוטומטי ל-X עוד לא מחובר; הפוסטים יוכנו לפרסום ידני' },
  tiktok: { id: 'שם המשתמש', token: 'פרסום אוטומטי לטיקטוק עוד לא מחובר; הפוסטים יוכנו לפרסום ידני' },
};

const AUTOMATIC: SocialPlatform[] = ['facebook', 'instagram', 'telegram'];

/** duplicate: an extra account of the same network (left from before one-per-network), to delete. */
function AccountRow({ account, duplicate }: { account: SocialAccountDto; duplicate: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [token, setToken] = useState('');
  const [test, setTest] = useState<ConnectionTest | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['social-accounts'] });
  const check = useMutation({ mutationFn: () => admin.post<ConnectionTest>(`/social-accounts/${account.id}/test`), onSuccess: setTest, onError: (e) => toast(errorMessage(e), 'danger') });
  const saveToken = useMutation({
    mutationFn: (t: string | null) => admin.put(`/social-accounts/${account.id}/token`, { token: t }),
    onSuccess: (_, t) => {
      setToken('');
      setTest(null);
      refresh();
      // A new token is tested right away, so it's clear at once whether posting will work.
      if (t) check.mutate();
    },
    // Why Meta's token wasn't kept can take a few sentences: shown in place, not in a passing toast.
    onError: (e) => setTest({ ok: false, message: errorMessage(e) }),
  });
  const toggle = useMutation({ mutationFn: () => admin.patch(`/social-accounts/${account.id}`, { isActive: !account.isActive }), onSuccess: refresh, onError: (e) => toast(errorMessage(e), 'danger') });
  // Correcting the ID keeps the account's token.
  const changeId = useMutation({
    mutationFn: (externalId: string) => admin.patch(`/social-accounts/${account.id}`, { externalId }),
    onSuccess: () => {
      setTest(null);
      refresh();
      toast('המזהה עודכן. אפשר ללחוץ "בדיקת חיבור".');
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  const askId = () => {
    const next = prompt(TOKEN_HELP[account.platform].id, account.externalId)?.trim();
    if (next && next !== account.externalId) changeId.mutate(next);
  };
  // Deleting is for good: the token and the account's posts go too. Using the network again means adding it anew.
  const remove = useMutation({
    mutationFn: () => admin.del(`/social-accounts/${account.id}`),
    onSuccess: () => {
      refresh();
      toast(`החשבון "${account.displayName}" נמחק.`);
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  const askRemove = () => {
    const ok = confirm(
      `למחוק את "${account.displayName}" (${PLATFORM[account.platform]})?\n\nהטוקן יימחק, שום דבר לא יפורסם אליו יותר, והוא יוסר מכל הכתבות. כדי להשתמש ברשת שוב, מוסיפים חשבון חדש.`,
    );
    if (ok) remove.mutate();
  };
  const automatic = AUTOMATIC.includes(account.platform);

  return (
    <li className={cx('rounded-lg p-4 ring-1 ring-line', !account.isActive && 'opacity-60')}>
      <div className="flex flex-wrap items-center gap-2">
        <b>{PLATFORM[account.platform]}</b>
        <span>{account.displayName}</span>
        <span className="text-xs text-muted" dir="ltr">
          {account.externalId}
        </span>
        {account.linkInFirstComment && <Badge tone="info">קישור בתגובה הראשונה</Badge>}
        {automatic ? <Badge tone={account.connected ? 'ok' : 'warn'}>{account.connected ? 'טוקן מוגדר' : 'חסר טוקן'}</Badge> : <Badge>פרסום ידני</Badge>}
        {!account.isActive && <Badge>מושבת</Badge>}
        {duplicate && <Badge tone="warn">יש עוד חשבון לרשת הזו: מחקו את המיותר</Badge>}
        <Button size="sm" variant="ghost" className="mr-auto" busy={changeId.isPending} onClick={askId}>
          שינוי מזהה
        </Button>
        <Button size="sm" variant="ghost" onClick={() => toggle.mutate()}>
          {account.isActive ? 'השבתה' : 'הפעלה'}
        </Button>
        <Button size="sm" variant="ghost" className="text-brand" busy={remove.isPending} onClick={askRemove}>
          מחיקה
        </Button>
      </div>
      {automatic ? (
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (token.trim()) saveToken.mutate(token.trim());
          }}
        >
          <div className="min-w-64 flex-1">
            <Field label="טוקן" htmlFor={`tok-${account.id}`} hint={TOKEN_HELP[account.platform].token}>
              <input
                id={`tok-${account.id}`}
                type="password"
                dir="ltr"
                autoComplete="off"
                placeholder={account.connected ? '•••••••• (שמור; הזינו חדש כדי להחליף)' : 'הדביקו כאן את הטוקן'}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className={cx(inputClass, 'font-mono text-sm')}
              />
            </Field>
          </div>
          <Button type="submit" variant="dark" busy={saveToken.isPending} disabled={!token.trim()}>
            שמירה
          </Button>
          <Button busy={check.isPending} disabled={!account.connected} onClick={() => check.mutate()}>
            בדיקת חיבור
          </Button>
          {account.connected ? (
            <Button variant="ghost" onClick={() => confirm('להסיר את הטוקן?') && saveToken.mutate(null)}>
              הסרת טוקן
            </Button>
          ) : null}
        </form>
      ) : (
        <p className="mt-2 text-sm text-muted">{TOKEN_HELP[account.platform].token}</p>
      )}
      <div className="mt-2">
        <TestResult result={test} />
      </div>
    </li>
  );
}

/** One account per network: only the networks that have none yet are offered. */
function AddAccount({ taken }: { taken: SocialPlatform[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const free = SOCIAL_PLATFORMS.filter((p) => !taken.includes(p));
  const [chosen, setPlatform] = useState<SocialPlatform>('facebook');
  const platform = free.includes(chosen) ? chosen : free[0]!;
  const [displayName, setDisplayName] = useState('');
  const [externalId, setExternalId] = useState('');
  const create = useMutation({
    mutationFn: () =>
      admin.post('/social-accounts', {
        platform,
        displayName,
        externalId,
        // The env-var fallback name; the token itself is entered above after the account exists.
        secretRef: `${platform.toUpperCase()}_${Date.now().toString(36).toUpperCase()}`,
      }),
    onSuccess: () => {
      setDisplayName('');
      setExternalId('');
      void qc.invalidateQueries({ queryKey: ['social-accounts'] });
      toast('החשבון נוסף. עכשיו הדביקו את הטוקן שלו.');
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  if (free.length === 0) {
    return <p className="mt-5 border-t border-line-soft pt-5 text-sm text-muted">לכל הרשתות כבר יש חשבון. כדי להחליף חשבון, מוחקים אותו ומוסיפים חדש.</p>;
  }
  return (
    <form
      className="mt-5 grid gap-3 border-t border-line-soft pt-5 md:grid-cols-4"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <Field label="רשת" htmlFor="sa-p">
        <select id="sa-p" value={platform} onChange={(e) => setPlatform(e.target.value as SocialPlatform)} className={inputClass}>
          {free.map((p) => (
            <option key={p} value={p}>
              {PLATFORM[p]}
              {LINK_IN_FIRST_COMMENT[p] ? ' (קישור בתגובה)' : ''}
            </option>
          ))}
        </select>
      </Field>
      <Field label="שם לתצוגה" htmlFor="sa-n">
        <input id="sa-n" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="למשל: עמוד הפייסבוק הראשי" className={inputClass} />
      </Field>
      <Field label={TOKEN_HELP[platform].id} htmlFor="sa-e">
        <input id="sa-e" dir="ltr" required value={externalId} onChange={(e) => setExternalId(e.target.value)} className={inputClass} />
      </Field>
      <div className="flex items-end">
        <Button type="submit" variant="dark" busy={create.isPending}>
          הוספת חשבון
        </Button>
      </div>
    </form>
  );
}

export function Connections() {
  const integrations = useQuery({ queryKey: ['integrations'], queryFn: () => admin.get<IntegrationStatus[]>('/integrations') });
  const accounts = useQuery({ queryKey: ['social-accounts'], queryFn: () => admin.get<SocialAccountDto[]>('/social-accounts') });
  const list = accounts.data ?? [];
  const taken = [...new Set(list.map((a) => a.platform))];
  // The extra ones of a network: the switched-off ones, or all of them when more than one is on.
  const isDuplicate = (a: SocialAccountDto) => {
    const same = list.filter((x) => x.platform === a.platform);
    return same.length > 1 && (!a.isActive || same.filter((x) => x.isActive).length > 1);
  };
  return (
    <div className="space-y-6">
      <p className="rounded-lg bg-info-soft px-4 py-3 text-sm text-info">
        המפתחות נשמרים מוצפנים בשרת ולא מוצגים שוב אחרי השמירה (רק 4 התווים האחרונים). שינוי נכנס לתוקף מיד, בלי להפעיל מחדש.
      </p>
      {integrations.isPending ? <Loading /> : integrations.data?.map((s) => <IntegrationCard key={s.id} status={s} />)}
      <Card title="רשתות חברתיות">
        <p className="mb-4 text-sm text-ink-2">
          פייסבוק, אינסטגרם וטלגרם מתפרסמים אוטומטית אחרי שהכתבה עולה לאתר. בפייסבוק, אינסטגרם ו-X הקישור לכתבה נכנס לתגובה הראשונה. בשאר הרשתות הפוסט מוכן לפרסום ידני.
          לכל רשת מחברים חשבון אחד. "השבתה" עוצרת אותו זמנית; "מחיקה" מסירה אותו לגמרי.
        </p>
        {accounts.isPending ? (
          <Loading />
        ) : (
          <ul className="space-y-3">
            {list.map((a) => (
              <AccountRow key={a.id} account={a} duplicate={isDuplicate(a)} />
            ))}
          </ul>
        )}
        {!accounts.isPending && <AddAccount taken={taken} />}
      </Card>
    </div>
  );
}
