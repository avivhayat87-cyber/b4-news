'use client';
// One campaign: approving it (it runs only then), pausing or ending it, its numbers by day, its
// ads, its details, its leads, the summary on the advertiser's page, and deleting it for good.
import type { AdDayDto, AdsOverviewDto, AdStatus, AdTaskDto, CampaignDto } from '@b4/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { use, useEffect, useState } from 'react';
import { CampaignForm, draftFrom, toInput } from '@/components/ads/campaign-form';
import { Creatives } from '@/components/ads/creatives';
import { LeadsTable } from '@/components/ads/leads';
import { useAdTask } from '@/components/ads/use-ad-task';
import { Badge, Button, Card, ErrorBox, Loading, PageHeader, inputClass, useToast } from '@/components/ui';
import { admin, errorMessage } from '@/lib/api';
import { AD_DEVICE, AD_SLOT, AD_STATUS, ctr, formatDateTime } from '@/lib/labels';

function StatusActions({ c }: { c: CampaignDto }) {
  const qc = useQueryClient();
  const toast = useToast();
  const set = useMutation({
    mutationFn: (status: AdStatus) => admin.post<CampaignDto>(`/ads/campaigns/${c.id}/status`, { status }),
    onSuccess: (updated, status) => {
      qc.setQueryData(['ad-campaign', c.id], updated);
      void qc.invalidateQueries({ queryKey: ['ads'] });
      toast(status === 'active' ? 'הקמפיין אושר ורץ באתר.' : status === 'ended' ? 'הקמפיין הסתיים ועבר לארכיון.' : 'הסטטוס עודכן.');
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  const unchecked = c.creatives.some((x) => x.active && !x.review);
  const button = (status: AdStatus, label: string, variant: 'primary' | 'secondary' | 'ghost' = 'secondary', ask?: string) => (
    <Button variant={variant} busy={set.isPending && set.variables === status} onClick={() => (!ask || confirm(ask)) && set.mutate(status)}>
      {label}
    </Button>
  );
  return (
    <>
      {(c.status === 'draft' || c.status === 'paused') && button('active', c.status === 'draft' ? 'אישור והפעלה' : 'חידוש', 'primary', unchecked ? 'יש מודעה שסוכן הפרסום עוד לא בדק. לאשר בכל זאת?' : undefined)}
      {c.status === 'active' && button('paused', 'השהיה')}
      {c.status !== 'ended' && button('ended', 'סיום והעברה לארכיון', 'ghost', 'לסיים את הקמפיין? הוא יעבור לארכיון עם המספרים והלידים שלו.')}
      {c.status === 'ended' && button('paused', 'הוצאה מהארכיון')}
    </>
  );
}

function Days({ id }: { id: string }) {
  const query = useQuery({ queryKey: ['ad-days', id], queryFn: () => admin.get<AdDayDto[]>(`/ads/campaigns/${id}/days`) });
  if (!query.data) return <Loading />;
  if (!query.data.length) return <p className="text-sm text-muted">עוד אין נתונים: המספרים מתחילים להיספר כשהקמפיין רץ.</p>;
  const days = [...query.data].reverse();
  return (
    <div className="max-h-80 overflow-y-auto rounded-lg ring-1 ring-line">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-stone text-right text-xs text-muted">
          <tr>
            <th className="px-3 py-2 font-bold">יום</th>
            <th className="px-3 py-2 font-bold">צפיות</th>
            <th className="px-3 py-2 font-bold">לחיצות</th>
            <th className="px-3 py-2 font-bold">אחוז הקלקה</th>
            <th className="px-3 py-2 font-bold">לידים</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.day} className="border-t border-line-soft">
              <td className="px-3 py-1.5">{d.day.split('-').reverse().join('.')}</td>
              <td className="px-3 py-1.5">{d.views.toLocaleString('he-IL')}</td>
              <td className="px-3 py-1.5">{d.clicks.toLocaleString('he-IL')}</td>
              <td className="px-3 py-1.5">{ctr(d.clicks, d.views)}</td>
              <td className="px-3 py-1.5">{d.leads}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The summary on the advertiser's page: the agent proposes, an admin edits and saves. */
function ReportNote({ c }: { c: CampaignDto }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [note, setNote] = useState(c.reportNote);
  const agent = useAdTask();
  const ask = useMutation({ mutationFn: () => admin.post<AdTaskDto>(`/ads/campaigns/${c.id}/report`), onSuccess: agent.track, onError: (e) => toast(errorMessage(e), 'danger') });
  const proposed = agent.task?.status === 'done' ? agent.task.report : null;
  useEffect(() => {
    if (proposed === null) return;
    setNote(proposed);
    agent.clear();
  }, [proposed, agent]);
  const save = useMutation({
    mutationFn: () => admin.put<CampaignDto>(`/ads/campaigns/${c.id}/report-note`, { note }),
    onSuccess: (u) => {
      qc.setQueryData(['ad-campaign', c.id], u);
      toast('הסיכום נשמר, והמפרסם רואה אותו בעמוד הדוח שלו.');
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  return (
    <Card title="סיכום למפרסם">
      <div className="space-y-3">
        <p className="text-sm text-muted">מופיע בעמוד הדוח של המפרסם, מעל המספרים. סוכן הפרסום יכול להציע סיכום מהמספרים (פחות מסנט), ואתם עורכים ושומרים.</p>
        <textarea rows={5} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} aria-label="הסיכום למפרסם" className={inputClass} />
        {agent.task?.status === 'failed' && <p className="text-sm text-brand">{agent.task.lastError}</p>}
        <div className="flex gap-2">
          <Button busy={ask.isPending || agent.running} onClick={() => ask.mutate()}>
            הצעה מסוכן הפרסום
          </Button>
          <Button variant="primary" busy={save.isPending} disabled={note === c.reportNote} onClick={() => save.mutate()}>
            שמירה
          </Button>
        </div>
      </div>
    </Card>
  );
}

export default function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const query = useQuery({ queryKey: ['ad-campaign', id], queryFn: () => admin.get<CampaignDto>(`/ads/campaigns/${id}`) });
  const overview = useQuery({ queryKey: ['ads'], queryFn: () => admin.get<AdsOverviewDto>('/ads') });
  const update = useMutation({
    mutationFn: (input: ReturnType<typeof toInput>) => admin.put<CampaignDto>(`/ads/campaigns/${id}`, input),
    onSuccess: (c) => {
      qc.setQueryData(['ad-campaign', id], c);
      void qc.invalidateQueries({ queryKey: ['ads'] });
      setEditing(false);
      toast('הקמפיין עודכן.');
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  const remove = useMutation({
    mutationFn: () => admin.del(`/ads/campaigns/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ads'] });
      toast('הקמפיין נמחק.');
      router.push('/ads');
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });

  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorBox error={query.error} onRetry={() => query.refetch()} />;
  const c = query.data;
  const t = c.totals;

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {c.name} <Badge tone={AD_STATUS[c.status].tone}>{AD_STATUS[c.status].label}</Badge>
          </span>
        }
        subtitle={`${c.advertiserName} · ${c.slots.map((s) => AD_SLOT[s].name).join(' · ')} · ${AD_DEVICE[c.devices]}`}
        actions={<StatusActions c={c} />}
      />
      {c.approvedBy && (
        <p className="-mt-4 text-sm text-muted">
          אושר על ידי {c.approvedBy}, {formatDateTime(c.approvedAt)}
          {c.endedAt && ` · הסתיים ${formatDateTime(c.endedAt)}`}
        </p>
      )}

      <Card title="המספרים">
        <dl className="mb-4 grid grid-cols-2 gap-3 text-center sm:grid-cols-5">
          {(
            [
              ['נשלחו לעמודים', t.served.toLocaleString('he-IL')],
              ['צפיות', t.views.toLocaleString('he-IL')],
              ['לחיצות', t.clicks.toLocaleString('he-IL')],
              ['אחוז הקלקה', ctr(t.clicks, t.views)],
              ['לידים', c.action === 'lead' ? t.leads.toLocaleString('he-IL') : '—'],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="rounded-lg bg-stone p-3">
              <dt className="text-xs text-muted">{k}</dt>
              <dd className="font-display text-xl font-extrabold">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mb-3 text-xs text-muted">צפייה נספרת רק כשלפחות חצי מהמודעה הייתה על המסך שנייה ברציפות (התקן המקובל בעולם). הימים לפי שעון ישראל.</p>
        <Days id={c.id} />
      </Card>

      <Creatives campaign={c} />

      <Card title="פרטי הקמפיין" actions={!editing && <Button size="sm" onClick={() => setEditing(true)}>עריכה</Button>}>
        {editing && overview.data ? (
          <CampaignForm initial={draftFrom(c)} advertisers={overview.data.advertisers} busy={update.isPending} submitLabel="שמירה" onSubmit={(d) => update.mutate(toInput(d))} />
        ) : (
          <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="text-muted">תאריכים</dt>
              <dd className="font-bold">
                {c.startsAt ? formatDateTime(c.startsAt) : 'מהאישור'} – {c.endsAt ? formatDateTime(c.endsAt) : 'בלי תאריך סיום'}
              </dd>
            </div>
            <div>
              <dt className="text-muted">תקרת צפיות</dt>
              <dd className="font-bold">{c.maxViews ? c.maxViews.toLocaleString('he-IL') : 'בלי תקרה'}</dd>
            </div>
            <div>
              <dt className="text-muted">לאותו גולש</dt>
              <dd className="font-bold">עד {c.perReaderDaily} פעמים ביום</dd>
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <dt className="text-muted">בלחיצה</dt>
              <dd className="font-bold">
                {c.action === 'lead' ? (
                  `טופס לידים: ${c.leadForm.question || 'השארת פרטים'}`
                ) : (
                  <a href={c.url} target="_blank" rel="noopener noreferrer" dir="ltr" className="text-info underline">
                    {c.url}
                  </a>
                )}
              </dd>
            </div>
            {c.notes && (
              <div className="sm:col-span-2 lg:col-span-3">
                <dt className="text-muted">הערות</dt>
                <dd className="whitespace-pre-line">{c.notes}</dd>
              </div>
            )}
          </dl>
        )}
      </Card>

      {c.action === 'lead' && (
        <Card title="הלידים של הקמפיין">
          <LeadsTable kind="lead" campaignId={c.id} title="לידים" />
        </Card>
      )}

      <ReportNote key={c.reportNote} c={c} />

      <Card title="מחיקה">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-2">מוחקת את הקמפיין לתמיד: המודעות, המספרים והלידים שלו. קמפיין שהסתיים נשמר בארכיון עד שמוחקים אותו כאן.</p>
          <Button variant="danger" busy={remove.isPending} onClick={() => confirm(`למחוק את "${c.name}" לתמיד, עם ${t.leads} לידים? אי אפשר לשחזר.`) && remove.mutate()}>
            מחיקת הקמפיין
          </Button>
        </div>
      </Card>
    </div>
  );
}
