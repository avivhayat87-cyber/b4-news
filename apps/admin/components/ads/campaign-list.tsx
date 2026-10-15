'use client';
// The campaigns: those waiting for approval, running and paused, as cards with their numbers; and
// the archive, compact, with the numbers of each campaign that ended (deleted only by hand).
import { type CampaignDto } from '@b4/shared';
import Link from 'next/link';
import { AD_SLOT, AD_STATUS, ctr, formatDateTime } from '@/lib/labels';
import { Badge, Empty } from '../ui';

const dates = (c: CampaignDto) => `${c.startsAt ? formatDateTime(c.startsAt) : 'מהאישור'} – ${c.endedAt ? formatDateTime(c.endedAt) : c.endsAt ? formatDateTime(c.endsAt) : 'בלי תאריך סיום'}`;

export function CampaignCards({ campaigns }: { campaigns: CampaignDto[] }) {
  if (!campaigns.length) return <Empty title="אין קמפיינים פעילים">יוצרים קמפיין חדש, או מבקשים הצעה מסוכן הפרסום.</Empty>;
  return (
    <ul className="grid gap-3 lg:grid-cols-2">
      {campaigns.map((c) => (
        <li key={c.id}>
          <Link href={`/ads/${c.id}`} className="block h-full space-y-3 rounded-xl bg-white p-4 ring-1 ring-line transition hover:ring-ink">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-display text-lg font-extrabold">{c.name}</span>
              <Badge tone={AD_STATUS[c.status].tone}>{AD_STATUS[c.status].label}</Badge>
              {c.newLeads > 0 && <Badge tone="info">{c.newLeads} לידים חדשים</Badge>}
              {c.creatives.some((x) => x.review?.verdict === 'block' || x.review?.verdict === 'fix') && <Badge tone="warn">יש מה לתקן</Badge>}
            </div>
            <p className="text-sm text-ink-2">
              {c.advertiserName} · {c.slots.map((s) => AD_SLOT[s].name).join(' · ')}
            </p>
            <p className="text-xs text-muted">{dates(c)}</p>
            <dl className="grid grid-cols-4 gap-2 text-center text-sm">
              {(
                [
                  ['צפיות', c.totals.views.toLocaleString('he-IL')],
                  ['לחיצות', c.totals.clicks.toLocaleString('he-IL')],
                  ['אחוז הקלקה', ctr(c.totals.clicks, c.totals.views)],
                  ['לידים', c.action === 'lead' ? String(c.totals.leads) : '—'],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="rounded-lg bg-stone py-2">
                  <dt className="text-xs text-muted">{k}</dt>
                  <dd className="font-bold">{v}</dd>
                </div>
              ))}
            </dl>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function Archive({ campaigns }: { campaigns: CampaignDto[] }) {
  if (!campaigns.length) return <Empty title="הארכיון ריק">קמפיין שהסתיים (בתאריך, בתקרת הצפיות או ביד) עובר לכאן עם המספרים והלידים שלו.</Empty>;
  return (
    <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-line">
      <table className="w-full text-sm">
        <thead className="bg-stone text-right text-xs text-muted">
          <tr>
            <th className="px-3 py-2 font-bold">קמפיין</th>
            <th className="px-3 py-2 font-bold">תאריכים</th>
            <th className="px-3 py-2 font-bold">צפיות</th>
            <th className="px-3 py-2 font-bold">לחיצות</th>
            <th className="px-3 py-2 font-bold">לידים</th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map((c) => (
            <tr key={c.id} className="border-t border-line-soft">
              <td className="px-3 py-2">
                <Link href={`/ads/${c.id}`} className="font-bold hover:underline">
                  {c.name}
                </Link>
                <span className="block text-xs text-muted">{c.advertiserName}</span>
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-xs">{dates(c)}</td>
              <td className="px-3 py-2">{c.totals.views.toLocaleString('he-IL')}</td>
              <td className="px-3 py-2">
                {c.totals.clicks.toLocaleString('he-IL')} <span className="text-xs text-muted">({ctr(c.totals.clicks, c.totals.views)})</span>
              </td>
              <td className="px-3 py-2">{c.action === 'lead' ? c.totals.leads : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
