'use client';
// "Preview magazine" and final approval: everything that will go out, with the
// date, the editor's name and the tags; then the site first, the networks after.
import type { PublishJobDto, PublishPreview } from '@b4/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { SITE_URL, admin, errorMessage, idempotencyKey } from '@/lib/api';
import { PLACEMENT, PLATFORM, categoryName, formatDateTime } from '@/lib/labels';
import { Badge, Button, Card, ErrorBox, Loading, PageHeader, Thumb, cx, useToast } from './ui';

const STEP_LABEL = (key: string) => {
  if (key === 'revalidate') return 'רענון האתר';
  const [, kind, ...rest] = key.split(':');
  if (kind === 'site') return 'פרסום באתר';
  if (kind === 'push') return 'התראת פוש';
  return `${PLATFORM[kind as keyof typeof PLATFORM] ?? kind}${rest.length ? ` · ${rest.join(':')}` : ''}`;
};

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
  const blocked = pending.filter((i) => i.problems.length > 0);
  const done = finished;

  return (
    <>
      <PageHeader
        title="תצוגה מקדימה ואישור סופי"
        subtitle={`${pending.length} כתבות לפרסום · ${p.skippedCount} לא לפרסום · תאריך: ${formatDateTime(p.publishDate)} · עורך/ת: ${p.editorName}`}
        actions={<Link href={backHref} className="font-semibold text-ink-2 hover:text-brand">→ {backLabel}</Link>}
      />

      {jobId ? (
        <Card title={done ? (job.data?.status === 'succeeded' ? 'הפרסום הושלם' : 'הפרסום נכשל') : 'מפרסם…'}>
          <p className="mb-3 text-ink-2">קודם האתר, ואחריו הרשתות החברתיות.</p>
          <ul className="space-y-1.5">
            {Object.entries(job.data?.steps ?? {}).map(([k, v]) => (
              <li key={k} className="flex items-center gap-3">
                <Badge tone={v === 'ok' || v.startsWith('ok') ? 'ok' : v === 'prepared' ? 'warn' : 'danger'}>{v === 'ok' || v.startsWith('ok') ? 'בוצע' : v === 'prepared' ? 'הוכן' : 'נכשל'}</Badge>
                <span className="font-semibold">{p.items.find((i) => k.startsWith(i.draft.id))?.draft.title ?? ''}</span>
                <span className="text-sm text-muted">{STEP_LABEL(k)}</span>
                {v.startsWith('failed') && <span className="text-xs text-brand">{v.slice(8)}</span>}
              </li>
            ))}
          </ul>
          {!done && <Loading label="עובד…" />}
          {done && (
            <div className="mt-4 flex gap-2">
              <a href={SITE_URL} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand hover:underline">
                לצפייה באתר ↗
              </a>
            </div>
          )}
        </Card>
      ) : (
        <>
          {blocked.length > 0 && (
            <p className="mb-4 rounded-lg bg-warn-soft px-4 py-3 font-semibold text-warn" role="alert">
              {blocked.length} כתבות עוד לא מוכנות. השלימו אותן או סמנו "לא לפרסם" כדי להמשיך.
            </p>
          )}
          <ul className="space-y-3">
            {p.items.map((i) => {
              const skipped = i.draft.status === 'skipped';
              const published = i.draft.status === 'published';
              return (
                <li key={i.draft.id} className={cx('flex gap-4 rounded-xl bg-white p-4 ring-1', i.problems.length ? 'ring-warn/40' : 'ring-line', (skipped || published) && 'opacity-55')}>
                  <Thumb src={i.heroUrl} className="h-28 w-48 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="ink">{categoryName(i.draft.category)}</Badge>
                      {i.draft.placement !== 'none' && <Badge tone="danger">{PLACEMENT[i.draft.placement]}</Badge>}
                      {skipped && <Badge>לא לפרסום</Badge>}
                      {published && <Badge tone="ok">כבר פורסם</Badge>}
                    </div>
                    <Link href={`/drafts/${i.draft.id}`} className="mt-1.5 block font-display text-xl font-extrabold leading-snug hover:text-brand">
                      {i.draft.title}
                    </Link>
                    <p className="mt-1 line-clamp-2 text-ink-2">{i.excerpt}</p>
                    <p className="mt-2 text-sm text-muted">
                      {formatDateTime(p.publishDate)} · {i.editorName}
                      {i.tags.length ? ` · תגיות: ${i.tags.join(', ')}` : ' · בלי תגיות'}
                    </p>
                    <p className="mt-1 text-sm">
                      רשתות:{' '}
                      {i.social.ready ? (
                        <span className="font-semibold text-ok">{i.social.platforms.map((x) => PLATFORM[x]).join(', ') || 'אין יעדים'}</span>
                      ) : (
                        <span className="text-muted">לא תעלה לרשתות (החבילה לא אושרה)</span>
                      )}
                    </p>
                    {i.problems.length > 0 && <p className="mt-2 text-sm font-semibold text-warn">חסר: {i.problems.join(' · ')}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="sticky bottom-0 mt-6 flex items-center gap-3 border-t border-line bg-canvas/95 py-4 backdrop-blur">
            <p className="text-ink-2">אחרי האישור: הכתבות עולות לאתר, ואחר כך לרשתות. התיקונים שלכם נשלחים ל-AI ללמידה.</p>
            <Button variant="primary" className="mr-auto" busy={publish.isPending} disabled={blocked.length > 0 || pending.length === 0} onClick={() => publish.mutate()}>
              אישור סופי ופרסום {pending.length > 1 ? `${pending.length} כתבות` : ''}
            </Button>
          </div>
        </>
      )}
    </>
  );
}
