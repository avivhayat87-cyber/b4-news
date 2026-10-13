'use client';
// Discovery for one kind of sites: Israeli (/discovery) or from abroad
// (/discovery/international). Each has its own runs and its own scan.
import type { RunDetail, SourceRegion } from '@b4/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { RunBoard, RunHeader } from '@/components/run-board';
import { Button, Empty, ErrorBox, LinkButton, Loading, PageHeader, cx, useToast } from '@/components/ui';
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
    empty: 'מוסיפים אתרים מחו״ל ב"הגדרות אתרים" ← "אתרים מחו״ל", ואז לוחצים על "התחלת איתור חדש".',
  },
};

export function RegionTabs({ region }: { region: SourceRegion }) {
  return (
    <div className="mb-5 inline-flex rounded-lg bg-white p-1 ring-1 ring-line" role="tablist" aria-label="סוג האתרים">
      {(
        [
          ['local', '/discovery', 'אתרים בישראל'],
          ['international', '/discovery/international', 'אתרים מחו״ל'],
        ] as const
      ).map(([id, href, label]) => (
        <Link key={id} href={href} role="tab" aria-selected={region === id} className={cx('rounded-md px-4 py-2 font-bold', region === id ? 'bg-ink text-white' : 'text-ink-2 hover:bg-stone')}>
          {label}
        </Link>
      ))}
    </div>
  );
}

export function DiscoveryView({ region }: { region: SourceRegion }) {
  const qc = useQueryClient();
  const toast = useToast();
  const canRun = useCan('editor');
  const latest = useQuery({
    queryKey: ['run', 'latest', region],
    queryFn: () => admin.get<RunDetail | null>(`/discovery/runs/latest?region=${region}`),
    refetchInterval: (q) => {
      const d = q.state.data;
      if (!d) return false;
      if (['queued', 'running'].includes(d.run.status)) return 2000;
      // Foreign headlines arrive in Hebrew a few seconds after the run.
      return d.items.some((i) => i.language && !i.titleHe) ? 3000 : false;
    },
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
      <PageHeader
        title={TEXT[region].title}
        subtitle={TEXT[region].subtitle}
        actions={
          <>
            <LinkButton href={`/discovery/runs${region === 'international' ? '?region=international' : ''}`}>איתורים קודמים</LinkButton>
            {canRun && (
              <Button variant="primary" busy={start.isPending || running} onClick={() => start.mutate()}>
                {running ? 'סורק…' : 'התחלת איתור חדש'}
              </Button>
            )}
          </>
        }
      />
      <RegionTabs region={region} />
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
