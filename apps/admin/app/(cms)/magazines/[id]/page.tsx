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

  if (mag.isPending) return <Loading />;
  if (mag.isError) return <ErrorBox error={mag.error} onRetry={() => mag.refetch()} />;
  const m = mag.data;
  const first = m.drafts.find((d) => !['published', 'skipped'].includes(d.status)) ?? m.drafts[0];
  const writing = m.drafts.filter((d) => d.status === 'queued_ai' || d.status === 'ai_processing').length;

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
          ה-AI כותב {writing} כתבות ומכין תמונות. אפשר כבר להתחיל לערוך את מה שמוכן.
        </p>
      )}
      <Card title="כתבות המגזין">
        <ol className="-mx-5 -my-5 divide-y divide-line-soft">
          {m.drafts.map((d, i) => (
            <DraftRow key={d.id} d={d} index={i} />
          ))}
        </ol>
      </Card>
    </>
  );
}
