'use client';
// "Preview magazine" and final approval: everything that will go out, with the date, the editor's
// name and the tags, and what the agents chose (the place on the site, the ticker, the main image),
// each changeable here in one click. The approval draws the chosen images at full quality, then the
// site first, the networks after. What isn't ready waits in "נתקעו בפרסום" instead of stopping the rest.
import { PLACEMENTS, type Placement, type PreviewItem, type PublishJobDto, type PublishPreview } from '@b4/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { SITE_URL, admin, errorMessage, idempotencyKey } from '@/lib/api';
import { MISSING_STEP, PLACEMENT, PLATFORM, categoryName, formatDateTime } from '@/lib/labels';
import { Badge, Button, Card, ErrorBox, LinkButton, Loading, PageHeader, Thumb, cx, inputClass, useToast } from './ui';

const STEP_LABEL = (key: string) => {
  if (key === 'revalidate') return 'רענון האתר';
  const [, kind, ...rest] = key.split(':');
  if (kind === 'site') return 'פרסום באתר';
  if (kind === 'image') return 'התמונה באיכות מלאה';
  if (kind === 'push') return 'התראת פוש';
  if (kind === 'social') return 'רשתות חברתיות';
  return `${PLATFORM[kind as keyof typeof PLATFORM] ?? kind}${rest.length ? ` · ${rest.join(':')}` : ''}`;
};

/** The steps in the order they happen: per article the image, the site, the push and the networks; the site's refresh last. */
const STEP_ORDER = ['image', 'site', 'push', 'social'];
const stepRank = (key: string) => (key === 'revalidate' ? 99 : (STEP_ORDER.indexOf(key.split(':')[1] ?? '') + 1 || 50));

const stepTone = (v: string) => (v === 'ok' || v.startsWith('ok') || v === 'updated' ? 'ok' : v === 'prepared' || v.startsWith('held') ? 'warn' : v.startsWith('plan') ? 'ok' : 'danger');
const stepWord = (v: string) => (v === 'ok' || v.startsWith('ok') || v === 'updated' || v.startsWith('plan') ? 'בוצע' : v === 'prepared' ? 'הוכן' : v.startsWith('held') ? 'נתקעה' : 'נכשל');

export function PublishPreviewScreen({ target, backHref, backLabel }: { target: { magazineId: string } | { draftId: string }; backHref: string; backLabel: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const base = 'magazineId' in target ? `/magazines/${target.magazineId}` : `/drafts/${target.draftId}`;
  const preview = useQuery({ queryKey: ['preview', base], queryFn: () => admin.get<PublishPreview>(`${base}/preview`) });
  const [jobId, setJobId] = useState<string | null>(null);
  const [key] = useState(idempotencyKey);
  const job = useQuery({
    queryKey: ['publish-job', jobId],
    queryFn: () => admin.get<PublishJobDto>(`/publish-jobs/${jobId}`),
    enabled: !!jobId,
    refetchInterval: (q) => (q.state.data && ['succeeded', 'failed'].includes(q.state.data.status) ? false : 1500),
  });
  const publish = useMutation({
    mutationFn: () => admin.post<{ publishJobId: string }>(`${base}/publish`, { idempotencyKey: key }),
    onSuccess: (r) => setJobId(r.publishJobId),
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  // A change of place, ticker or main image, right here: nothing is drawn or paid for until the approval.
  const change = useMutation({
    mutationFn: ({ draftId, patch }: { draftId: string; patch: Record<string, unknown> }) => admin.patch(`/drafts/${draftId}`, patch),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['preview', base] }),
    onError: (e) => toast(errorMessage(e), 'danger'),
  });

  const finished = job.data && ['succeeded', 'failed'].includes(job.data.status);
  useEffect(() => {
    if (finished) {
      void qc.invalidateQueries({ queryKey: ['saved'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    }
  }, [finished, qc]);

  if (preview.isPending) return <Loading />;
  if (preview.isError) return <ErrorBox error={preview.error} onRetry={() => preview.refetch()} />;
  const p = preview.data;
  const pending = p.items.filter((i) => i.draft.status !== 'skipped' && i.draft.status !== 'published');
  const blocked = pending.filter((i) => i.missing.length > 0);
  const ready = pending.length - blocked.length;
  const done = finished;
  const fixMode = 'magazineId' in target ? target.magazineId : null;
  const fixHref = (draftId: string) => (fixMode ? `/drafts/${draftId}?fix=${fixMode}` : `/drafts/${draftId}`);
  const held = Object.entries(job.data?.steps ?? {}).filter(([k, v]) => k.endsWith(':site') && (v.startsWith('held') || v.startsWith('failed')));

  return (
    <>
      <PageHeader
        title="תצוגה מקדימה ואישור סופי"
        subtitle={`${pending.length} כתבות לפרסום · ${p.skippedCount} לא לפרסום · תאריך: ${formatDateTime(p.publishDate)} · עורך/ת: ${p.editorName}`}
        actions={<Link href={backHref} className="font-semibold text-ink-2 hover:text-brand">→ {backLabel}</Link>}
      />

      {jobId ? (
        <Card title={done ? (job.data?.status === 'succeeded' ? 'הפרסום הושלם' : 'הפרסום נכשל') : 'מפרסם…'}>
          <p className="mb-3 text-ink-2">קודם התמונות באיכות מלאה, אחר כך האתר, ואחריו הרשתות החברתיות.</p>
          <ul className="space-y-1.5">
            {Object.entries(job.data?.steps ?? {})
              .sort(([a], [b]) => {
                const article = (k: string) => p.items.findIndex((i) => k.startsWith(i.draft.id));
                return article(a) - article(b) || stepRank(a) - stepRank(b);
              })
              .map(([k, v]) => (
              <li key={k} className="flex flex-wrap items-center gap-3">
                <Badge tone={stepTone(v)}>{stepWord(v)}</Badge>
                <span className="font-semibold">{p.items.find((i) => k.startsWith(i.draft.id))?.draft.title ?? ''}</span>
                <span className="text-sm text-muted">{STEP_LABEL(k)}</span>
                {(v.startsWith('failed') || v.startsWith('held')) && <span className="text-xs text-brand">{v.replace(/^(failed|held): /, '')}</span>}
              </li>
            ))}
          </ul>
          {!done && <p className="mt-3 text-sm text-muted">יצירת התמונות באיכות מלאה לוקחת כחצי דקה.</p>}
          {done && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <a href={SITE_URL} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand hover:underline">
                לצפייה באתר ↗
              </a>
              {held.length > 0 && (
                <>
                  <span className="text-sm font-semibold text-warn">
                    {held.length === 1 ? 'כתבה אחת נתקעה ומחכה' : `${held.length} כתבות נתקעו ומחכות`} ב&quot;נתקעו בפרסום&quot; בעריכות השמורות.
                  </span>
                  <LinkButton href={`/drafts/${held[0]![0].split(':')[0]}?fix=stuck`} variant="primary" className="h-8 px-3 text-sm">
                    לתקן עכשיו
                  </LinkButton>
                </>
              )}
            </div>
          )}
          {!done && <Loading label="עובד…" />}
        </Card>
      ) : (
        <>
          {blocked.length > 0 && (
            <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg bg-warn-soft px-4 py-3 font-semibold text-warn" role="alert">
              <span>
                {pending.length === 1 ? 'הכתבה עוד לא מוכנה' : blocked.length === 1 ? 'כתבה אחת עוד לא מוכנה' : `${blocked.length} כתבות עוד לא מוכנות`}.{' '}
                {pending.length === 1
                  ? 'השלימו את מה שחסר כדי לפרסם.'
                  : ready === 1
                    ? 'באישור תעלה הכתבה המוכנה, והשאר יחכו ב"נתקעו בפרסום".'
                    : ready > 1
                      ? `באישור יעלו ${ready} המוכנות, והשאר יחכו ב"נתקעו בפרסום".`
                      : 'השלימו לפחות אחת כדי לפרסם.'}
              </span>
              <LinkButton href={fixHref(blocked[0]!.draft.id)} variant="dark" className="mr-auto h-8 px-3 text-sm">
                להשלים מה שחסר
              </LinkButton>
            </div>
          )}
          <ul className="space-y-3">
            {p.items.map((i) => (
              <PreviewRow key={i.draft.id} i={i} date={p.publishDate} fixHref={fixHref(i.draft.id)} onChange={(patch) => change.mutate({ draftId: i.draft.id, patch })} />
            ))}
          </ul>
          <div className="sticky bottom-0 mt-6 flex flex-wrap items-center gap-3 border-t border-line bg-canvas/95 py-4 backdrop-blur">
            <p className="text-ink-2">אחרי האישור: התמונות שנבחרו נוצרות באיכות מלאה, הכתבות עולות לאתר, ואחר כך לרשתות. התיקונים שלכם נשלחים ל-AI ללמידה.</p>
            <Button variant="primary" className="mr-auto" busy={publish.isPending} disabled={ready === 0} onClick={() => publish.mutate()}>
              אישור סופי ופרסום {ready > 1 ? `${ready} כתבות` : ''}
            </Button>
          </div>
        </>
      )}
    </>
  );
}

/** One article: what goes out, what the agents chose (changeable in place), and what is still missing. */
function PreviewRow({ i, date, fixHref, onChange }: { i: PreviewItem; date: string; fixHref: string; onChange(patch: Record<string, unknown>): void }) {
  const skipped = i.draft.status === 'skipped';
  const published = i.draft.status === 'published';
  const open = !skipped && !published;
  const plan = i.deskPlan;
  return (
    <li className={cx('flex flex-col gap-4 rounded-xl bg-white p-4 ring-1 sm:flex-row', i.missing.length && open ? 'ring-warn/40' : 'ring-line', !open && 'opacity-55')}>
      <div className="w-full shrink-0 sm:w-56">
        <Thumb src={i.heroUrl} className="aspect-video w-full" />
        {i.heroIsDraft && open && <p className="mt-1 text-[11px] text-muted">טיוטה: תיווצר באיכות מלאה באישור.</p>}
        {open && i.imageOptions.length > 1 && (
          <div className="mt-2">
            <div className="grid grid-cols-3 gap-1" role="group" aria-label="החלפת התמונה הראשית">
              {i.imageOptions.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => !o.chosen && onChange({ heroMediaId: o.id })}
                  aria-pressed={o.chosen}
                  title={o.style ?? undefined}
                  className={cx('relative overflow-hidden rounded ring-offset-1', o.chosen ? 'ring-2 ring-brand' : 'opacity-75 hover:opacity-100 hover:ring-1 hover:ring-ink')}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- API-hosted image */}
                  <img src={o.thumbUrl} alt={o.style ?? ''} className="aspect-video w-full object-cover" />
                  {o.agentPick && <span className="absolute left-0.5 top-0.5 rounded bg-info px-1 text-[9px] font-bold text-white">★</span>}
                </button>
              ))}
            </div>
            {i.imagePickReason && <p className="mt-1 text-[11px] text-info">★ סוכן התמונות: {i.imagePickReason}</p>}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="ink">{categoryName(i.draft.category)}</Badge>
          {i.draft.placement !== 'none' && <Badge tone="danger">{PLACEMENT[i.draft.placement]}</Badge>}
          {i.ticker && <Badge tone="warn">במבזקים</Badge>}
          {skipped && <Badge>לא לפרסום</Badge>}
          {published && <Badge tone="ok">כבר פורסם</Badge>}
        </div>
        <Link href={`/drafts/${i.draft.id}`} className="mt-1.5 block font-display text-xl font-extrabold leading-snug hover:text-brand">
          {i.draft.title}
        </Link>
        <p className="mt-1 line-clamp-2 text-ink-2">{i.excerpt}</p>
        {open && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-stone px-3 py-2 text-sm">
            <label className="flex items-center gap-1.5">
              <span className="font-semibold">באתר:</span>
              <select
                value={i.draft.placement}
                onChange={(e) => onChange({ placement: e.target.value as Placement })}
                className={cx(inputClass, 'w-auto py-1 text-sm')}
                aria-label="מיקום באתר"
              >
                {PLACEMENTS.map((x) => (
                  <option key={x} value={x}>
                    {PLACEMENT[x]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5 font-semibold">
              <input type="checkbox" checked={i.ticker} onChange={(e) => onChange({ ticker: e.target.checked })} className="size-4" />
              מבזק
            </label>
            {plan && (
              <span className="text-xs text-info" title={plan.reason}>
                {plan.changed.length ? `שיניתם את בחירת העורך הראשי (${PLACEMENT[plan.placement]}${plan.ticker ? ', מבזק' : ''})` : `★ בחירת העורך הראשי: ${plan.reason}`}
              </span>
            )}
          </div>
        )}
        <p className="mt-2 text-sm text-muted">
          {formatDateTime(date)} · {i.editorName}
          {i.tags.length ? ` · תגיות: ${i.tags.join(', ')}` : ' · בלי תגיות'}
        </p>
        <p className="mt-1 text-sm">
          רשתות:{' '}
          {i.social.ready ? (
            <span className="font-semibold text-ok">{i.social.platforms.map((x) => PLATFORM[x]).join(', ') || 'אין יעדים'}</span>
          ) : (
            <span className="text-muted">לפי תוכנית ההפצה של עורך הרשתות</span>
          )}
        </p>
        {open && i.missing.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold text-warn">חסר:</span>
            {i.missing.map((m) => (
              <Badge key={m.key} tone="warn">
                {MISSING_STEP[m.key].label}
              </Badge>
            ))}
            <LinkButton href={fixHref} variant="secondary" className="h-7 px-2.5 text-xs">
              לתקן
            </LinkButton>
          </div>
        )}
        {i.warnings.map((w) => (
          <p key={w} className="mt-2 rounded-md bg-warn-soft px-2.5 py-1.5 text-sm font-semibold text-warn">
            לבדיקה: {w}
          </p>
        ))}
      </div>
    </li>
  );
}
