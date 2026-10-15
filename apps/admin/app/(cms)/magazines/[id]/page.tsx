'use client';
import type { MagazineDetail } from '@b4/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { use, useState } from 'react';
import { DraftRow } from '@/components/draft-list';
import { Badge, Button, Card, ErrorBox, LinkButton, Loading, PageHeader, inputClass, useToast } from '@/components/ui';
import { admin, errorMessage } from '@/lib/api';
import { MAGAZINE_STATUS } from '@/lib/labels';

export default function MagazinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const mag = useQuery({
    queryKey: ['magazine', id],
    queryFn: () => admin.get<MagazineDetail>(`/magazines/${id}`),
    refetchInterval: (q) => (q.state.data?.drafts.some((d) => d.status === 'queued_ai' || d.status === 'ai_processing') ? 3000 : false),
  });
  const [title, setTitle] = useState<string | null>(null);

  const rename = useMutation({
    mutationFn: (t: string) => admin.patch(`/magazines/${id}`, { title: t }),
    onSuccess: () => {
      setTitle(null);
      void qc.invalidateQueries({ queryKey: ['magazine', id] });
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  const archive = useMutation({
    mutationFn: () => admin.post(`/magazines/${id}/archive`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['saved'] });
      router.push('/saved');
    },
  });

  const replan = useMutation({
    mutationFn: () => admin.post(`/magazines/${id}/desk-plan`),
    onSuccess: () => {
      toast('העורך הראשי מסדר את הכתבות שוב; מה ששיניתם בעצמכם נשאר כמו שהוא.');
      setTimeout(() => void qc.invalidateQueries({ queryKey: ['magazine', id] }), 6000);
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });

  if (mag.isPending) return <Loading />;
  if (mag.isError) return <ErrorBox error={mag.error} onRetry={() => mag.refetch()} />;
  const m = mag.data;
  const first = m.drafts.find((d) => !['published', 'skipped'].includes(d.status)) ?? m.drafts[0];
  const writing = m.drafts.filter((d) => d.status === 'queued_ai' || d.status === 'ai_processing').length;
  const waiting = m.drafts.filter((d) => d.status !== 'published' && d.status !== 'skipped');
  const ready = waiting.filter((d) => d.missing.length === 0).length;
  const toFix = waiting.find((d) => d.missing.length > 0);

  return (
    <>
      <PageHeader
        title={
          title !== null ? (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (title.trim()) rename.mutate(title.trim());
              }}
            >
              <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} aria-label="שם המגזין" />
              <Button type="submit" size="sm" variant="dark" busy={rename.isPending}>
                שמירה
              </Button>
            </form>
          ) : (
            <button type="button" onClick={() => setTitle(m.title)} className="text-right hover:underline" title="שינוי שם">
              {m.title}
            </button>
          )
        }
        subtitle={
          <>
            <Badge tone={MAGAZINE_STATUS[m.status]?.tone}>{MAGAZINE_STATUS[m.status]?.label}</Badge> {m.counts.total} כתבות · {m.counts.ready} מוכנות לפרסום · נוצר על ידי {m.createdBy}
          </>
        }
        actions={
          <>
            {m.status !== 'published' && (
              <Button variant="ghost" onClick={() => confirm('להעביר את המגזין לארכיון?') && archive.mutate()}>
                לארכיון
              </Button>
            )}
            <LinkButton href={`/magazines/${id}/preview`}>תצוגה מקדימה ופרסום</LinkButton>
            {first && (
              <LinkButton href={`/drafts/${first.id}`} variant="primary">
                {m.counts.ready + m.counts.published === 0 ? 'התחלת עריכה' : 'המשך עריכה'}
              </LinkButton>
            )}
          </>
        }
      />
      {writing > 0 && (
        <p className="mb-4 rounded-lg bg-info-soft px-4 py-3 font-semibold text-info" role="status">
          ה-AI כותב {writing} כתבות ומכין תמונות. כשיסיים, העורך הראשי יסדר אותן באתר. אפשר כבר להתחיל לערוך את מה שמוכן.
        </p>
      )}
      {waiting.length > 0 && (
        <div className="mb-4 rounded-xl bg-white p-4 ring-1 ring-line">
          <div className="flex flex-wrap items-center gap-3">
            <p className="font-bold">
              {ready} מתוך {waiting.length} כתבות מוכנות לפרסום
            </p>
            <div className="h-2 min-w-32 flex-1 overflow-hidden rounded-full bg-stone" role="progressbar" aria-valuemin={0} aria-valuemax={waiting.length} aria-valuenow={ready} aria-label="כתבות מוכנות">
              <div className="h-full rounded-full bg-ok transition-[width]" style={{ width: `${Math.round((ready / waiting.length) * 100)}%` }} />
            </div>
            {toFix && writing === 0 && (
              <LinkButton href={`/drafts/${toFix.id}?fix=${id}`} variant="dark" className="h-8 px-3 text-sm">
                להשלים מה שחסר, כתבה אחרי כתבה
              </LinkButton>
            )}
            <Button size="sm" variant="ghost" busy={replan.isPending} disabled={writing > 0} onClick={() => replan.mutate()}>
              העורך הראשי יסדר שוב
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted">ליד כל כתבה כתוב מה חסר. אם לא תשלימו הכל, באישור הסופי יעלו המוכנות, והשאר יחכו ב&quot;נתקעו בפרסום&quot;.</p>
        </div>
      )}
      <Card title="כתבות המגזין">
        <ol className="-mx-5 -my-5 divide-y divide-line-soft">
          {m.drafts.map((d, i) => (
            <DraftRow key={d.id} d={d} index={i} fixHref={`/drafts/${d.id}?fix=${id}`} />
          ))}
        </ol>
      </Card>
    </>
  );
}
