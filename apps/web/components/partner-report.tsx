'use client';
// The advertiser's report: each campaign's numbers (views counted only when really seen, clicks,
// leads), the newsroom's summary, the last days, and the leads with a file to download.
import { AD_LEAD_FIELD_LABELS, AD_SLOT_NAMES as SLOT, type AdStatus, type PartnerReportDto } from '@b4/shared';
import { useEffect, useState } from 'react';
import { ApiFailure, adsApi } from '@/lib/client-api';

const STATUS: Record<AdStatus, string> = { draft: 'בהכנה', active: 'רץ עכשיו', paused: 'מושהה', ended: 'הסתיים' };
const LABEL: Record<string, string> = { ...AD_LEAD_FIELD_LABELS, note: 'הערה' };
const ORDER = ['name', 'phone', 'email', 'city', 'note'];

const dateFmt = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
const n = (v: number) => v.toLocaleString('he-IL');
const rate = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(2)}%` : '—');

function downloadCsv(leads: PartnerReportDto['leads']) {
  const keys = ORDER.filter((k) => leads.some((l) => l.fields[k]));
  const cell = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const rows = [['תאריך', 'קמפיין', ...keys.map((k) => LABEL[k] ?? k)], ...leads.map((l) => [timeFmt.format(new Date(l.createdAt)), l.campaignName, ...keys.map((k) => l.fields[k] ?? '')])];
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([`﻿${rows.map((r) => r.map(cell).join(',')).join('\r\n')}`], { type: 'text/csv;charset=utf-8' }));
  a.download = 'leads.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

export function PartnerReport({ reportKey }: { reportKey: string }) {
  const [data, setData] = useState<PartnerReportDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    adsApi
      .partner(reportKey)
      .then(setData)
      .catch((e) => setError(e instanceof ApiFailure && e.status === 404 ? 'הקישור לא תקין או שהוחלף בקישור חדש. בקשו מאיתנו את הקישור העדכני.' : 'לא הצלחנו לטעון את הדוח. נסו שוב בעוד רגע.'));
  }, [reportKey]);

  if (error)
    return (
      <p role="alert" className="rounded-[10px] bg-stone p-5 text-[17px] font-bold">
        {error}
      </p>
    );
  if (!data) return <p className="text-muted">טוען את הדוח…</p>;

  return (
    <div className="space-y-10">
      <header>
        <p className="text-sm font-bold text-brand">דוח מפרסם · B4 NEW&apos;S</p>
        <h1 className="mt-1 text-[34px] font-extrabold leading-tight">{data.advertiser}</h1>
        <p className="mt-2 text-[15px] text-ink-2">צפייה נספרת רק כשלפחות חצי מהמודעה הייתה על המסך שנייה ברציפות. הנתונים מתעדכנים כל הזמן; הימים לפי שעון ישראל.</p>
      </header>

      {data.campaigns.length === 0 ? <p className="text-muted">עוד אין קמפיינים שרצו.</p> : null}
      {data.campaigns.map((c) => (
        <section key={c.id} aria-labelledby={`c-${c.id}`} className="space-y-4 rounded-[10px] border border-line p-5">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id={`c-${c.id}`} className="text-[24px] font-extrabold">
              {c.name}
            </h2>
            <span className="rounded-full bg-stone px-3 py-1 text-sm font-bold">{STATUS[c.status]}</span>
          </div>
          <p className="text-sm text-muted">
            {c.slots.map((s) => SLOT[s]).join(' · ')}
            {c.startsAt || c.endsAt || c.endedAt ? ` · ${c.startsAt ? dateFmt.format(new Date(c.startsAt)) : ''} – ${c.endedAt ? dateFmt.format(new Date(c.endedAt)) : c.endsAt ? dateFmt.format(new Date(c.endsAt)) : ''}` : ''}
          </p>
          <dl className="grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
            {(
              [
                ['צפיות', n(c.totals.views)],
                ['לחיצות', n(c.totals.clicks)],
                ['אחוז הקלקה', rate(c.totals.clicks, c.totals.views)],
                ['פניות', n(c.totals.leads)],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="rounded-[10px] bg-stone p-3">
                <dt className="text-sm text-muted">{k}</dt>
                <dd className="text-[26px] font-extrabold">{v}</dd>
              </div>
            ))}
          </dl>
          {c.reportNote ? <p className="whitespace-pre-line rounded-[10px] bg-brand-soft p-4 text-[16px] leading-relaxed">{c.reportNote}</p> : null}
          {c.days.length > 0 ? (
            <details>
              <summary className="cursor-pointer font-bold">לפי ימים</summary>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-right text-muted">
                    <tr>
                      <th className="py-1.5 font-bold">יום</th>
                      <th className="py-1.5 font-bold">צפיות</th>
                      <th className="py-1.5 font-bold">לחיצות</th>
                      <th className="py-1.5 font-bold">פניות</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...c.days].reverse().map((d) => (
                      <tr key={d.day} className="border-t border-line">
                        <td className="py-1.5">{d.day.split('-').reverse().join('.')}</td>
                        <td className="py-1.5">{n(d.views)}</td>
                        <td className="py-1.5">{n(d.clicks)}</td>
                        <td className="py-1.5">{n(d.leads)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}
        </section>
      ))}

      {data.leads.length > 0 ? (
        <section aria-labelledby="leads-title" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="leads-title" className="text-[24px] font-extrabold">
              הפניות שהגיעו ({data.leads.length})
            </h2>
            <button type="button" onClick={() => downloadCsv(data.leads)} className="inline-flex h-10 items-center rounded-full border-2 border-ink px-5 font-extrabold hover:bg-ink hover:text-white">
              הורדה לאקסל
            </button>
          </div>
          <ul className="divide-y divide-line rounded-[10px] border border-line">
            {data.leads.map((l) => (
              <li key={l.id} className="flex flex-wrap gap-x-6 gap-y-1 p-4 text-[15px]">
                <span className="text-muted">{timeFmt.format(new Date(l.createdAt))}</span>
                {ORDER.filter((k) => l.fields[k]).map((k) => (
                  <span key={k}>
                    <span className="text-muted">{LABEL[k]}: </span>
                    <span dir={k === 'phone' || k === 'email' ? 'ltr' : undefined}>{l.fields[k]}</span>
                  </span>
                ))}
                <span className="text-muted">({l.campaignName})</span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted">כל פונה אישר/ה במפורש שתחזרו אליו/ה בנושא הזה. השתמשו בפרטים רק לשם כך, ושמרו עליהם.</p>
        </section>
      ) : null}
    </div>
  );
}
