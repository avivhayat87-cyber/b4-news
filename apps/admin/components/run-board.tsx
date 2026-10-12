'use client';
// The results of one discovery run, grouped by section. In the latest run the
// editor picks articles and saves them as a magazine (or as single articles);
// in an older run each article can be moved to the latest run.
import { CATEGORIES, DRAFT_COLORS, type DraftColor, type RunDetail, type RunItemDto } from '@b4/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { admin, errorMessage } from '@/lib/api';
import { COLOR, RUN_STATUS, categoryName, formatDateTime, timeAgo } from '@/lib/labels';
import { Badge, Button, ColorDot, Empty, Thumb, cx, inputClass, useToast } from './ui';

const ORDER = [...CATEGORIES.map((c) => c.slug as string), ''];

export function RunHeader({ detail }: { detail: RunDetail }) {
  const r = detail.run;
  const status = RUN_STATUS[r.status];
  return (
    <div className="mb-5 rounded-xl bg-white p-5 ring-1 ring-line">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-extrabold">איתור מ-{formatDateTime(r.createdAt)}</h2>
        <Badge tone={status?.tone}>{status?.label}</Badge>
        {detail.isLatest && <Badge tone="ink">האיתור האחרון</Badge>}
        <span className="text-[15px] text-muted">
          {r.status === 'running' || r.status === 'queued' ? 'סורק את האתרים…' : `נמצאו ${r.itemsNew} כתבות חדשות`}
          {r.triggeredBy ? ` · הופעל על ידי ${r.triggeredBy}` : ''}
        </span>
      </div>
      {r.sources.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2 text-sm">
          {r.sources.map((s) => (
            <li key={s.id} className={cx('rounded-full px-3 py-1 ring-1', s.status === 'failed' ? 'bg-brand-soft text-brand-deep ring-brand/20' : 'bg-stone ring-line')} title={s.error ?? undefined}>
              {s.name}: <b>{s.itemsNew}</b> חדשות{s.status === 'failed' ? ' · נכשל' : s.error ? ` · ${s.error}` : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ItemCard({ item, selected, onToggle, action }: { item: RunItemDto; selected?: boolean; onToggle?: () => void; action?: React.ReactNode }) {
  const taken = item.status === 'in_draft';
  const id = `pick-${item.id}`;
  return (
    <li className={cx('flex gap-3 rounded-xl bg-white p-3 ring-1 transition-shadow', selected ? 'ring-2 ring-brand' : 'ring-line', taken && 'opacity-60')}>
      {onToggle && (
        <input id={id} type="checkbox" checked={!!selected} disabled={taken} onChange={onToggle} className="mt-1 size-5 shrink-0 accent-[var(--color-brand)]" aria-describedby={`${id}-title`} />
      )}
      <Thumb src={item.imageUrl} className="h-20 w-28 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span className="font-bold text-ink-2">{item.source.name}</span>
          <span>·</span>
          <span>{timeAgo(item.publishedAt)}</span>
          {item.origin === 'pulled' && <Badge tone="info">הועבר מאיתור קודם</Badge>}
          {taken && <Badge tone="warn">כבר בעריכה</Badge>}
        </div>
        <label htmlFor={onToggle ? id : undefined} id={`${id}-title`} className="mt-1 block cursor-pointer font-display text-[16px] font-bold leading-snug">
          {item.title}
        </label>
        {item.intro && <p className="mt-1 line-clamp-2 text-sm text-ink-2">{item.intro}</p>}
        <div className="mt-1.5 flex items-center gap-3">
          <a href={item.url} target="_blank" rel="noopener noreferrer nofollow" className="text-xs font-semibold text-muted hover:text-ink hover:underline">
            למקור ↗
          </a>
          {action}
        </div>
      </div>
    </li>
  );
}

export function RunBoard({ detail }: { detail: RunDetail }) {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [source, setSource] = useState('');
  const [query, setQuery] = useState('');
  const [title, setTitle] = useState('');
  const [color, setColor] = useState<DraftColor>('blue');
  const pickable = detail.isLatest;

  const items = useMemo(
    () => detail.items.filter((i) => (!source || i.source.name === source) && (!query || `${i.title} ${i.intro ?? ''}`.includes(query))),
    [detail.items, source, query],
  );
  const groups = useMemo(() => {
    const map = new Map<string, RunItemDto[]>();
    for (const i of items) map.set(i.category ?? '', [...(map.get(i.category ?? '') ?? []), i]);
    return [...map.entries()].sort(([a], [b]) => ORDER.indexOf(a) - ORDER.indexOf(b));
  }, [items]);
  const sources = [...new Set(detail.items.map((i) => i.source.name))];

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleGroup = (list: RunItemDto[]) => {
    const ids = list.filter((i) => i.status !== 'in_draft').map((i) => i.id);
    const all = ids.every((id) => selected.has(id));
    setSelected((s) => {
      const next = new Set(s);
      for (const id of ids) {
        if (all) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  const save = useMutation({
    mutationFn: (mode: 'magazine' | 'single') =>
      admin.post<{ magazineId: string | null; draftIds: string[] }>('/discovery/save', { itemIds: [...selected], mode, title: title.trim() || undefined, colorLabel: mode === 'single' ? color : undefined }),
    onSuccess: (res, mode) => {
      setSelected(new Set());
      void qc.invalidateQueries({ queryKey: ['run'] });
      void qc.invalidateQueries({ queryKey: ['saved'] });
      toast(mode === 'magazine' ? 'המגזין נשמר. ה-AI מתחיל לכתוב.' : `${res.draftIds.length} כתבות נשמרו בעריכות השמורות.`);
      router.push(res.magazineId ? `/magazines/${res.magazineId}` : '/saved');
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });

  const pull = useMutation({
    mutationFn: (itemId: string) => admin.post<{ runId: string }>(`/discovery/items/${itemId}/pull`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['run'] });
      toast('הכתבה הועברה לאיתור האחרון. אפשר לבחור אותה שם.');
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });

  if (detail.items.length === 0) {
    return <Empty title="אין כתבות באיתור הזה">כל מה שהתפרסם באתרים כבר נמצא באיתורים קודמים. נסו שוב מאוחר יותר.</Empty>;
  }

  return (
    <div className="pb-28">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input type="search" placeholder="חיפוש בכותרות…" value={query} onChange={(e) => setQuery(e.target.value)} className={cx(inputClass, 'max-w-xs')} aria-label="חיפוש בכותרות" />
        <select value={source} onChange={(e) => setSource(e.target.value)} className={cx(inputClass, 'max-w-xs')} aria-label="סינון לפי אתר">
          <option value="">כל האתרים</option>
          {sources.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <span className="text-sm text-muted">{items.length} כתבות</span>
      </div>

      <div className="space-y-8">
        {groups.map(([slug, list]) => (
          <section key={slug} aria-labelledby={`cat-${slug}`}>
            <div className="mb-3 flex items-center gap-3 border-b-2 border-ink pb-2">
              <h3 id={`cat-${slug}`} className="text-lg font-extrabold">
                {slug ? categoryName(slug) : 'ללא קטגוריה'}
              </h3>
              <span className="text-sm text-muted">{list.length}</span>
              {pickable && (
                <button type="button" onClick={() => toggleGroup(list)} className="mr-auto text-sm font-semibold text-brand hover:underline">
                  סימון כל הקטגוריה
                </button>
              )}
            </div>
            <ul className="grid gap-3 xl:grid-cols-2">
              {list.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  selected={selected.has(item.id)}
                  onToggle={pickable ? () => toggle(item.id) : undefined}
                  action={
                    !pickable && item.status !== 'in_draft' ? (
                      <Button size="sm" variant="ghost" busy={pull.isPending && pull.variables === item.id} onClick={() => pull.mutate(item.id)}>
                        העברה לאיתור האחרון
                      </Button>
                    ) : null
                  }
                />
              ))}
            </ul>
          </section>
        ))}
      </div>

      {pickable && selected.size > 0 && (
        <div className="fixed bottom-0 left-0 right-60 z-30 border-t border-line bg-white/95 px-6 py-3 shadow-[0_-4px_20px_rgba(0,0,0,0.06)] backdrop-blur">
          <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-3">
            <b>נבחרו {selected.size} כתבות</b>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="שם המגזין (לא חובה)" className={cx(inputClass, 'max-w-xs')} aria-label="שם המגזין" />
            <Button variant="primary" busy={save.isPending && save.variables === 'magazine'} onClick={() => save.mutate('magazine')}>
              שמירה כמגזין והמשך לעריכה
            </Button>
            <span className="text-sm text-muted">או</span>
            <div className="flex items-center gap-1" role="radiogroup" aria-label="צבע לכתבות בודדות">
              {DRAFT_COLORS.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={COLOR[c]} onClick={() => setColor(c)} className={cx('rounded-full p-1', color === c && 'ring-2 ring-ink')}>
                  <ColorDot color={c} className="size-4" />
                </button>
              ))}
            </div>
            <Button busy={save.isPending && save.variables === 'single'} onClick={() => save.mutate('single')}>
              שמירה ככתבות בודדות
            </Button>
            <Button variant="ghost" onClick={() => setSelected(new Set())}>
              ניקוי
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
