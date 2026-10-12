'use client';
import type { RunDetail } from '@b4/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RunBoard, RunHeader } from '@/components/run-board';
import { Button, Empty, ErrorBox, LinkButton, Loading, PageHeader, useToast } from '@/components/ui';
import { admin, errorMessage } from '@/lib/api';
import { useCan } from '@/lib/auth';

export default function DiscoveryPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const canRun = useCan('editor');
  const latest = useQuery({
    queryKey: ['run', 'latest'],
    queryFn: () => admin.get<RunDetail | null>('/discovery/runs/latest'),
    refetchInterval: (q) => (q.state.data && ['queued', 'running'].includes(q.state.data.run.status) ? 2000 : false),
  });
  const running = latest.data ? ['queued', 'running'].includes(latest.data.run.status) : false;

  const start = useMutation({
    mutationFn: () => admin.post<{ runId: string; created: boolean }>('/discovery/runs'),
    onSuccess: (r) => {
      toast(r.created ? 'האיתור התחיל. התוצאות יופיעו כאן בעוד רגע.' : 'איתור כבר רץ עכשיו.');
      void qc.invalidateQueries({ queryKey: ['run'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });

  return (
    <>
      <PageHeader
        title="איתור כתבות"
        subtitle="כל לחיצה מביאה רק את מה שהתפרסם באתרים מאז האיתור הקודם."
        actions={
          <>
            <LinkButton href="/discovery/runs">איתורים קודמים</LinkButton>
            {canRun && (
              <Button variant="primary" busy={start.isPending || running} onClick={() => start.mutate()}>
                {running ? 'סורק…' : 'התחלת איתור חדש'}
              </Button>
            )}
          </>
        }
      />
      {latest.isPending ? (
        <Loading />
      ) : latest.isError ? (
        <ErrorBox error={latest.error} onRetry={() => latest.refetch()} />
      ) : !latest.data ? (
        <Empty title="עוד לא היה איתור">לחצו על "התחלת איתור חדש" כדי לאסוף את הכתבות האחרונות מהאתרים הפעילים.</Empty>
      ) : (
        <>
          <RunHeader detail={latest.data} />
          {running ? <Loading label="סורק את האתרים…" /> : <RunBoard detail={latest.data} />}
        </>
      )}
    </>
  );
}
