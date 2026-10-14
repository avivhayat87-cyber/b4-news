'use client';
// The legal review: every article it stopped, with the risks and the decisions, in one place.
import type { DraftReviewDto } from '@b4/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ReviewPanel } from '@/components/review/review-panel';
import { Card, Empty, ErrorBox, LinkButton, Loading, PageHeader } from '@/components/ui';
import { admin } from '@/lib/api';

export default function ReviewPage() {
  const list = useQuery({ queryKey: ['reviews'], queryFn: () => admin.get<DraftReviewDto[]>('/reviews'), refetchInterval: 30_000 });
  return (
    <>
      <PageHeader
        title="בדיקה משפטית"
        subtitle="כתבות שהבודק המשפטי עצר לפני פרסום: חשד נגד אדם פרטי, קטינים או נפגעי עבירות מין, צו איסור פרסום, מידע ביטחוני, שמועה על חברה בבורסה, או האשמה בלי תגובה. כתבה כזו מתפרסמת רק אחרי שמחליטים על כל סוגיה."
        actions={<LinkButton href="/settings?tab=agents">הבודק המשפטי בצוות הסוכנים</LinkButton>}
      />
      {list.isPending ? (
        <Loading />
      ) : list.isError ? (
        <ErrorBox error={list.error} onRetry={() => list.refetch()} />
      ) : list.data.length === 0 ? (
        <Empty title="אין כתבות שמחכות להחלטה">כשהבודק המשפטי עוצר כתבה, היא מופיעה כאן, והמנהלים מקבלים מייל.</Empty>
      ) : (
        <div className="space-y-6">
          {list.data.map((r) => (
            <Card
              key={r.draftId}
              title={r.title || 'ללא כותרת'}
              actions={
                <Link href={`/drafts/${r.draftId}`} className="text-sm font-semibold text-brand hover:underline">
                  פתיחת הכתבה בעורך
                </Link>
              }
            >
              <ReviewPanel draftId={r.draftId} final />
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
