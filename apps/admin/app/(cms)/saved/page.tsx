'use client';
import { DRAFT_COLORS, type DraftColor, type SavedEdits } from '@b4/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { DraftRow } from '@/components/draft-list';
import { Badge, Card, ColorDot, Empty, ErrorBox, LinkButton, Loading, PageHeader, Thumb, cx } from '@/components/ui';
import { admin } from '@/lib/api';
import { COLOR, MAGAZINE_STATUS, formatDateTime } from '@/lib/labels';

export default function SavedPage() {
  const saved = useQuery({ queryKey: ['saved'], queryFn: () => admin.get<SavedEdits>('/saved'), refetchInterval: 15_000 });
  const [color, setColor] = useState<DraftColor | null>(null);
  const [showPublished, setShowPublished] = useState(false);

  if (saved.isPending) return <Loading />;
  if (saved.isError) return <ErrorBox error={saved.error} onRetry={() => saved.refetch()} />;
  const magazines = saved.data.magazines.filter((m) => showPublished || m.status !== 'published');
  const singles = saved.data.singles.filter((s) => !color || s.colorLabel === color);

  return (
    <>
      <PageHeader
        title="עריכות שמורות"
        subtitle="מגזינים שלמים וכתבות בודדות. כל מה שנערך נשמר אוטומטית; אפשר לצאת ולחזור בכל שלב."
        actions={
          <>
            <LinkButton href="/manual">העלאה ידנית</LinkButton>
            <LinkButton href="/discovery" variant="primary">
              לאיתור כתבות
            </LinkButton>
          </>
        }
      />

      <Card
        title="מגזינים"
        actions={
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showPublished} onChange={(e) => setShowPublished(e.target.checked)} />
            הצגת מגזינים שפורסמו
          </label>
        }
      >
        {magazines.length === 0 ? (
          <p className="text-muted">אין מגזינים פתוחים. בחרו כתבות באיתור ולחצו "שמירה כמגזין".</p>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {magazines.map((m) => (
              <li key={m.id}>
                <Link href={`/magazines/${m.id}`} className="block rounded-xl p-4 ring-1 ring-line transition-shadow hover:shadow-md">
                  <div className="grid h-20 grid-cols-4 gap-1 overflow-hidden rounded-lg">
                    {[0, 1, 2, 3].map((i) => (
                      <Thumb key={i} src={m.thumbs[i] ?? null} className="h-full w-full rounded-none" />
                    ))}
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <h3 className="flex-1 truncate font-extrabold">{m.title}</h3>
                    <Badge tone={MAGAZINE_STATUS[m.status]?.tone}>{MAGAZINE_STATUS[m.status]?.label}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    {m.counts.total} כתבות · {m.counts.ready} מוכנות · {m.counts.working} בעבודה
                    {m.counts.skipped ? ` · ${m.counts.skipped} לא לפרסום` : ''}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {m.createdBy} · {formatDateTime(m.updatedAt)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title="כתבות בודדות"
        className="mt-6"
        actions={
          <div className="flex items-center gap-1" role="group" aria-label="סינון לפי צבע">
            <button type="button" onClick={() => setColor(null)} className={cx('rounded-full px-2.5 py-1 text-xs font-bold', !color ? 'bg-ink text-white' : 'bg-stone')}>
              הכל
            </button>
            {DRAFT_COLORS.map((c) => (
              <button key={c} type="button" onClick={() => setColor(color === c ? null : c)} aria-pressed={color === c} aria-label={COLOR[c]} title={COLOR[c]} className={cx('rounded-full p-1.5', color === c && 'ring-2 ring-ink')}>
                <ColorDot color={c} className="size-3.5" />
              </button>
            ))}
          </div>
        }
      >
        {singles.length === 0 ? (
          <Empty title={color ? `אין כתבות ב${COLOR[color]}` : 'אין כתבות בודדות'}>כתבות שנשמרות לבד (מהאיתור או מהעלאה ידנית) מופיעות כאן עם הצבע שבחרתם.</Empty>
        ) : (
          <ul className="-mx-5 -my-5 divide-y divide-line-soft">
            {singles.map((d) => (
              <DraftRow key={d.id} d={d} />
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
