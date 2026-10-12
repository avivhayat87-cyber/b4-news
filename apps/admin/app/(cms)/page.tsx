'use client';
import type { DashboardDto, SavedEdits } from '@b4/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Badge, Card, ColorDot, ErrorBox, LinkButton, Loading, PageHeader } from '@/components/ui';
import { admin } from '@/lib/api';
import { useStaff } from '@/lib/auth';
import { DRAFT_STATUS, RUN_STATUS, formatDateTime, timeAgo } from '@/lib/labels';

function Stat({ label, value, href, tone }: { label: string; value: number | string; href?: string; tone?: 'brand' | 'warn' }) {
  const body = (
    <div className="rounded-xl bg-white p-5 ring-1 ring-line transition-shadow hover:shadow-sm">
      <p className="text-sm font-semibold text-muted">{label}</p>
      <p className={`mt-1 font-display text-3xl font-extrabold ${tone === 'brand' ? 'text-brand' : tone === 'warn' ? 'text-warn' : ''}`}>{value}</p>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export default function Dashboard() {
  const staff = useStaff();
  const dash = useQuery({ queryKey: ['dashboard'], queryFn: () => admin.get<DashboardDto>('/dashboard') });
  const saved = useQuery({ queryKey: ['saved'], queryFn: () => admin.get<SavedEdits>('/saved') });

  if (dash.isPending) return <Loading />;
  if (dash.isError) return <ErrorBox error={dash.error} onRetry={() => dash.refetch()} />;
  const d = dash.data;
  const recent = (saved.data?.singles ?? []).slice(0, 6);

  return (
    <>
      <PageHeader
        title={`שלום, ${staff.fullName.split(' ')[0]}`}
        subtitle="מה קורה במערכת העלאות עכשיו"
        actions={
          <>
            <LinkButton href="/manual">העלאה ידנית</LinkButton>
            <LinkButton href="/discovery" variant="primary">
              התחלת איתור כתבות
            </LinkButton>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="בעריכה" value={d.drafts.working} href="/saved" />
        <Stat label="מוכנות לפרסום" value={d.drafts.ready} href="/saved" tone={d.drafts.ready ? 'brand' : undefined} />
        <Stat label="פורסמו היום" value={d.publishedToday} />
        <Stat label="מגזינים פתוחים" value={d.magazinesOpen} href="/saved" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card title="האיתור האחרון" actions={<LinkButton href="/discovery/runs">כל האיתורים</LinkButton>}>
          {d.lastRun ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge tone={RUN_STATUS[d.lastRun.status]?.tone}>{RUN_STATUS[d.lastRun.status]?.label}</Badge>
                <span className="text-sm text-muted">{formatDateTime(d.lastRun.createdAt)}</span>
              </div>
              <p className="font-display text-2xl font-extrabold">{d.lastRun.itemsNew} כתבות חדשות</p>
              <Link href={`/discovery/runs/${d.lastRun.id}`} className="text-sm font-semibold text-brand hover:underline">
                לתוצאות
              </Link>
            </div>
          ) : (
            <p className="text-muted">עוד לא היה איתור.</p>
          )}
        </Card>

        <Card title="אתרים">
          <ul className="space-y-2">
            <li className="flex justify-between">
              <span>פעילים</span>
              <b>{d.sources.active}</b>
            </li>
            <li className="flex justify-between">
              <span>ממתינים למפתח</span>
              <b className={d.sources.waitingForDeveloper ? 'text-warn' : ''}>{d.sources.waitingForDeveloper}</b>
            </li>
            <li className="flex justify-between">
              <span>תקולים</span>
              <b className={d.sources.broken ? 'text-brand' : ''}>{d.sources.broken}</b>
            </li>
          </ul>
          <Link href="/sources" className="mt-3 inline-block text-sm font-semibold text-brand hover:underline">
            להגדרות אתרים
          </Link>
        </Card>

        <Card title="מצב המערכת">
          <ul className="space-y-2">
            <li className="flex justify-between">
              <span>תגובות לבדיקה</span>
              <Link href="/comments" className="font-bold hover:underline">
                {d.comments.toReview + d.comments.reported}
              </Link>
            </li>
            <li className="flex justify-between">
              <span>כתבות שה-AI נכשל בהן</span>
              <b className={d.drafts.aiFailed ? 'text-brand' : ''}>{d.drafts.aiFailed}</b>
            </li>
            <li className="flex justify-between">
              <span>משימות רקע שנכשלו (24 שע׳)</span>
              <b className={d.failedJobs ? 'text-brand' : ''}>{d.failedJobs}</b>
            </li>
            <li className="flex justify-between">
              <span>AI</span>
              <Badge tone={d.ai.live ? 'ok' : 'warn'}>{d.ai.live ? 'מחובר' : 'מצב פיתוח'}</Badge>
            </li>
          </ul>
        </Card>
      </div>

      {recent.length > 0 && (
        <Card title="כתבות בודדות שנשמרו לאחרונה" className="mt-6" actions={<LinkButton href="/saved">לכל העריכות השמורות</LinkButton>}>
          <ul className="divide-y divide-line-soft">
            {recent.map((r) => (
              <li key={r.id}>
                <Link href={`/drafts/${r.id}`} className="flex items-center gap-3 py-2.5 hover:text-brand">
                  <ColorDot color={r.colorLabel} />
                  <span className="flex-1 truncate font-semibold">{r.title || 'ללא כותרת'}</span>
                  <Badge tone={DRAFT_STATUS[r.status].tone}>{DRAFT_STATUS[r.status].label}</Badge>
                  <span className="w-24 text-left text-xs text-muted">{timeAgo(r.updatedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
