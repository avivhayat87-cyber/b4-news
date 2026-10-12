'use client';
import type { RunDto } from '@b4/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Badge, Empty, ErrorBox, Loading, PageHeader } from '@/components/ui';
import { admin } from '@/lib/api';
import { RUN_STATUS, formatDateTime } from '@/lib/labels';

export default function RunsPage() {
  const runs = useQuery({ queryKey: ['run', 'list'], queryFn: () => admin.get<RunDto[]>('/discovery/runs?limit=60') });

  return (
    <>
      <PageHeader title="איתורים קודמים" subtitle="כל איתור נשמר עם התאריך ומספר הכתבות שנמצאו. אפשר להיכנס ולהעביר כתבה לאיתור האחרון." />
      {runs.isPending ? (
        <Loading />
      ) : runs.isError ? (
        <ErrorBox error={runs.error} onRetry={() => runs.refetch()} />
      ) : runs.data.length === 0 ? (
        <Empty title="עוד לא היה איתור" />
      ) : (
        <div className="overflow-hidden rounded-xl bg-white ring-1 ring-line">
          <table className="w-full text-right">
            <thead className="bg-stone text-sm text-ink-2">
              <tr>
                <th className="px-4 py-3 font-bold">תאריך</th>
                <th className="px-4 py-3 font-bold">כתבות חדשות</th>
                <th className="px-4 py-3 font-bold">מצב</th>
                <th className="px-4 py-3 font-bold">אתרים</th>
                <th className="px-4 py-3 font-bold">הופעל על ידי</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {runs.data.map((r, i) => (
                <tr key={r.id} className="hover:bg-canvas">
                  <td className="px-4 py-3">
                    <Link href={`/discovery/runs/${r.id}`} className="font-bold hover:text-brand hover:underline">
                      {formatDateTime(r.createdAt)}
                    </Link>
                    {i === 0 && (
                      <Badge tone="ink" className="mr-2">
                        אחרון
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 font-display text-lg font-extrabold">{r.itemsNew}</td>
                  <td className="px-4 py-3">
                    <Badge tone={RUN_STATUS[r.status]?.tone}>{RUN_STATUS[r.status]?.label}</Badge>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted">
                    {r.sources.map((s) => `${s.name} (${s.itemsNew})`).join(' · ') || '—'}
                  </td>
                  <td className="px-4 py-3 text-sm">{r.triggeredBy ?? 'אוטומטי'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
