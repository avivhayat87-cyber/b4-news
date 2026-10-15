'use client';
import { CATEGORIES, type SourceDto, type SourceRegion } from '@b4/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { SectionTabs } from '@/components/section-tabs';
import { Badge, Button, Card, Empty, ErrorBox, Field, Loading, PageHeader, inputClass, useToast } from '@/components/ui';
import { admin, errorMessage } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { SOURCE_STATUS, timeAgo } from '@/lib/labels';

function AddSource({ region }: { region: SourceRegion }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [category, setCategory] = useState('');
  const [notes, setNotes] = useState('');
  const add = useMutation({
    mutationFn: () => admin.post<SourceDto>('/sources', { name, baseUrl: baseUrl.trim(), defaultCategory: category || null, notes: notes || undefined, region }),
    onSuccess: () => {
      toast('הבקשה נשלחה למפתח. האתר יופעל אחרי שהטריגר ייבנה ויאושר.');
      setName('');
      setBaseUrl('');
      setNotes('');
      setCategory('');
      void qc.invalidateQueries({ queryKey: ['sources'] });
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  return (
    <Card title={region === 'international' ? 'הוספת אתר מחו״ל' : 'הוספת אתר'}>
      <form
        className="grid gap-4 md:grid-cols-2"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <Field label="שם האתר" htmlFor="s-name">
          <input id="s-name" required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </Field>
        <Field label="קישור" htmlFor="s-url">
          <input id="s-url" type="url" dir="ltr" required placeholder="https://" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className={inputClass} />
        </Field>
        <Field label="קטגוריה עיקרית (לא חובה)" htmlFor="s-cat">
          <select id="s-cat" value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass}>
            <option value="">לפי תוכן הכתבה</option>
            {CATEGORIES.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="הערה למפתח (לא חובה)" htmlFor="s-notes">
          <input id="s-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="למשל: רק מדור הנדל״ן" className={inputClass} />
        </Field>
        <div className="md:col-span-2">
          <Button type="submit" variant="primary" busy={add.isPending}>
            שליחת בקשה למפתח
          </Button>
        </div>
      </form>
    </Card>
  );
}

function BulkAdd({ region }: { region: SourceRegion }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState('');
  const [category, setCategory] = useState('');
  const urls = text
    .split(/[\s,]+/)
    .map((u) => u.trim())
    .filter(Boolean)
    .map((u) => (/^https?:\/\//i.test(u) ? u : `https://${u}`));
  const add = useMutation({
    mutationFn: () => admin.post<{ created: { id: string }[]; skipped: { url: string; reason: string }[] }>('/sources/bulk', { urls, defaultCategory: category || null, region }),
    onSuccess: (r) => {
      toast(`${r.created.length} אתרים נוספו והמערכת מגדירה אותם אוטומטית${r.skipped.length ? ` (${r.skipped.length} כבר היו ברשימה)` : ''}.`);
      setText('');
      void qc.invalidateQueries({ queryKey: ['sources'] });
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  return (
    <Card title={region === 'international' ? 'הוספת אתרים מחו״ל' : 'הוספת כמה אתרים בבת אחת'}>
      <form
        className="space-y-4"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (urls.length) add.mutate();
        }}
      >
        <Field
          label="קישורים (אחד בכל שורה)"
          htmlFor="bulk-urls"
          hint={
            region === 'international'
              ? 'אתרי חדשות מחו״ל (אנגלית או כל שפה אחרת). המערכת מוצאת את הפיד, מזהה את השפה ובודקת. הכותרות יתורגמו לעברית אחרי כל איתור.'
              : 'לכל אתר המערכת מחפשת לבד את פיד ה-RSS או מפת האתר, מגדירה את הטריגר ובודקת אותו. אחר כך נשאר רק לאשר.'
          }
        >
          <textarea
            id="bulk-urls"
            dir="ltr"
            rows={6}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={region === 'international' ? 'https://www.reuters.com/business\nhttps://www.ft.com/markets' : 'https://www.example.co.il\nhttps://news.example.com/economy'}
            className={`${inputClass} font-mono text-sm`}
          />
        </Field>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="קטגוריה לכל האתרים (לא חובה)" htmlFor="bulk-cat">
            <select id="bulk-cat" value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass}>
              <option value="">לפי תוכן הכתבה</option>
              {CATEGORIES.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Button type="submit" variant="primary" busy={add.isPending} disabled={urls.length === 0}>
            הוספה והגדרה אוטומטית {urls.length > 1 ? `(${urls.length})` : ''}
          </Button>
        </div>
      </form>
    </Card>
  );
}
export default function SourcesPage() {
  const canRequest = useCan('editor', 'developer');
  const isDev = useCan('developer');
  const qc = useQueryClient();
  const toast = useToast();
  const [mode, setMode] = useState<'bulk' | 'one'>('bulk');
  const [region, setRegion] = useState<SourceRegion>('local');
  const sources = useQuery({
    queryKey: ['sources'],
    queryFn: () => admin.get<SourceDto[]>('/sources'),
    refetchInterval: (q) => (q.state.data?.some((s) => s.setupRunning) ? 2500 : false),
  });
  const ready = sources.data?.filter((s) => s.status === 'in_development' && s.lastTestPassedAt && !s.setupRunning) ?? [];
  const listed = sources.data?.filter((s) => s.region === region) ?? [];
  const countOf = (r: SourceRegion) => sources.data?.filter((s) => s.region === r).length ?? 0;
  const approveAll = useMutation({
    mutationFn: () => admin.post<{ approved: number }>('/sources/approve-tested'),
    onSuccess: (r) => {
      toast(`${r.approved} אתרים אושרו ונכללים מעכשיו בכל איתור.`);
      void qc.invalidateQueries({ queryKey: ['sources'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });

  return (
    <>
      <SectionTabs section="discovery" />
      <PageHeader title="הגדרות אתרים" subtitle="מוסיפים שם וקישור; המפתח בונה את הטריגר, בודק ומאשר, ומאז האתר נכלל בכל איתור." />
      <div className="mb-5 inline-flex rounded-xl bg-white p-1 ring-1 ring-line" role="tablist" aria-label="סוג האתרים">
        {(
          [
            ['local', 'אתרים בישראל'],
            ['international', 'אתרים מחו״ל'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={region === id} onClick={() => setRegion(id)} className={`rounded-lg px-5 py-2.5 text-[15px] font-extrabold ${region === id ? 'bg-brand text-white' : 'text-ink-2 hover:bg-stone'}`}>
            {label} <span className="font-semibold opacity-80">({countOf(id)})</span>
          </button>
        ))}
      </div>
      {region === 'international' && (
        <p className="mb-5 rounded-xl bg-info-soft px-5 py-3 text-[15px] text-info">
          אתרים מחו״ל נסרקים בנפרד, ב&quot;איתור כתבות&quot; ← &quot;אתרים מחו״ל&quot;. הכותרות מתורגמות לעברית אחרי כל איתור; כשכתבה עוברת לעריכה, המקור מתורגם במלואו וה-AI כותב את הכתבה החדשה בעברית.
        </p>
      )}
      <ol className="mb-6 grid gap-3 text-sm md:grid-cols-4">
        {['1. עורך/ת שולח/ת שם וקישור', '2. המפתח מגדיר/ה טריגר', '3. בדיקה על האתר האמיתי', '4. אישור: האתר פעיל באיתור'].map((s) => (
          <li key={s} className="rounded-lg bg-white px-4 py-3 font-semibold ring-1 ring-line">
            {s}
          </li>
        ))}
      </ol>
      {isDev && ready.length > 0 ? (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl bg-ok-soft px-5 py-4 text-ok">
          <b>{ready.length} אתרים הוגדרו ועברו בדיקה, ומחכים לאישור.</b>
          <Button variant="dark" className="mr-auto" busy={approveAll.isPending} onClick={() => approveAll.mutate()}>
            אישור כולם
          </Button>
        </div>
      ) : null}
      {canRequest && (
        <>
          <div className="mb-3 inline-flex rounded-lg bg-white p-1 ring-1 ring-line" role="tablist">
            {(
              [
                ['bulk', 'רשימת קישורים'],
                ['one', 'אתר אחד'],
              ] as const
            ).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={mode === id} onClick={() => setMode(id)} className={`rounded-md px-4 py-2 font-bold ${mode === id ? 'bg-ink text-white' : 'text-ink-2 hover:bg-stone'}`}>
                {label}
              </button>
            ))}
          </div>
          {mode === 'bulk' ? <BulkAdd key={region} region={region} /> : <AddSource key={region} region={region} />}
        </>
      )}
      <div className="mt-6">
        {sources.isPending ? (
          <Loading />
        ) : sources.isError ? (
          <ErrorBox error={sources.error} onRetry={() => sources.refetch()} />
        ) : listed.length === 0 ? (
          <Empty title={region === 'international' ? 'עוד אין אתרים מחו״ל' : 'עוד אין אתרים'} />
        ) : (
          <div className="overflow-hidden rounded-xl bg-white ring-1 ring-line">
            <table className="w-full text-right">
              <thead className="bg-stone text-sm text-ink-2">
                <tr>
                  <th className="px-4 py-3">אתר</th>
                  <th className="px-4 py-3">מצב</th>
                  <th className="px-4 py-3">שיטה</th>
                  <th className="px-4 py-3">איתור מוצלח אחרון</th>
                  <th className="px-4 py-3">ביקש/ה</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {listed.map((s) => (
                  <tr key={s.id} className="hover:bg-canvas">
                    <td className="px-4 py-3">
                      <Link href={`/sources/${s.id}`} className="font-bold hover:text-brand hover:underline">
                        {s.name}
                      </Link>
                      <p className="max-w-md truncate text-xs text-muted" dir="ltr">
                        {s.language ? `${s.language.toUpperCase()} · ` : ''}
                        {s.baseUrl}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      {s.setupRunning ? (
                        <Badge tone="info">מגדיר אוטומטית…</Badge>
                      ) : s.status === 'in_development' && s.lastTestPassedAt ? (
                        <Badge tone="ok">מוכן לאישור</Badge>
                      ) : (
                        <Badge tone={SOURCE_STATUS[s.status].tone}>{SOURCE_STATUS[s.status].label}</Badge>
                      )}
                      {s.consecutiveFailures > 0 && <span className="mr-2 text-xs text-brand">{s.consecutiveFailures} כשלונות</span>}
                      {!s.setupRunning && s.status !== 'active' && s.devNotes ? <p className="mt-1 max-w-xs truncate text-xs text-muted" title={s.devNotes}>{s.devNotes}</p> : null}
                    </td>
                    <td className="px-4 py-3 text-sm uppercase text-muted">{s.method ?? '—'}</td>
                    <td className="px-4 py-3 text-sm">{timeAgo(s.lastSuccessAt)}</td>
                    <td className="px-4 py-3 text-sm">{s.requestedBy ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
