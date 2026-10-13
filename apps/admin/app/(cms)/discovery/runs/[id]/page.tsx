'use client';
import type { RunDetail } from '@b4/shared';
import { useQuery } from '@tanstack/react-query';
import { use } from 'react';
import { RunBoard, RunHeader } from '@/components/run-board';
import { ErrorBox, LinkButton, Loading, PageHeader } from '@/components/ui';
import { admin } from '@/lib/api';

export default function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const run = useQuery({ queryKey: ['run', id], queryFn: () => admin.get<RunDetail>(`/discovery/runs/${id}`) });

  return (
    <>
      <PageHeader
        title="תוצאות איתור"
        subtitle={run.data && !run.data.isLatest ? 'איתור קודם: כתבה שמעניינת אתכם אפשר להעביר לאיתור האחרון ולבחור אותה שם.' : undefined}
        actions={
          <>
            <LinkButton href={run.data?.run.region === 'international' ? '/discovery/runs?region=international' : '/discovery/runs'}>כל האיתורים</LinkButton>
            <LinkButton href={run.data?.run.region === 'international' ? '/discovery/international' : '/discovery'} variant="dark">
              לאיתור האחרון
            </LinkButton>
          </>
        }
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
