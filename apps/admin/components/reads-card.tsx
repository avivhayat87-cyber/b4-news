'use client';
// The dashboard's readers card: the newsroom's own count of article reads (services/reads.ts),
// today against yesterday and the last 7 days, where today's readers came from, and today's
// most read. Visits to the whole site are in Cloudflare Web Analytics (Settings > site details).
import { READ_SOURCES, type ReadsOverview } from '@b4/shared';
import { SITE_URL } from '@/lib/api';
import { READ_SOURCE } from '@/lib/labels';
import { Card } from './ui';

const weekday = new Intl.DateTimeFormat('he-IL', { weekday: 'short', timeZone: 'Asia/Jerusalem' });
const number = new Intl.NumberFormat('he-IL');

export function ReadsCard({ reads }: { reads: ReadsOverview }) {
  const max = Math.max(1, ...reads.week.map((d) => d.reads));
  const sources = READ_SOURCES.map((k) => ({ k, n: reads.from[k] })).filter((s) => s.n > 0).sort((a, b) => b.n - a.n);

  return (
    <Card title="קוראים">
      <div className="grid gap-6 md:grid-cols-3">
        <div>
          <p className="text-sm font-semibold text-muted">קריאות כתבות היום</p>
          <p className="mt-1 font-display text-4xl font-extrabold">{number.format(reads.today)}</p>
          <p className="mt-1 text-sm text-muted">אתמול, כל היום: {number.format(reads.yesterday)}</p>
          <div className="mt-4 flex h-20 items-end gap-1.5" role="img" aria-label={`קריאות ב-7 הימים האחרונים: ${reads.week.map((d) => d.reads).join(', ')}`}>
            {reads.week.map((d, i) => (
              <div key={d.day} className="flex flex-1 flex-col items-center gap-1">
                <div
                  className={`w-full rounded-t ${i === reads.week.length - 1 ? 'bg-brand' : 'bg-line'}`}
                  style={{ height: `${Math.max(3, Math.round((d.reads / max) * 64))}px` }}
                  title={`${d.day}: ${d.reads}`}
                />
                <span className="text-[11px] text-muted">{weekday.format(new Date(`${d.day}T12:00:00Z`))}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="text-sm font-semibold text-muted">מאיפה הגיעו היום</p>
          {sources.length ? (
            <ul className="mt-2 space-y-1.5 text-sm">
              {sources.map((s) => (
                <li key={s.k} className="flex justify-between gap-3">
                  <span>{READ_SOURCE[s.k]}</span>
                  <b className="tabular-nums">{number.format(s.n)}</b>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted">עוד אין קריאות היום.</p>
          )}
        </div>

        <div className="min-w-0">
          <p className="text-sm font-semibold text-muted">הנקראות היום</p>
          {reads.top.length ? (
            <ol className="mt-2 space-y-1.5 text-sm">
              {reads.top.map((a, i) => (
                <li key={a.id} className="flex items-baseline gap-2">
                  <span className="w-4 shrink-0 font-bold text-brand">{i + 1}</span>
                  <a href={`${SITE_URL}/article/${a.slug}`} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate hover:text-brand hover:underline">
                    {a.title}
                  </a>
                  <b className="shrink-0 tabular-nums">{number.format(a.reads)}</b>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-2 text-sm text-muted">כשיתחילו לקרוא, הכתבות יופיעו כאן.</p>
          )}
        </div>
      </div>
      <p className="mt-4 text-xs text-muted">כל דפדפן נספר פעם אחת ביום לכל כתבה, ורק אחרי כמה שניות בדף. לא נשמר שום פרט מזהה על הקוראים.</p>
    </Card>
  );
}
