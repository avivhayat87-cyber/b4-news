'use client';
// The developer's side of site settings: build the trigger, test it against the
// live site, approve it. Editors see the status and the test results.
import { CATEGORIES, SCRAPE_METHODS, type ConfigureSourceInput, type ScrapeMethod, type SourceDto, type SourceTestResult } from '@b4/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { use, useEffect, useState } from 'react';
import { Badge, Button, Card, ErrorBox, Field, Loading, PageHeader, cx, inputClass, useToast } from '@/components/ui';
import { admin, errorMessage } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { SOURCE_STATUS, formatDateTime, timeAgo } from '@/lib/labels';

type Form = {
  method: ScrapeMethod;
  listUrls: string;
  defaultCategory: string;
  scrapeIntervalMin: number;
  devNotes: string;
  item: string;
  link: string;
  title: string;
  publishedAt: string;
  maxItems: number;
  readArticle: boolean;
  aTitle: string;
  aIntro: string;
  aBody: string;
  aImage: string;
  aDate: string;
  aRemove: string;
  rules: { urlContains: string; category: string }[];
};

function toForm(s: SourceDto): Form {
  const c = s.selectorConfig;
  return {
    method: s.method ?? 'rss',
    listUrls: (s.listUrls.length ? s.listUrls : [s.baseUrl]).join('\n'),
    defaultCategory: s.defaultCategory ?? '',
    scrapeIntervalMin: s.scrapeIntervalMin,
    devNotes: s.devNotes ?? '',
    item: c?.list.item ?? '',
    link: c?.list.link ?? '',
    title: c?.list.title ?? '',
    publishedAt: c?.list.publishedAt ?? '',
    maxItems: c?.list.maxItems ?? 40,
    readArticle: Boolean(c?.article) || !c,
    aTitle: c?.article?.title ?? '',
    aIntro: c?.article?.intro ?? '',
    aBody: c?.article?.body ?? '',
    aImage: c?.article?.image ?? '',
    aDate: c?.article?.publishedAt ?? '',
    aRemove: c?.article?.remove.join(', ') ?? '',
    rules: c?.categoryRules ?? [],
  };
}

const opt = (v: string) => (v.trim() ? v.trim() : undefined);

function toInput(f: Form): ConfigureSourceInput {
  return {
    method: f.method,
    listUrls: f.listUrls.split('\n').map((u) => u.trim()).filter(Boolean),
    defaultCategory: (f.defaultCategory || null) as ConfigureSourceInput['defaultCategory'],
    scrapeIntervalMin: f.scrapeIntervalMin,
    devNotes: f.devNotes || null,
    selectorConfig: {
      list: { item: opt(f.item), link: opt(f.link), title: opt(f.title), publishedAt: opt(f.publishedAt), maxItems: f.maxItems },
      article: f.readArticle
        ? { title: opt(f.aTitle), intro: opt(f.aIntro), body: opt(f.aBody), image: opt(f.aImage), publishedAt: opt(f.aDate), remove: f.aRemove.split(',').map((x) => x.trim()).filter(Boolean) }
        : undefined,
      categoryRules: f.rules.filter((r) => r.urlContains.trim() && r.category) as ConfigureSourceInput['selectorConfig']['categoryRules'],
    },
  };
}

function TestResults({ r }: { r: SourceTestResult }) {
  return (
    <div className="space-y-4">
      <Badge tone={r.ok ? 'ok' : 'danger'}>{r.ok ? 'הבדיקה עברה' : 'הבדיקה נכשלה'}</Badge>
      {r.errors.length > 0 && (
        <ul className="list-disc space-y-1 pr-5 text-sm text-brand-deep">
          {r.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {r.items.length > 0 && (
        <div>
          <p className="mb-1 text-sm font-bold">{r.items.length} כתבות ברשימה (מוצגות עד 15):</p>
          <ul className="divide-y divide-line-soft rounded-lg ring-1 ring-line">
            {r.items.map((i) => (
              <li key={i.url} className="px-3 py-2 text-sm">
                <p className="font-semibold">{i.title}</p>
                <p className="text-xs text-muted" dir="ltr">
                  {i.publishedAt ? formatDateTime(i.publishedAt) : 'ללא תאריך'} · {i.url}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
      {r.article && (
        <div className="rounded-lg bg-stone p-4">
          <p className="text-sm font-bold text-muted">כך נקראה הכתבה הראשונה:</p>
          <p className="mt-1 font-display text-lg font-extrabold">{r.article.title}</p>
          {r.article.intro && <p className="mt-1 font-semibold text-ink-2">{r.article.intro}</p>}
          <p className="mt-2 line-clamp-6 whitespace-pre-line text-sm text-ink-2">{r.article.bodyText}</p>
          <p className="mt-2 text-xs text-muted">{r.article.bodyText.length} תווים בגוף הכתבה</p>
        </div>
      )}
    </div>
  );
}

export default function SourcePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const toast = useToast();
  const isDev = useCan('developer');
  const sources = useQuery({ queryKey: ['sources'], queryFn: () => admin.get<SourceDto[]>('/sources') });
  const source = sources.data?.find((s) => s.id === id);
  const [form, setForm] = useState<Form | null>(null);
  const [result, setResult] = useState<SourceTestResult | null>(null);
  useEffect(() => {
    if (source && !form) setForm(toForm(source));
  }, [source, form]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const refresh = () => void qc.invalidateQueries({ queryKey: ['sources'] });
  const onError = (e: unknown) => toast(errorMessage(e), 'danger');
  const save = useMutation({ mutationFn: () => admin.put<SourceDto>(`/sources/${id}/config`, toInput(form!)), onSuccess: () => { toast('ההגדרה נשמרה. הריצו בדיקה לפני האישור.'); refresh(); }, onError });
  const test = useMutation({ mutationFn: () => admin.post<SourceTestResult>(`/sources/${id}/test`, toInput(form!)), onSuccess: (r) => { setResult(r); refresh(); }, onError });
  const approve = useMutation({ mutationFn: () => admin.post<SourceDto>(`/sources/${id}/approve`), onSuccess: () => { toast('האתר אושר ופעיל באיתור.'); refresh(); }, onError });
  const status = useMutation({ mutationFn: (s: 'active' | 'paused' | 'archived') => admin.post<SourceDto>(`/sources/${id}/status`, { status: s }), onSuccess: refresh, onError });

  if (sources.isPending) return <Loading />;
  if (sources.isError) return <ErrorBox error={sources.error} />;
  if (!source || !form) return <ErrorBox error={new Error('האתר לא נמצא')} />;
  const st = SOURCE_STATUS[source.status];

  return (
    <>
      <PageHeader
        title={source.name}
        subtitle={
          <span dir="ltr" className="inline-block">
            {source.baseUrl}
          </span>
        }
        actions={
          <>
            <Badge tone={st.tone}>{st.label}</Badge>
            {isDev && source.status === 'active' && (
              <Button size="sm" onClick={() => status.mutate('paused')}>
                השהיה
              </Button>
            )}
            {isDev && (source.status === 'paused' || source.status === 'broken') && source.approvedAt && (
              <Button size="sm" onClick={() => status.mutate('active')}>
                הפעלה מחדש
              </Button>
            )}
            {isDev && source.status !== 'archived' && (
              <Button size="sm" variant="ghost" onClick={() => confirm('להעביר לארכיון? האתר לא ייכלל באיתורים.') && status.mutate('archived')}>
                לארכיון
              </Button>
            )}
          </>
        }
      />

      <div className="mb-6 grid gap-3 text-sm md:grid-cols-4">
        <div className="rounded-lg bg-white p-3 ring-1 ring-line">ביקש/ה: <b>{source.requestedBy ?? '—'}</b></div>
        <div className="rounded-lg bg-white p-3 ring-1 ring-line">בדיקה אחרונה שעברה: <b>{timeAgo(source.lastTestPassedAt)}</b></div>
        <div className="rounded-lg bg-white p-3 ring-1 ring-line">אושר: <b>{source.approvedAt ? `${formatDateTime(source.approvedAt)} · ${source.approvedBy ?? ''}` : 'עוד לא'}</b></div>
        <div className="rounded-lg bg-white p-3 ring-1 ring-line">איתור מוצלח אחרון: <b>{timeAgo(source.lastSuccessAt)}</b></div>
      </div>

      {!isDev ? (
        <Card title="מה קורה עכשיו">
          <p className="text-ink-2">
            {source.status === 'pending_dev'
              ? 'הבקשה ממתינה למפתח. הוא יגדיר איך לקרוא את האתר ויאשר אותו.'
              : source.status === 'in_development'
                ? 'המפתח עובד על הטריגר של האתר.'
                : source.status === 'active'
                  ? 'האתר פעיל ונכלל בכל איתור.'
                  : 'האתר לא נכלל באיתורים כרגע.'}
          </p>
          {source.devNotes && <p className="mt-3 rounded-lg bg-stone p-3 text-sm">הערות: {source.devNotes}</p>}
        </Card>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Card title="הגדרת הטריגר">
            <div className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="שיטה" htmlFor="m">
                  <select id="m" value={form.method} onChange={(e) => set('method', e.target.value as ScrapeMethod)} className={inputClass}>
                    {SCRAPE_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m === 'rss' ? 'RSS / Atom' : m === 'sitemap' ? 'Sitemap (חדשות)' : 'עמוד רשימה (HTML)'}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="קטגוריה ברירת מחדל" htmlFor="dc">
                  <select id="dc" value={form.defaultCategory} onChange={(e) => set('defaultCategory', e.target.value)} className={inputClass}>
                    <option value="">לפי תוכן הכתבה</option>
                    {CATEGORIES.map((c) => (
                      <option key={c.slug} value={c.slug}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="כתובות רשימה (אחת בכל שורה)" htmlFor="lu" hint="פיד RSS, sitemap, או עמוד מדור שמציג את הכתבות האחרונות.">
                <textarea id="lu" dir="ltr" rows={3} value={form.listUrls} onChange={(e) => set('listUrls', e.target.value)} className={cx(inputClass, 'font-mono text-sm')} />
              </Field>

              {form.method === 'html' && (
                <fieldset className="grid gap-3 rounded-lg bg-stone p-4 md:grid-cols-2">
                  <legend className="mb-1 font-bold">סלקטורים בעמוד הרשימה</legend>
                  {(
                    [
                      ['item', 'פריט (כרטיס כתבה)', '.story-list .story'],
                      ['link', 'קישור בתוך הפריט', 'a.title'],
                      ['title', 'כותרת (לא חובה)', 'h3'],
                      ['publishedAt', 'תאריך (לא חובה)', 'time'],
                    ] as const
                  ).map(([k, label, ph]) => (
                    <Field key={k} label={label} htmlFor={`l-${k}`}>
                      <input id={`l-${k}`} dir="ltr" value={form[k]} placeholder={ph} onChange={(e) => set(k, e.target.value)} className={cx(inputClass, 'font-mono text-sm')} />
                    </Field>
                  ))}
                </fieldset>
              )}

              <fieldset className="space-y-3 rounded-lg bg-stone p-4">
                <legend className="font-bold">עמוד הכתבה</legend>
                <label className="flex items-center gap-2 text-sm font-semibold">
                  <input type="checkbox" checked={form.readArticle} onChange={(e) => set('readArticle', e.target.checked)} />
                  לפתוח כל כתבה ולקרוא את הטקסט המלא (מומלץ)
                </label>
                {form.readArticle && (
                  <div className="grid gap-3 md:grid-cols-2">
                    {(
                      [
                        ['aTitle', 'כותרת', 'h1'],
                        ['aIntro', 'פתיח', '.subtitle'],
                        ['aBody', 'גוף הכתבה', '.article-body'],
                        ['aImage', 'תמונה', 'meta[property="og:image"]'],
                        ['aDate', 'תאריך', 'time[datetime]'],
                        ['aRemove', 'להסיר (מופרד בפסיק)', '.ad, .related'],
                      ] as const
                    ).map(([k, label, ph]) => (
                      <Field key={k} label={label} htmlFor={`a-${k}`}>
                        <input id={`a-${k}`} dir="ltr" value={form[k]} placeholder={ph} onChange={(e) => set(k, e.target.value)} className={cx(inputClass, 'font-mono text-sm')} />
                      </Field>
                    ))}
                    <p className="text-xs text-muted md:col-span-2">שדה ריק = זיהוי אוטומטי (תגיות og, הכותרת הראשית והבלוק עם הכי הרבה טקסט).</p>
                  </div>
                )}
              </fieldset>

              <fieldset className="space-y-2">
                <legend className="mb-1 font-bold">כללי קטגוריה לפי כתובת</legend>
                {form.rules.map((r, i) => (
                  <div key={i} className="flex gap-2">
                    <input dir="ltr" value={r.urlContains} placeholder="/real-estate/" onChange={(e) => set('rules', form.rules.map((x, j) => (j === i ? { ...x, urlContains: e.target.value } : x)))} className={cx(inputClass, 'font-mono text-sm')} aria-label="הכתובת מכילה" />
                    <select value={r.category} onChange={(e) => set('rules', form.rules.map((x, j) => (j === i ? { ...x, category: e.target.value } : x)))} className={inputClass} aria-label="קטגוריה">
                      <option value="">קטגוריה</option>
                      {CATEGORIES.map((c) => (
                        <option key={c.slug} value={c.slug}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <Button variant="ghost" onClick={() => set('rules', form.rules.filter((_, j) => j !== i))} aria-label="הסרת כלל">
                      ×
                    </Button>
                  </div>
                ))}
                <Button size="sm" variant="ghost" onClick={() => set('rules', [...form.rules, { urlContains: '', category: '' }])}>
                  + כלל
                </Button>
              </fieldset>

              <div className="grid gap-4 md:grid-cols-2">
                <Field label="מקסימום כתבות בכל איתור" htmlFor="mx">
                  <input id="mx" type="number" min={1} max={200} value={form.maxItems} onChange={(e) => set('maxItems', Number(e.target.value))} className={inputClass} />
                </Field>
                <Field label="הערות פיתוח" htmlFor="dn">
                  <input id="dn" value={form.devNotes} onChange={(e) => set('devNotes', e.target.value)} className={inputClass} />
                </Field>
              </div>

              <div className="flex flex-wrap gap-2 border-t border-line-soft pt-4">
                <Button busy={test.isPending} onClick={() => test.mutate()}>
                  בדיקה על האתר
                </Button>
                <Button variant="dark" busy={save.isPending} onClick={() => save.mutate()}>
                  שמירת ההגדרה
                </Button>
                {source.status !== 'active' && (
                  <Button variant="primary" className="mr-auto" busy={approve.isPending} onClick={() => approve.mutate()} disabled={!source.lastTestPassedAt}>
                    אישור והפעלה
                  </Button>
                )}
              </div>
              {!source.lastTestPassedAt && source.method && <p className="text-xs text-muted">כדי לאשר: שמרו את ההגדרה, והריצו בדיקה מוצלחת על ההגדרה השמורה.</p>}
            </div>
          </Card>
          <Card title="תוצאות הבדיקה">{result ? <TestResults r={result} /> : <p className="text-muted">הריצו בדיקה כדי לראות מה הטריגר מוצא ואיך הכתבה נקראת.</p>}</Card>
        </div>
      )}
    </>
  );
}
