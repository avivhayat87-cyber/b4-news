'use client';
import type { RunDetail } from '@b4/shared';
import { useQuery } from '@tanstack/react-query';
import { use } from 'react';
import { RunBoard, RunHeader, runRefetch } from '@/components/run-board';
import { SectionTabs } from '@/components/section-tabs';
import { ErrorBox, LinkButton, Loading, PageHeader } from '@/components/ui';
import { admin } from '@/lib/api';

export default function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const run = useQuery({ queryKey: ['run', id], queryFn: () => admin.get<RunDetail>(`/discovery/runs/${id}`), refetchInterval: (q) => runRefetch(q.state.data ?? null) });

  return (
    <>
      <SectionTabs section="discovery" />
      <PageHeader
        title="תוצאות איתור"
        subtitle={run.data && !run.data.isLatest ? 'איתור קודם: אפשר לסמן כתבות ולשמור אותן לעריכה בדיוק כמו באיתור האחרון.' : undefined}
        actions={<LinkButton href={run.data?.run.region === 'international' ? '/discovery/runs?region=international' : '/discovery/runs'}>כל האיתורים</LinkButton>}
      />
      {run.isPending ? (
        <Loading />
      ) : run.isError ? (
        <ErrorBox error={run.error} onRetry={() => run.refetch()} />
      ) : (
        <>
          <RunHeader detail={run.data} />
          <RunBoard detail={run.data} />
        </>
      )}
    </>
  );
}
