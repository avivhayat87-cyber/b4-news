'use client';
// The results of one discovery run, by section. Articles about the same story from several sites
// are one card (the fullest report leads; "הפרדה" takes an article out), and the chief editor's
// picks carry a star, with a quick filter for them. In any run, the latest or an older one, the
// editor marks articles and saves them as a magazine or as single articles; the marked articles
// of one story become ONE article written from all of them.
import { CATEGORIES, DRAFT_COLORS, MAX_STORY_SOURCES, type DraftColor, type RunDetail, type RunItemDto } from '@b4/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { admin, errorMessage } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { COLOR, MISC_FOLDER, RUN_STATUS, categoryName, formatDateTime, timeAgo } from '@/lib/labels';
import { Badge, Button, ColorDot, Empty, Spinner, Thumb, cx, inputClass, useToast } from './ui';

const ORDER = [...CATEGORIES.map((c) => c.slug as string), ''];

/** How often a run's page asks again: while it scans, while the chief editor picks, while foreign headlines are translated. */
export function runRefetch(d: RunDetail | null): number | false {
  if (!d) return false;
  if (['queued', 'running'].includes(d.run.status)) return 2000;
  if (d.picks.status === 'pending') return 3000;
  return d.items.some((i) => i.language && !i.titleHe) ? 3000 : false;
}

function Picks({ detail }: { detail: RunDetail }) {
  const qc = useQueryClient();
  const toast = useToast();
  const canAsk = useCan('editor');
  const ask = useMutation({
    mutationFn: () => admin.post<RunDetail>(`/discovery/runs/${detail.run.id}/picks`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['run'] }),
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  const p = detail.picks;
  const scanning = ['queued', 'running'].includes(detail.run.status);
  if (scanning || detail.items.length === 0) return null;
  const askButton = (label: string) =>
    canAsk && (
      <Button size="sm" busy={ask.isPending} onClick={() => ask.mutate()}>
        {label}
      </Button>
    );
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line-soft pt-3 text-[15px]" aria-live="polite">
      {p.status === 'pending' ? (
        <span className="flex items-center gap-2 font-semibold text-ink-2">
          <Spinner small /> העורך הראשי קורא את הכתבות ובוחר המלצות…
        </span>
      ) : p.status === 'ready' ? (
        <span className="font-semibold">
          <span className="text-warn">★</span> העורך הראשי המליץ על {p.count} סיפורים
        </span>
      ) : p.status === 'failed' ? (
        <>
          <span className="font-semibold text-brand-deep">{p.error}</span>
          {askButton('לבקש שוב')}
        </>
      ) : (
        <>
          <span className="text-muted">אין המלצות לאיתור הזה.</span>
          {askButton('לבקש המלצות מהעורך הראשי')}
        </>
      )}
    </div>
  );
}

export function RunHeader({ detail }: { detail: RunDetail }) {
  const r = detail.run;
  const status = RUN_STATUS[r.status];
  return (
    <div className="mb-5 rounded-xl bg-white p-5 ring-1 ring-line">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-extrabold">
          {r.region === 'international' ? 'איתור מחו״ל' : 'איתור'} מ-{formatDateTime(r.createdAt)}
        </h2>
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
      <Picks detail={detail} />
    </div>
  );
}

/** A story: one article, or the same story from several sites (lead first). */
type Story = { id: string; lead: RunItemDto; items: RunItemDto[]; pick: RunItemDto['pick'] };

function storiesOf(items: RunItemDto[]): Story[] {
  const map = new Map<string, RunItemDto[]>();
  for (const i of items) {
    const key = i.storyId ?? i.id;
    map.set(key, [...(map.get(key) ?? []), i]);
  }
  return [...map.entries()].map(([id, list]) => ({
    id,
    lead: list[0]!,
    items: list,
    // A story is recommended when any of its reports is (the picks name the lead of the moment they were made).
    pick: list.map((i) => i.pick).filter((p) => p !== null).sort((a, b) => b.score - a.score)[0] ?? null,
  }));
}

const free = (i: RunItemDto) => i.status !== 'in_draft';

function PickLine({ pick }: { pick: NonNullable<RunItemDto['pick']> }) {
  return (
    <p className="mt-0.5 text-xs font-bold text-warn" title={`ציון חשיבות: ${pick.score}`}>
      ★ מומלץ{pick.reason ? ` · ${pick.reason}` : ''}
    </p>
  );
}

function ItemMeta({ item }: { item: RunItemDto }) {
  return (
    <>
      <span className="font-bold text-ink-2">{item.source.name}</span>
      <span>·</span>
      <span>{timeAgo(item.publishedAt)}</span>
      {item.origin === 'pulled' && <Badge tone="info">הועבר מאיתור קודם</Badge>}
      {!free(item) && <Badge tone="warn">כבר בעריכה</Badge>}
      {item.language && (
        <Badge tone={item.titleHe ? 'muted' : 'info'}>
          {item.language.toUpperCase()} · {item.titleHe ? 'תורגם' : 'מתרגם…'}
        </Badge>
      )}
    </>
  );
}

function Headline({ item, htmlFor, id }: { item: RunItemDto; htmlFor?: string; id: string }) {
  return (
    <>
      {/* Foreign articles: the Hebrew translation first, the original headline under it. */}
      <label htmlFor={htmlFor} id={id} className="mt-1 block cursor-pointer font-display text-[16px] font-bold leading-snug">
        {item.titleHe ?? item.title}
      </label>
      {item.titleHe && (
        <p className="mt-0.5 text-xs text-muted" dir="auto">
          {item.title}
        </p>
      )}
    </>
  );
}

const sourceLink = (url: string) => (
  <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="text-xs font-semibold text-muted hover:text-ink hover:underline">
    למקור ↗
  </a>
);

type CardProps = {
  story: Story;
  selected: Set<string>;
  onToggle: (ids: string[]) => void;
  onSeparate: (item: RunItemDto, separated: boolean) => void;
  busyItem: string | null;
  canEdit: boolean;
};

function SingleCard({ story, selected, onToggle, onSeparate, busyItem, canEdit }: CardProps) {
  const item = story.lead;
  const id = `pick-${item.id}`;
  return (
    <li className={cx('flex gap-3 rounded-xl bg-white p-3 ring-1 transition-shadow', selected.has(item.id) ? 'ring-2 ring-brand' : 'ring-line', !free(item) && 'opacity-60')}>
      {canEdit && <input id={id} type="checkbox" checked={selected.has(item.id)} disabled={!free(item)} onChange={() => onToggle([item.id])} className="mt-1 size-5 shrink-0 accent-[var(--color-brand)]" aria-describedby={`${id}-title`} />}
      <Thumb src={item.imageUrl} className="h-20 w-28 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <ItemMeta item={item} />
        </div>
        {story.pick && <PickLine pick={story.pick} />}
        <Headline item={item} htmlFor={canEdit ? id : undefined} id={`${id}-title`} />
        {(item.introHe ?? item.intro) && (
          <p className="mt-1 line-clamp-2 text-sm text-ink-2" dir="auto">
            {item.introHe ?? item.intro}
          </p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          {sourceLink(item.url)}
          {item.separated && canEdit && (
            <button type="button" disabled={busyItem === item.id} onClick={() => onSeparate(item, false)} className="text-xs font-semibold text-brand hover:underline disabled:opacity-50">
              החזרה לקבוצה
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

function StoryCard({ story, selected, onToggle, onSeparate, busyItem, canEdit }: CardProps) {
  const [open, setOpen] = useState(false);
  const lead = story.lead;
  const id = `story-${story.id}`;
  const usable = story.items.filter(free).map((i) => i.id);
  const marked = usable.filter((i) => selected.has(i));
  const all = usable.length > 0 && marked.length === usable.length;
  const sites = [...new Set(story.items.map((i) => i.source.name))];
  const others = sites.filter((s) => s !== lead.source.name);
  return (
    <li className={cx('rounded-xl bg-white p-3 ring-1 transition-shadow xl:col-span-2', marked.length ? 'ring-2 ring-brand' : 'ring-line')}>
      <div className="flex gap-3">
        {canEdit && (
          <input
            id={id}
            type="checkbox"
            checked={all}
            ref={(el) => {
              if (el) el.indeterminate = marked.length > 0 && !all;
            }}
            disabled={usable.length === 0}
            onChange={() => onToggle(all ? marked : usable)}
            className="mt-1 size-5 shrink-0 accent-[var(--color-brand)]"
            aria-label={`בחירת הסיפור: כתבה אחת מ-${usable.length} המקורות`}
            aria-describedby={`${id}-title`}
          />
        )}
        <Thumb src={lead.imageUrl ?? story.items.find((i) => i.imageUrl)?.imageUrl ?? null} className="h-20 w-28 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <Badge tone="ink">{sites.length > 1 ? `${sites.length} אתרים` : `${story.items.length} כתבות`} על אותו סיפור</Badge>
            <ItemMeta item={lead} />
          </div>
          {story.pick && <PickLine pick={story.pick} />}
          <Headline item={lead} htmlFor={canEdit ? id : undefined} id={`${id}-title`} />
          {(lead.introHe ?? lead.intro) && (
            <p className="mt-1 line-clamp-2 text-sm text-ink-2" dir="auto">
              {lead.introHe ?? lead.intro}
            </p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs">
            {others.length > 0 && <span className="text-muted">גם ב{others.join(', ')}</span>}
            <button type="button" aria-expanded={open} aria-controls={`${id}-list`} onClick={() => setOpen(!open)} className="font-semibold text-brand hover:underline">
              {open ? 'הסתרת הכתבות' : `כל ${story.items.length} הכתבות`}
            </button>
            {sourceLink(lead.url)}
          </div>
          {marked.length > 1 && <p className="mt-1.5 text-xs font-bold text-ink">ייכתבו ככתבה אחת מ-{Math.min(marked.length, MAX_STORY_SOURCES)} המקורות שסומנו</p>}
        </div>
      </div>
      {open && (
        <ul id={`${id}-list`} className="mt-3 divide-y divide-line-soft border-t border-line-soft">
          {story.items.map((item) => {
            const itemId = `pick-${item.id}`;
            return (
              <li key={item.id} className={cx('flex items-start gap-3 py-2.5', !free(item) && 'opacity-60')}>
                {canEdit && <input id={itemId} type="checkbox" checked={selected.has(item.id)} disabled={!free(item)} onChange={() => onToggle([item.id])} className="mt-1 size-4 shrink-0 accent-[var(--color-brand)]" aria-describedby={`${itemId}-title`} />}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    <ItemMeta item={item} />
                  </div>
                  <label htmlFor={canEdit ? itemId : undefined} id={`${itemId}-title`} className="mt-0.5 block cursor-pointer text-[15px] font-semibold leading-snug">
                    {item.titleHe ?? item.title}
                  </label>
                  <div className="mt-1 flex flex-wrap items-center gap-3">
                    {sourceLink(item.url)}
                    {canEdit && (
                      <button type="button" disabled={busyItem === item.id} onClick={() => onSeparate(item, true)} className="text-xs font-semibold text-ink-2 hover:text-brand hover:underline disabled:opacity-50">
                        הפרדה מהקבוצה
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

export function RunBoard({ detail }: { detail: RunDetail }) {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const canEdit = useCan('editor');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [source, setSource] = useState('');
  const [query, setQuery] = useState('');
  const [onlyPicks, setOnlyPicks] = useState(false);
  const [title, setTitle] = useState('');
  const [color, setColor] = useState<DraftColor>('blue');

  const stories = useMemo(() => storiesOf(detail.items), [detail.items]);
  const picksReady = detail.picks.status === 'ready' && stories.some((s) => s.pick);
  const filtering = onlyPicks && picksReady;
  const visible = useMemo(() => {
    const q = query.toLowerCase();
    const match = (i: RunItemDto) => (!source || i.source.name === source) && (!q || `${i.title} ${i.intro ?? ''} ${i.titleHe ?? ''} ${i.introHe ?? ''}`.toLowerCase().includes(q));
    return stories.filter((s) => s.items.some(match) && (!filtering || s.pick));
  }, [stories, source, query, filtering]);
  const sections = useMemo(() => {
    const map = new Map<string, Story[]>();
    for (const s of visible) map.set(s.lead.category ?? '', [...(map.get(s.lead.category ?? '') ?? []), s]);
    // The chief editor's picks first in each section, the most important on top; then the rest as they came.
    for (const list of map.values()) list.sort((a, b) => (b.pick?.score ?? 0) - (a.pick?.score ?? 0));
    return [...map.entries()].sort(([a], [b]) => ORDER.indexOf(a) - ORDER.indexOf(b));
  }, [visible]);
  const sources = [...new Set(detail.items.map((i) => i.source.name))];
  const pickCount = stories.filter((s) => s.pick).length;

  const toggle = (ids: string[]) =>
    setSelected((s) => {
      const next = new Set(s);
      const on = ids.some((id) => !next.has(id));
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  const toggleSection = (list: Story[]) => toggle(list.flatMap((s) => s.items.filter(free).map((i) => i.id)));

  /** What saving makes: the marked articles in the board's order, and each story's marked reports as one article. */
  const plan = useMemo(() => {
    const itemIds: string[] = [];
    const groups: string[][] = [];
    for (const s of stories) {
      const marked = s.items.filter((i) => free(i) && selected.has(i.id)).map((i) => i.id).slice(0, MAX_STORY_SOURCES);
      if (marked.length === 0) continue;
      itemIds.push(...marked);
      if (marked.length > 1) groups.push(marked);
    }
    return { itemIds, stories: groups, articles: itemIds.length - groups.reduce((n, g) => n + g.length - 1, 0) };
  }, [stories, selected]);

  const save = useMutation({
    mutationFn: (mode: 'magazine' | 'single') =>
      admin.post<{ magazineId: string | null; draftIds: string[] }>('/discovery/save', {
        itemIds: plan.itemIds,
        stories: plan.stories,
        mode,
        title: title.trim() || undefined,
        colorLabel: mode === 'single' ? color : undefined,
      }),
    onSuccess: (res, mode) => {
      setSelected(new Set());
      void qc.invalidateQueries({ queryKey: ['run'] });
      void qc.invalidateQueries({ queryKey: ['saved'] });
      toast(mode === 'magazine' ? 'המגזין נשמר. ה-AI מתחיל לכתוב.' : `${res.draftIds.length} כתבות נשמרו בעריכות השמורות.`);
      router.push(res.magazineId ? `/magazines/${res.magazineId}` : '/saved');
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });

  const separate = useMutation({
    mutationFn: ({ item, separated }: { item: RunItemDto; separated: boolean }) => admin.post<RunDetail>(`/discovery/runs/${detail.run.id}/items/${item.id}/separate`, { separated }),
    onSuccess: (_, { separated }) => {
      void qc.invalidateQueries({ queryKey: ['run'] });
      toast(separated ? 'הכתבה הופרדה מהקבוצה ועומדת לבד.' : 'הכתבה הוחזרה. אם היא על אותו סיפור, היא תצטרף לקבוצה שלו.');
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });

  if (detail.items.length === 0) {
    return <Empty title="אין כתבות באיתור הזה">כל מה שהתפרסם באתרים כבר נמצא באיתורים קודמים. נסו שוב מאוחר יותר.</Empty>;
  }

  const cardProps = { selected, onToggle: toggle, onSeparate: (item: RunItemDto, separated: boolean) => separate.mutate({ item, separated }), busyItem: separate.isPending ? (separate.variables?.item.id ?? null) : null, canEdit };

  return (
    <div className="pb-28">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {picksReady && (
          <button
            type="button"
            aria-pressed={onlyPicks}
            onClick={() => setOnlyPicks(!onlyPicks)}
            className={cx('inline-flex h-10 items-center gap-2 rounded-lg px-4 font-bold ring-1 transition-colors', onlyPicks ? 'bg-ink text-white ring-ink' : 'bg-white text-ink ring-line hover:bg-stone')}
          >
            <span className={onlyPicks ? 'text-white' : 'text-warn'}>★</span> מומלצים ({pickCount})
          </button>
        )}
        <input type="search" placeholder="חיפוש בכותרות…" value={query} onChange={(e) => setQuery(e.target.value)} className={cx(inputClass, 'max-w-xs')} aria-label="חיפוש בכותרות" />
        <select value={source} onChange={(e) => setSource(e.target.value)} className={cx(inputClass, 'max-w-xs')} aria-label="סינון לפי אתר">
          <option value="">כל האתרים</option>
          {sources.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <span className="text-sm text-muted">
          {visible.length} סיפורים · {visible.reduce((n, s) => n + s.items.length, 0)} כתבות
        </span>
      </div>

      <div className="space-y-8">
        {sections.map(([slug, list]) => (
          <section key={slug} aria-labelledby={`cat-${slug}`}>
            <div className="mb-3 flex flex-wrap items-center gap-3 border-b-2 border-ink pb-2">
              <h3 id={`cat-${slug}`} className="text-lg font-extrabold">
                {slug ? categoryName(slug) : MISC_FOLDER.name}
              </h3>
              <span className="text-sm text-muted">{list.length}</span>
              {!slug && <span className="text-sm text-muted">· {MISC_FOLDER.hint}</span>}
              {canEdit && (
                <button type="button" onClick={() => toggleSection(list)} className="mr-auto text-sm font-semibold text-brand hover:underline">
                  סימון כל הקטגוריה
                </button>
              )}
            </div>
            <ul className="grid gap-3 xl:grid-cols-2">
              {list.map((story) => (story.items.length > 1 ? <StoryCard key={story.id} story={story} {...cardProps} /> : <SingleCard key={story.id} story={story} {...cardProps} />))}
            </ul>
          </section>
        ))}
        {sections.length === 0 && <Empty title="אין כתבות שמתאימות לסינון">נסו לנקות את החיפוש או את הסינון.</Empty>}
      </div>

      {canEdit && plan.itemIds.length > 0 && (
        <div className="fixed bottom-0 left-0 right-60 z-30 border-t border-line bg-white/95 px-6 py-3 shadow-[0_-4px_20px_rgba(0,0,0,0.06)] backdrop-blur">
          <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-3">
            <b>
              נבחרו {plan.itemIds.length} כתבות
              {plan.stories.length > 0 && (
                <span className="font-normal text-ink-2">
                  {' · '}
                  {plan.articles === 1 ? 'תיכתב כתבה אחת מכל המקורות' : `ייכתבו ${plan.articles} כתבות (${plan.stories.length === 1 ? 'אחת מהן' : plan.stories.length} מכמה מקורות)`}
                </span>
              )}
            </b>
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
