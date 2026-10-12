'use client';
import type { DraftSummary } from '@b4/shared';
import Link from 'next/link';
import { DRAFT_STATUS, PLACEMENT, categoryName, timeAgo } from '@/lib/labels';
import { Badge, ColorDot, Thumb } from './ui';

export function DraftRow({ d, index }: { d: DraftSummary; index?: number }) {
  const status = DRAFT_STATUS[d.status];
  return (
    <li>
      <Link href={`/drafts/${d.id}`} className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-canvas">
        {index !== undefined && <span className="w-6 text-center font-display font-extrabold text-muted">{index + 1}</span>}
        <ColorDot color={d.colorLabel} />
        <Thumb src={d.thumbUrl} className="h-12 w-20 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{d.title || 'ללא כותרת'}</p>
          <p className="truncate text-xs text-muted">
            {categoryName(d.category)}
            {d.placement !== 'none' ? ` · ${PLACEMENT[d.placement]}` : ''}
            {d.sourceName ? ` · מקור: ${d.sourceName}` : d.origin === 'manual_write' ? ' · נכתב ידנית' : ''}
          </p>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
        <span className="hidden w-28 text-left text-xs text-muted md:block">
          {timeAgo(d.updatedAt)}
          {d.updatedBy ? ` · ${d.updatedBy}` : ''}
        </span>
      </Link>
    </li>
  );
}
