'use client';
// Leads from the ads' forms and businesses asking to advertise. Kept until an admin deletes them
// (no automatic deletion: the owner's decision); each is marked handled once someone called back.
// The file download is built here in the browser, so the details never pass through a link.
import { AD_LEAD_FIELD_LABELS, type AdLeadDto } from '@b4/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { admin, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/labels';
import { Badge, Button, Empty, ErrorBox, Loading, cx, useToast } from '../ui';

const LABEL: Record<string, string> = { ...AD_LEAD_FIELD_LABELS, note: 'הערה', company: 'עסק', message: 'הודעה' };
const ORDER = ['name', 'company', 'phone', 'email', 'city', 'note', 'message'];

/** A CSV that Excel opens in Hebrew (UTF-8 with its mark). */
function downloadCsv(leads: AdLeadDto[], name: string) {
  const keys = ORDER.filter((k) => leads.some((l) => l.fields[k]));
  const cell = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const rows = [
    ['תאריך', 'קמפיין', 'מפרסם', ...keys.map((k) => LABEL[k] ?? k), 'טופל'],
    ...leads.map((l) => [formatDateTime(l.createdAt), l.campaignName ?? '', l.advertiserName ?? '', ...keys.map((k) => l.fields[k] ?? ''), l.status === 'handled' ? 'כן' : 'לא']),
  ];
  const blob = new Blob([`﻿${rows.map((r) => r.map(cell).join(',')).join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function LeadsTable({ kind, campaignId, title }: { kind: 'lead' | 'inquiry'; campaignId?: string; title: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const key = ['ad-leads', kind, campaignId ?? null];
  const query = useQuery({ queryKey: key, queryFn: () => admin.get<AdLeadDto[]>(`/ads/leads?kind=${kind}${campaignId ? `&campaignId=${campaignId}` : ''}`) });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['ad-leads'] });
    void qc.invalidateQueries({ queryKey: ['ads'] });
  };
  const onError = (e: unknown) => toast(errorMessage(e), 'danger');
  const mark = useMutation({ mutationFn: (l: AdLeadDto) => admin.patch(`/ads/leads/${l.id}`, { status: l.status === 'new' ? 'handled' : 'new' }), onSuccess: refresh, onError });
  const remove = useMutation({ mutationFn: (id: string) => admin.del(`/ads/leads/${id}`), onSuccess: refresh, onError });

  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorBox error={query.error} onRetry={() => query.refetch()} />;
  const leads = query.data;
  if (!leads.length) return <Empty title={kind === 'lead' ? 'עוד אין לידים' : 'עוד אין פניות'}>{kind === 'lead' ? 'כשגולש ישאיר פרטים במודעה עם טופס, הוא יופיע כאן (והמפרסם יקבל מייל).' : 'עסקים שממלאים את הטופס בעמוד "פרסום באתר" מופיעים כאן.'}</Empty>;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold">
          {title} ({leads.length})
        </h3>
        <Button size="sm" onClick={() => downloadCsv(leads, kind === 'lead' ? 'leads' : 'advertising-inquiries')}>
          הורדה לאקסל
        </Button>
      </div>
      <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-line">
        <table className="w-full text-sm">
          <thead className="bg-stone text-right text-xs text-muted">
            <tr>
              <th className="px-3 py-2 font-bold">מתי</th>
              {kind === 'lead' && !campaignId && <th className="px-3 py-2 font-bold">קמפיין</th>}
              <th className="px-3 py-2 font-bold">הפרטים</th>
              <th className="px-3 py-2 font-bold">סטטוס</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id} className={cx('border-t border-line-soft align-top', l.status === 'handled' && 'text-muted')}>
                <td className="whitespace-nowrap px-3 py-2">{formatDateTime(l.createdAt)}</td>
                {kind === 'lead' && !campaignId && (
                  <td className="px-3 py-2">
                    {l.campaignName}
                    <span className="block text-xs text-muted">{l.advertiserName}</span>
                  </td>
                )}
                <td className="px-3 py-2">
                  {ORDER.filter((k) => l.fields[k]).map((k) => (
                    <span key={k} className="block">
                      <span className="text-muted">{LABEL[k]}: </span>
                      <span dir={k === 'phone' || k === 'email' ? 'ltr' : undefined}>{l.fields[k]}</span>
                    </span>
                  ))}
                  {!Object.keys(l.fields).length && <span className="text-muted">הפרטים מוצפנים במפתח אחר (עותק של נתוני האתר החי).</span>}
                </td>
                <td className="px-3 py-2">{l.status === 'new' ? <Badge tone="info">חדש</Badge> : <Badge tone="muted">טופל</Badge>}</td>
                <td className="whitespace-nowrap px-3 py-2 text-left">
                  <Button size="sm" variant="ghost" onClick={() => mark.mutate(l)}>
                    {l.status === 'new' ? 'סימון כטופל' : 'החזרה לחדש'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => confirm('למחוק את הפרטים? אי אפשר לשחזר.') && remove.mutate(l.id)}>
                    מחיקה
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
