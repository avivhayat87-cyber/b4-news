'use client';
// "העלאה ידנית" > "מקישור או צילום מסך": a link or screenshots go to the research reporter (or,
// for a link, to the plain rewrite as before). Before anything is paid for, a free check for a
// story we already have; under the form, the recent research and where each one stands.
import { DRAFT_COLORS, RESEARCH_DEPTHS, type DraftColor, type MediaDto, type ResearchDepth, type ResearchOverviewDto, type ResearchTaskDto, type SavedEdits, type SimilarStoryDto } from '@b4/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { UploadButton } from '@/components/image-upload';
import { Badge, Button, Card, ColorDot, Empty, Field, Spinner, Thumb, cx, inputClass, useToast } from '@/components/ui';
import { admin, errorMessage } from '@/lib/api';
import { COLOR, RESEARCH_DEPTH, RESEARCH_STATUS, timeAgo } from '@/lib/labels';

/** "שכתוב בלבד": the link's article rewritten as before, no research (a link only). */
type Depth = ResearchDepth | 'rewrite';
const ACTIVE = ['queued', 'researching', 'writing'];

export function ColorPicker({ value, onChange }: { value: DraftColor; onChange(c: DraftColor): void }) {
  return (
    <div className="flex gap-1.5" role="radiogroup" aria-label="צבע">
      {DRAFT_COLORS.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={COLOR[c]} title={COLOR[c]} onClick={() => onChange(c)} className={cx('rounded-full p-1.5', value === c && 'ring-2 ring-ink')}>
          <ColorDot color={c} className="size-4" />
        </button>
      ))}
    </div>
  );
}

export function Destination({ magazineId, setMagazineId }: { magazineId: string; setMagazineId(v: string): void }) {
  const saved = useQuery({ queryKey: ['saved'], queryFn: () => admin.get<SavedEdits>('/saved') });
  const open = saved.data?.magazines.filter((m) => !['published', 'publishing', 'archived'].includes(m.status)) ?? [];
  return (
    <Field label="לאן לשמור" htmlFor="dest">
      <select id="dest" value={magazineId} onChange={(e) => setMagazineId(e.target.value)} className={inputClass}>
        <option value="">כתבה בודדת (בעריכות השמורות)</option>
        {open.map((m) => (
          <option key={m.id} value={m.id}>
            להוסיף למגזין: {m.title}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** Stories we already have that look like this one: open the existing one instead of writing again. */
function SimilarWarning({ items, title }: { items: SimilarStoryDto[]; title: string }) {
  if (!items.length) return null;
  return (
    <div className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn" role="status">
      <p className="font-bold">{title}</p>
      <p className="mt-0.5 text-ink-2">אפשר לפתוח את הקיימת ולעדכן אותה, במקום לכתוב כתבה חדשה.</p>
      <ul className="mt-2 space-y-1">
        {items.map((x) => (
          <li key={`${x.kind}-${x.id}`}>
            {x.kind === 'article' ? (
              <a href={x.href} target="_blank" rel="noopener noreferrer" className="font-semibold text-ink underline">
                {x.title} (באתר) ↗
              </a>
            ) : (
              <Link href={x.href} className="font-semibold text-ink underline">
                {x.title} (בעריכה)
              </Link>
            )}{' '}
            <span className="text-muted">· {timeAgo(x.at)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DepthPicker({ value, onChange, link }: { value: Depth; onChange(d: Depth): void; link: boolean }) {
  const options: { id: Depth; name: string; about: string; cost: string }[] = [
    ...(link ? [{ id: 'rewrite' as const, name: 'שכתוב בלבד', about: 'בלי תחקיר: הכתבה מהקישור נכתבת מחדש, כמו בכתבות מהאיתור.', cost: 'בערך 2 סנט' }] : []),
    ...RESEARCH_DEPTHS.map((d) => ({ id: d, ...RESEARCH_DEPTH[d] })),
  ];
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4" role="radiogroup" aria-label="עומק התחקיר">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={cx('rounded-lg p-3 text-right ring-1 transition-colors', value === o.id ? 'bg-ink text-white ring-ink' : 'bg-white ring-line hover:bg-stone')}
        >
          <span className="block font-bold">{o.name}</span>
          <span className={cx('mt-0.5 block text-xs', value === o.id ? 'text-white/80' : 'text-muted')}>{o.about}</span>
          <span className={cx('mt-1 block text-xs font-semibold', value === o.id ? 'text-white' : 'text-ink-2')}>{o.cost}</span>
        </button>
      ))}
    </div>
  );
}

function ResearchForm({ overview, mode }: { overview: ResearchOverviewDto; mode: 'report' | 'idea' }) {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const [kind, setKind] = useState<'link' | 'screenshot'>('link');
  const [url, setUrl] = useState('');
  const [shots, setShots] = useState<MediaDto[]>([]);
  const [note, setNote] = useState('');
  const [depth, setDepth] = useState<Depth>(overview.defaultDepth);
  const [color, setColor] = useState<DraftColor>('purple');
  const [magazineId, setMagazineId] = useState('');
  const idea = mode === 'idea';
  const link = !idea && kind === 'link';
  const chosen: Depth = !link && depth === 'rewrite' ? overview.defaultDepth : depth;

  // The free check, a moment after the link or the idea is typed: no AI, only what we already have.
  const typed = (idea ? note : url).trim();
  const [checked, setChecked] = useState('');
  useEffect(() => {
    if (idea ? typed.length < 10 : !link || !/^https?:\/\/\S+\.\S+/.test(typed)) return;
    const t = setTimeout(() => setChecked(typed), idea ? 1200 : 600);
    return () => clearTimeout(t);
  }, [typed, idea, link]);
  const similar = useQuery({
    queryKey: ['research-similar', idea, checked],
    queryFn: () => admin.post<SimilarStoryDto[]>('/research/similar', idea ? { text: checked } : { url: checked }),
    enabled: (idea || link) && Boolean(checked) && checked === typed,
  });

  const budgetLeft = overview.budgetUsd - overview.spentUsd;
  const create = useMutation({
    mutationFn: async () => {
      const dest = { colorLabel: magazineId ? undefined : color, magazineId: magazineId || undefined };
      if (chosen === 'rewrite') return { draftId: (await admin.post<{ draftId: string }>('/manual/url', { url: url.trim(), ...dest })).draftId };
      const task = await admin.post<ResearchTaskDto>('/research', {
        kind: idea ? 'idea' : kind,
        ...(idea ? {} : link ? { url: url.trim() } : { mediaIds: shots.map((m) => m.id) }),
        note: note.trim(),
        depth: chosen,
        ...dest,
      });
      return { task };
    },
    onSuccess: (r) => {
      if ('draftId' in r) {
        toast('הכתבה נקלטה. ה-AI כותב טיוטה.');
        router.push(`/drafts/${r.draftId}`);
        return;
      }
      toast('הכתב-החוקר התחיל לעבוד. זה לוקח דקה-שתיים; אפשר להמשיך בינתיים.');
      setUrl('');
      setShots([]);
      setNote('');
      setChecked('');
      void qc.invalidateQueries({ queryKey: ['research'] });
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  const ready = idea ? note.trim().length >= 10 : link ? Boolean(url.trim()) : shots.length > 0;

  return (
    <Card title={idea ? 'רעיון לתחקיר' : 'מקישור או צילום מסך'}>
      <form
        className="space-y-5"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        {idea ? (
          <div className="space-y-3">
            <Field label="הרעיון" htmlFor="r-idea" hint="שאלה או נושא לבדוק, במשפט או שניים. הכתב-החוקר מחפש את הנתונים והמקורות הרשמיים מאפס.">
              <textarea id="r-idea" rows={3} maxLength={3000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="למשל: כמה עולה היום משכנתא ממוצעת לעומת לפני שנה?" className={inputClass} />
            </Field>
            {similar.isFetching && (
              <p className="flex items-center gap-2 text-sm text-muted">
                <Spinner small /> בודק אם כבר כתבנו על זה…
              </p>
            )}
            <SimilarWarning items={similar.data ?? []} title="ייתכן שכבר כתבנו על זה" />
          </div>
        ) : (
        <div className="inline-flex rounded-lg bg-stone p-1" role="tablist" aria-label="מה יש לכם">
          {(
            [
              ['link', 'קישור'],
              ['screenshot', 'צילומי מסך'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={kind === id} onClick={() => setKind(id)} className={cx('rounded-md px-4 py-1.5 text-sm font-bold', kind === id ? 'bg-white text-ink shadow-sm' : 'text-ink-2')}>
              {label}
            </button>
          ))}
        </div>
        )}

        {idea ? null : link ? (
          <div className="space-y-3">
            <Field label="קישור" htmlFor="r-url" hint="כתבה, הודעה רשמית, פוסט ב-X או בטלגרם.">
              <input id="r-url" type="url" dir="ltr" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" className={inputClass} />
            </Field>
            {similar.isFetching && (
              <p className="flex items-center gap-2 text-sm text-muted">
                <Spinner small /> בודק אם כבר יש לנו את הכתבה…
              </p>
            )}
            <SimilarWarning items={similar.data ?? []} title="כבר יש לנו כתבה מהקישור הזה" />
          </div>
        ) : (
          <Field label="צילומי מסך" hint="עד 4 צילומים: טלגרם, X, וואטסאפ או אתר. הכתב-החוקר קורא את הטקסט שבהם ומחפש את המקור.">
            <div className="flex flex-wrap items-start gap-3">
              {shots.map((m) => (
                <div key={m.id} className="relative">
                  <Thumb src={m.url} className="h-28 w-20 object-cover object-top" />
                  <button type="button" onClick={() => setShots((xs) => xs.filter((x) => x.id !== m.id))} className="absolute -left-2 -top-2 rounded-full bg-white px-1.5 text-sm font-bold text-danger ring-1 ring-line" aria-label="הסרת הצילום">
                    ×
                  </button>
                </div>
              ))}
              {shots.length < 4 && <UploadButton label={shots.length ? 'עוד צילום' : 'העלאת צילום מסך'} onUploaded={(m) => setShots((xs) => [...xs, m])} />}
            </div>
          </Field>
        )}

        {!idea && chosen !== 'rewrite' && (
          <Field label="מה לבדוק במיוחד (לא חובה)" htmlFor="r-note" hint="למשל: &quot;תבדוק את המספר&quot;, &quot;מי החברה&quot;. ההערה היא כיוון לחקירה, לא עובדה.">
            <textarea id="r-note" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} />
          </Field>
        )}

        <Field label="עומק">
          <DepthPicker value={chosen} onChange={setDepth} link={link} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Destination magazineId={magazineId} setMagazineId={setMagazineId} />
          {!magazineId && (
            <Field label="צבע">
              <ColorPicker value={color} onChange={setColor} />
            </Field>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" variant="primary" busy={create.isPending} disabled={!ready || (chosen !== 'rewrite' && budgetLeft <= 0)}>
            {chosen === 'rewrite' ? 'קליטה ומעבר לעריכה' : 'התחלת תחקיר'}
          </Button>
          <span className={cx('text-sm', budgetLeft <= 0 ? 'font-bold text-danger' : 'text-muted')}>
            {budgetLeft <= 0 ? 'התקציב החודשי לתחקירים נגמר.' : `תחקירים החודש: $${overview.spentUsd.toFixed(2)} מתוך $${overview.budgetUsd}`}
          </span>
        </div>
      </form>
    </Card>
  );
}

function TaskRow({ task }: { task: ResearchTaskDto }) {
  const qc = useQueryClient();
  const toast = useToast();
  const retry = useMutation({
    mutationFn: () => admin.post(`/research/${task.id}/retry`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['research'] }),
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  const status = RESEARCH_STATUS[task.status];
  const working = ACTIVE.includes(task.status);
  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={status.tone}>
          {working && <Spinner small />} {status.label}
        </Badge>
        <span className="min-w-0 flex-1 truncate font-semibold">{task.title}</span>
        {task.draftId && (
          <Link href={`/drafts/${task.draftId}`} className="rounded-lg bg-ink px-3 py-1 text-sm font-bold text-white">
            לעריכה
          </Link>
        )}
        {task.status === 'failed' && (
          <Button size="sm" busy={retry.isPending} onClick={() => retry.mutate()}>
            לנסות שוב
          </Button>
        )}
      </div>
      <p className="text-xs text-muted">
        {task.kind === 'link' ? 'מקישור' : task.kind === 'idea' ? 'מרעיון' : `מ-${task.screenshots.length} צילומי מסך`} · {RESEARCH_DEPTH[task.depth].name} · {task.createdBy} · {timeAgo(task.createdAt)}
        {task.status === 'done' && ` · ${task.searches} חיפושים · $${task.costUsd.toFixed(2)}`}
      </p>
      {task.error && <p className="text-sm text-danger">{task.error}</p>}
      {task.status === 'done' && !task.official && <p className="text-sm font-semibold text-danger">לא נמצא מקור רשמי: הכתבה נשענת על דיווחים בלבד.</p>}
      <SimilarWarning items={task.similar} title="ייתכן שכבר יש לנו את הסיפור הזה" />
    </li>
  );
}

/** report: a link or screenshots to check; idea: the newsroom's own question. Both list all recent research. */
export function ResearchTab({ mode = 'report' }: { mode?: 'report' | 'idea' }) {
  const overview = useQuery({
    queryKey: ['research'],
    queryFn: () => admin.get<ResearchOverviewDto>('/research'),
    refetchInterval: (q) => (q.state.data?.tasks.some((t) => ACTIVE.includes(t.status)) ? 4000 : false),
  });
  if (!overview.data) return overview.isError ? <p className="text-danger">{errorMessage(overview.error)}</p> : <Spinner />;
  return (
    <div className="space-y-6">
      <ResearchForm key={mode} overview={overview.data} mode={mode} />
      <Card title="תחקירים אחרונים">
        {overview.data.tasks.length ? (
          <ul className="-my-3 divide-y divide-line">
            {overview.data.tasks.map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
          </ul>
        ) : (
          <Empty title="עוד אין תחקירים">כאן יופיעו התחקירים, עם הסטטוס והקישור לכתבה.</Empty>
        )}
      </Card>
    </div>
  );
}
