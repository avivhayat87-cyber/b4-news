'use client';
// Factual data against the source: numbers, percentages, amounts and years of
// the source that are missing from the draft, and ones in the draft that the
// source doesn't have. Rechecked after every save.
import type { FactCheckDto } from '@b4/shared';
import { useQuery } from '@tanstack/react-query';
import { admin } from '@/lib/api';
import { Badge } from '../ui';

export function FactCheck({ draftId, version }: { draftId: string; version: number }) {
  const facts = useQuery({ queryKey: ['facts', draftId, version], queryFn: () => admin.get<FactCheckDto>(`/drafts/${draftId}/facts`) });
  const f = facts.data;
  if (!f?.hasSource || f.sourceCount === 0) return null;
  const ok = f.missing.length === 0 && f.added.length === 0;
  return (
    <section className="rounded-lg p-3 ring-1 ring-line" aria-label="בדיקת נתונים מול המקור">
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold text-ink-2">בדיקת נתונים מול המקור</span>
        {ok ? <Badge tone="ok">כל {f.sourceCount} הנתונים נשמרו</Badge> : <Badge tone="warn">יש מה לבדוק</Badge>}
      </div>
      {f.missing.length > 0 && (
        <div className="mt-2 text-sm">
          <p className="font-semibold text-warn">במקור ולא בכתבה:</p>
          <ul className="mt-1 space-y-1">
            {f.missing.slice(0, 8).map((x) => (
              <li key={x.value + x.context} className="text-ink-2">
                <b dir="auto">{x.value}</b> <span className="text-xs text-muted" dir="auto">… {x.context} …</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {f.added.length > 0 && (
        <div className="mt-2 text-sm">
          <p className="font-semibold text-brand">בכתבה ולא במקור (לוודא שלא הומצא):</p>
          <ul className="mt-1 space-y-1">
            {f.added.slice(0, 8).map((x) => (
              <li key={x.value + x.context} className="text-ink-2">
                <b dir="auto">{x.value}</b> <span className="text-xs text-muted" dir="auto">… {x.context} …</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
