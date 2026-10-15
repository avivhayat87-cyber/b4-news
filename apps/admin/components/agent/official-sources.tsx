'use client';
// The official-sources registry, in the research reporter's settings: every body whose site and
// verified accounts count as official sources, under its name. An account enters by itself when
// the body's official site links to it (checked weekly); what a search found elsewhere waits for
// an admin. Only an admin adds, changes or removes.
import { ORG_KINDS, type OfficialSourceDto, type OrgKind, type RegistryOverviewDto } from '@b4/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { admin, errorMessage } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { ACCOUNT_STATUS, OFFICIAL_PLATFORM, ORG_KIND, formatDateTime } from '@/lib/labels';
import { Badge, Button, Field, Loading, cx, inputClass, useToast } from '../ui';

const handleOf = (key: string) => key.split('/').slice(1).join('/');

function Body({ source, isAdmin }: { source: OfficialSourceDto; isAdmin: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [url, setUrl] = useState('');
  const refresh = () => void qc.invalidateQueries({ queryKey: ['official-sources'] });
  const onError = (e: unknown) => toast(errorMessage(e), 'danger');
  const account = useMutation({
    mutationFn: ({ action, url }: { action: 'add' | 'approve' | 'remove'; url: string }) =>
      admin.post<OfficialSourceDto>(action === 'add' ? `/official-sources/${source.id}/accounts` : `/official-sources/${source.id}/accounts/${action}`, { url }),
    onSuccess: () => {
      setUrl('');
      refresh();
    },
    onError,
  });
  const toggle = useMutation({
    mutationFn: () => admin.put(`/official-sources/${source.id}`, { name: source.name, kind: source.kind, homepage: source.homepage, domains: source.domains, active: !source.active }),
    onSuccess: refresh,
    onError,
  });
  const remove = useMutation({ mutationFn: () => admin.del(`/official-sources/${source.id}`), onSuccess: refresh, onError });

  return (
    <li className={cx('space-y-2 rounded-lg p-3 ring-1', source.active ? 'bg-white ring-line' : 'bg-stone/60 ring-line-soft')}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold">{source.name}</span>
        <Badge tone="muted">{ORG_KIND[source.kind]}</Badge>
        {!source.active && <Badge tone="warn">לא פעיל</Badge>}
        <a href={source.homepage} target="_blank" rel="noopener noreferrer" dir="ltr" className="truncate text-xs text-info underline">
          {source.domains.join(' · ')}
        </a>
        {isAdmin && (
          <span className="mr-auto flex gap-1">
            <Button size="sm" variant="ghost" busy={toggle.isPending} onClick={() => toggle.mutate()}>
              {source.active ? 'השבתה' : 'הפעלה'}
            </Button>
            <Button size="sm" variant="ghost" busy={remove.isPending} onClick={() => confirm(`להוציא את "${source.name}" מהמאגר?`) && remove.mutate()}>
              הסרה
            </Button>
          </span>
        )}
      </div>
      {source.lastError && <p className="text-xs text-warn">בבדיקה האחרונה לא הצלחנו לקרוא את האתר: {source.lastError}</p>}
      {source.accounts.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {source.accounts.map((a) => (
            <li key={a.key} className="flex items-center gap-1.5 rounded-full bg-stone px-2.5 py-1 text-xs">
              <span className="font-bold">{OFFICIAL_PLATFORM[a.platform]}</span>
              <a href={a.url} target="_blank" rel="noopener noreferrer nofollow" dir="ltr" className="underline">
                {handleOf(a.key)}
              </a>
              <Badge tone={ACCOUNT_STATUS[a.status].tone}>{ACCOUNT_STATUS[a.status].label}</Badge>
              {a.evidence && a.status === 'pending' && (
                <a href={a.evidence} target="_blank" rel="noopener noreferrer nofollow" className="text-info underline">
                  איפה נמצא
                </a>
              )}
              {isAdmin && a.status === 'pending' && (
                <button type="button" className="font-bold text-ok" onClick={() => account.mutate({ action: 'approve', url: a.url })}>
                  לאשר
                </button>
              )}
              {isAdmin && (
                <button type="button" aria-label={`הסרת ${handleOf(a.key)}`} className="font-bold text-danger" onClick={() => account.mutate({ action: 'remove', url: a.url })}>
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted">עוד לא נמצאו חשבונות. הבדיקה השבועית תחפש.</p>
      )}
      {isAdmin && (
        <form
          className="flex gap-2"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (url.trim()) account.mutate({ action: 'add', url: url.trim() });
          }}
        >
          <input aria-label={`חשבון של ${source.name}`} dir="ltr" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://x.com/…" className={cx(inputClass, 'py-1 text-sm')} />
          <Button size="sm" type="submit" busy={account.isPending} disabled={!url.trim()}>
            הוספה
          </Button>
        </form>
      )}
    </li>
  );
}

function AddBody() {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({ name: '', homepage: '', kind: 'government' as OrgKind, domains: '' });
  const create = useMutation({
    mutationFn: () => admin.post('/official-sources', { name: form.name.trim(), homepage: form.homepage.trim(), kind: form.kind, domains: form.domains.split(/[\s,]+/).filter(Boolean) }),
    onSuccess: () => {
      setForm({ name: '', homepage: '', kind: 'government', domains: '' });
      toast('הגוף נוסף. בבדיקה הבאה המערכת תמצא את החשבונות שהאתר שלו מקשר אליהם.');
      void qc.invalidateQueries({ queryKey: ['official-sources'] });
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  return (
    <form
      className="grid gap-3 rounded-lg bg-stone p-3 sm:grid-cols-2"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <Field label="שם הגוף" htmlFor="os-name">
        <input id="os-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="למשל: משרד החינוך" className={inputClass} />
      </Field>
      <Field label="סוג" htmlFor="os-kind">
        <select id="os-kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as OrgKind })} className={inputClass}>
          {ORG_KINDS.map((k) => (
            <option key={k} value={k}>
              {ORG_KIND[k]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="האתר הרשמי" htmlFor="os-home" hint="העמוד שמקשר לחשבונות הרשמיים (בדרך כלל עמוד הבית).">
        <input id="os-home" dir="ltr" value={form.homepage} onChange={(e) => setForm({ ...form, homepage: e.target.value })} placeholder="https://" className={inputClass} />
      </Field>
      <Field label="הדומיינים שלו (לא חובה)" htmlFor="os-domains" hint="ריק: הדומיין של האתר. במשרד ב-gov.il: gov.il/he/departments/…">
        <input id="os-domains" dir="ltr" value={form.domains} onChange={(e) => setForm({ ...form, domains: e.target.value })} className={inputClass} />
      </Field>
      <div className="sm:col-span-2">
        <Button type="submit" variant="primary" busy={create.isPending} disabled={form.name.trim().length < 2 || !form.homepage.trim()}>
          הוספת גוף
        </Button>
      </div>
    </form>
  );
}

export function OfficialSources() {
  const qc = useQueryClient();
  const toast = useToast();
  const isAdmin = useCan();
  const canEdit = useCan('editor');
  const query = useQuery({
    queryKey: ['official-sources'],
    queryFn: () => admin.get<RegistryOverviewDto>('/official-sources'),
    refetchInterval: (q) => (q.state.data?.running ? 5000 : false),
  });
  const update = useMutation({
    mutationFn: () => admin.post<{ queued: boolean }>('/official-sources/update'),
    onSuccess: (r) => {
      toast(r.queued ? 'הבדיקה התחילה. היא קוראת את האתרים הרשמיים ולוקחת כמה דקות.' : 'בדיקה כבר רצה עכשיו.');
      void qc.invalidateQueries({ queryKey: ['official-sources'] });
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  const [adding, setAdding] = useState(false);
  if (!query.data) return <Loading />;
  const { sources, lastRun, running } = query.data;
  const pending = sources.reduce((n, s) => n + s.accounts.filter((a) => a.status === 'pending').length, 0);

  return (
    <section className="space-y-4">
      <div>
        <h3 className="font-bold">מאגר המקורות הרשמיים</h3>
        <p className="mt-1 text-sm text-ink-2">
          עמוד מאתר של גוף כאן, או פוסט מחשבון מאומת שלו, נחשב מקור רשמי, ובסוף הכתבה מופיע שם הגוף. חשבון נכנס לבד כשהאתר הרשמי מקשר אליו. מה שנמצא בחיפוש ולא מקושר מהאתר מחכה לאישור של אדמין. פעם בשבוע המערכת עוברת על כל האתרים (חינם) ומחפשת חשבונות חסרים לכמה גופים (עד 10 סנט לגוף).
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {canEdit && (
          <Button size="sm" busy={update.isPending || running} disabled={running} onClick={() => update.mutate()}>
            {running ? 'בודק עכשיו…' : 'לבדוק עכשיו'}
          </Button>
        )}
        <span className="text-muted">
          {lastRun
            ? `בדיקה אחרונה: ${formatDateTime(lastRun.at)} · נבדקו ${lastRun.checked} · נוספו ${lastRun.added} · ממתינים ${lastRun.pending}${lastRun.errors ? ` · ${lastRun.errors} אתרים לא נקראו` : ''} · $${lastRun.costUsd.toFixed(2)}`
            : 'עוד לא הייתה בדיקה.'}
        </span>
        {pending > 0 && <Badge tone="warn">{pending} חשבונות ממתינים לאישור</Badge>}
      </div>
      <ul className="space-y-2">
        {sources.map((s) => (
          <Body key={s.id} source={s} isAdmin={isAdmin} />
        ))}
      </ul>
      {isAdmin &&
        (adding ? (
          <AddBody />
        ) : (
          <Button size="sm" onClick={() => setAdding(true)}>
            הוספת גוף רשמי
          </Button>
        ))}
    </section>
  );
}
