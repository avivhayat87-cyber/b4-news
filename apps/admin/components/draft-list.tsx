'use client';
import type { DraftSummary } from '@b4/shared';
import Link from 'next/link';
import { DRAFT_STATUS, MISSING_STEP, PLACEMENT, categoryName, timeAgo } from '@/lib/labels';
import { Badge, ColorDot, Thumb } from './ui';

/**
 * One article in a list: where it goes on the site, and what it still needs before it is published.
 * fixHref: where its "לתקן" goes (the editor in fixing mode); without it the row opens the editor.
 */
export function DraftRow({ d, index, fixHref }: { d: DraftSummary; index?: number; fixHref?: string }) {
  const status = DRAFT_STATUS[d.status];
  const waiting = d.status !== 'published' && d.status !== 'skipped';
  return (
    <li>
      <Link href={fixHref && d.missing.length ? fixHref : `/drafts/${d.id}`} className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-canvas">
        {index !== undefined && <span className="w-6 text-center font-display font-extrabold text-muted">{index + 1}</span>}
        <ColorDot color={d.colorLabel} />
        <Thumb src={d.thumbUrl} className="h-12 w-20 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{d.title || 'ללא כותרת'}</p>
          <p className="truncate text-xs text-muted">
            {categoryName(d.category)}
            {d.placement !== 'none' ? ` · ${PLACEMENT[d.placement]}` : ''}
            {d.ticker ? ' · מבזק' : ''}
            {d.origin === 'research' ? ' · מתחקיר' : d.sourceName ? ` · מקור: ${d.sourceName}` : d.origin === 'manual_write' ? ' · נכתב ידנית' : ''}
          </p>
          {waiting && d.missing.length > 0 && (
            <p className="mt-0.5 truncate text-xs font-semibold text-brand-deep">
              חסר: {d.missing.map((m) => MISSING_STEP[m.key].label).join(' · ')}
            </p>
          )}
        </div>
        {waiting && d.missing.length === 0 ? <Badge tone="ok">מוכנה לפרסום</Badge> : <Badge tone={status.tone}>{status.label}</Badge>}
        <span className="hidden w-28 text-left text-xs text-muted md:block">
          {timeAgo(d.updatedAt)}
          {d.updatedBy ? ` · ${d.updatedBy}` : ''}
        </span>
      </Link>
    </li>
  );
}
