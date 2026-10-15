'use client';
// Discovery for one kind of sites: Israeli (/discovery) or from abroad
// (/discovery/international). Each has its own runs and its own scan.
import type { RunDetail, SourceRegion } from '@b4/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RunBoard, RunHeader, runRefetch } from '@/components/run-board';
import { SectionTabs } from '@/components/section-tabs';
import { Button, Empty, ErrorBox, Loading, PageHeader, useToast } from '@/components/ui';
import { admin, errorMessage } from '@/lib/api';
import { useCan } from '@/lib/auth';

const TEXT: Record<SourceRegion, { title: string; subtitle: string; empty: string }> = {
  local: {
    title: 'איתור כתבות',
    subtitle: 'אתרים מישראל. כל לחיצה מביאה רק את מה שהתפרסם באתרים מאז האיתור הקודם.',
    empty: 'לחצו על "התחלת איתור חדש" כדי לאסוף את הכתבות האחרונות מהאתרים הפעילים.',
  },
  international: {
    title: 'איתור מחו״ל',
    subtitle: 'אתרי חדשות מחו״ל, בסריקה נפרדת. הכותרות מתורגמות לעברית אוטומטית; בעריכה מתורגמת הכתבה כולה, וה-AI כותב את הכתבה החדשה בעברית.',
    empty: 'מוסיפים אתרים מחו״ל בלשונית "הגדרות אתרים" ← "אתרים מחו״ל", ואז לוחצים על "התחלת איתור חדש".',
  },
};

export function DiscoveryView({ region }: { region: SourceRegion }) {
  const qc = useQueryClient();
  const toast = useToast();
  const canRun = useCan('editor');
  const latest = useQuery({
    queryKey: ['run', 'latest', region],
    queryFn: () => admin.get<RunDetail | null>(`/discovery/runs/latest?region=${region}`),
    refetchInterval: (q) => runRefetch(q.state.data ?? null),
  });
  const running = latest.data ? ['queued', 'running'].includes(latest.data.run.status) : false;

  const start = useMutation({
    mutationFn: () => admin.post<{ runId: string; created: boolean }>('/discovery/runs', { region }),
    onSuccess: (r) => {
      toast(r.created ? 'האיתור התחיל. התוצאות יופיעו כאן בעוד רגע.' : 'איתור כבר רץ עכשיו.');
      void qc.invalidateQueries({ queryKey: ['run'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });

  return (
    <>
      <SectionTabs section="discovery" />
      <PageHeader
        title={TEXT[region].title}
        subtitle={TEXT[region].subtitle}
        actions={
          canRun && (
            <Button variant="primary" busy={start.isPending || running} onClick={() => start.mutate()}>
              {running ? 'סורק…' : 'התחלת איתור חדש'}
            </Button>
          )
        }
      />
      {latest.isPending ? (
        <Loading />
      ) : latest.isError ? (
        <ErrorBox error={latest.error} onRetry={() => latest.refetch()} />
      ) : !latest.data ? (
        <Empty title="עוד לא היה איתור">{TEXT[region].empty}</Empty>
      ) : (
        <>
          <RunHeader detail={latest.data} />
          {running ? <Loading label="סורק את האתרים…" /> : <RunBoard detail={latest.data} />}
        </>
      )}
    </>
  );
}
