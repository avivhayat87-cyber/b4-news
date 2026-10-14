'use client';
// Social networks, in two views. Before publishing: the report of distribution plans, where the
// social editor's choices for each article are changed in a click. On the site: every article
// that is on the site; pick the ones that haven't gone out yet, let the AI prepare a branded post
// and story, edit, publish.
import { SHARE_FILTERS, type ShareFilter, type ShareList, type ShareListItem } from '@b4/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { PlanEditor } from '@/components/social/plan-editor';
import { PlanReport } from '@/components/social/plan-report';
import { PublishDialog } from '@/components/social/publish-dialog';
import { ShareEditor } from '@/components/social/share-editor';
import { Badge, Button, Card, Empty, ErrorBox, Loading, PageHeader, Spinner, Thumb, cx, inputClass, useToast } from '@/components/ui';
import { admin, errorMessage } from '@/lib/api';
import { PLATFORM, SHARE_FILTER, SHARE_TEMPLATE, timeAgo } from '@/lib/labels';

const FILTERS: { id: ShareFilter; label: string }[] = SHARE_FILTERS.map((id) => ({ id, label: SHARE_FILTER[id] }));

/** One chip per network: posted, prepared for manual posting, or failed. */
function PostChips({ item }: { item: ShareListItem }) {
  const byPlatform = new Map<string, { posted: boolean; prepared: boolean; failed: boolean }>();
  for (const p of item.posts) {
    const v = byPlatform.get(p.platform) ?? { posted: false, prepared: false, failed: false };
    if (p.status === 'posted') v.posted = true;
    else if (p.status === 'skipped') v.prepared = true;
    else if (p.status === 'failed') v.failed = true;
    byPlatform.set(p.platform, v);
  }
  if (!byPlatform.size) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {[...byPlatform].map(([platform, v]) => (
        <Badge key={platform} tone={v.posted ? 'ok' : v.failed ? 'danger' : 'warn'}>
          {v.posted ? '✓ ' : ''}
          {PLATFORM[platform as keyof typeof PLATFORM]}
          {!v.posted && (v.failed ? ' · נכשל' : ' · ידני')}
        </Badge>
      ))}
    </span>
  );
}

const VIEWS = [
  ['plans', 'לפני פרסום: תוכנית הפצה'],
  ['site', 'כתבות באתר'],
] as const;

export default function SocialPage() {
  const [view, setView] = useState<(typeof VIEWS)[number][0]>('plans');
  const [openArticle, setOpenArticle] = useState<number | null>(null);
  const [openDraft, setOpenDraft] = useState<string | null>(null);

  // "/social?article=<id>" (from a published plan) opens that article on the site view.
  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get('article'));
    if (id > 0) {
      setView('site');
      setOpenArticle(id);
    }
  }, []);

  return (
    <>
      <PageHeader
        title="רשתות חברתיות"
        subtitle="לפני פרסום: עורך הרשתות מחליט לכל כתבה איך היא עולה (מסגרת, פוסט, סטורי, ריל), ומשנים בלחיצה. אחרי פרסום: כל הכתבות שבאתר, עריכה ופרסום ברשתות. הקישור תמיד מוביל לעמוד הכתבה."
      />
      <div className="mb-5 inline-flex rounded-xl bg-white p-1 ring-1 ring-line" role="tablist">
        {VIEWS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)} className={cx('rounded-lg px-5 py-2.5 text-[15px] font-extrabold', view === id ? 'bg-ink text-white' : 'text-ink-2 hover:bg-stone')}>
            {label}
          </button>
        ))}
      </div>
      {view === 'plans' ? (
        <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
          <div className="min-w-0 flex-1">
            <PlanReport
              openDraftId={openDraft}
              onOpen={setOpenDraft}
              onOpenArticle={(id) => {
                setView('site');
                setOpenArticle(id);
              }}
            />
          </div>
          <aside className="w-full shrink-0 xl:sticky xl:top-0 xl:max-h-[calc(100vh-8rem)] xl:w-[560px] xl:overflow-y-auto xl:rounded-xl">
            <Card>
              {openDraft ? (
                <PlanEditor key={openDraft} draftId={openDraft} />
              ) : (
                <div className="space-y-3 py-4">
                  <p className="font-display text-lg font-extrabold">איך זה עובד</p>
                  <ol className="list-decimal space-y-1.5 pr-5 text-[15px] text-ink-2">
                    <li>כשמסמנים טקסט של כתבה כסופי, עורך הרשתות כותב לה תוכנית: מסגרת עיצוב, פוסט, סטורי, והאם מתאים ריל.</li>
                    <li>כאן רואים את כל ההחלטות שלו ואת הסיבות, ומשנים בלחיצה. כל שינוי נשמר מיד, והוא לומד ממנו.</li>
                    <li>ריל עולה כסף, ולכן הוא רק ממליץ. &quot;אישור ריל&quot; מפעיל אחרי הפרסום את כל השלבים, והסרטון מחכה לאישור אחרון.</li>
                    <li>כשהכתבה מתפרסמת באתר, הפוסט והסטורי עולים לרשתות לבד.</li>
                  </ol>
                  <p className="text-sm text-muted">לחיצה על כתבה ברשימה פותחת כאן את התוכנית המלאה: העיצובים, הטקסטים והריל.</p>
                </div>
              )}
            </Card>
          </aside>
        </div>
      ) : (
        <SiteArticles open={openArticle} setOpen={setOpenArticle} />
      )}
    </>
  );
}

/** The articles that are on the site, and their posts. */
function SiteArticles({ open, setOpen }: { open: number | null; setOpen(id: number | null): void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState<ShareFilter>('pending');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<number[]>([]);
  const [publishing, setPublishing] = useState<number[] | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => setPage(1), [filter, query]);

  const list = useQuery({
    queryKey: ['social-list', filter, query, page],
    queryFn: () => admin.get<ShareList>(`/social/articles?filter=${filter}&page=${page}${query ? `&q=${encodeURIComponent(query)}` : ''}`),
    refetchInterval: (r) => (r.state.data?.items.some((i) => i.busy) ? 2500 : 30_000),
    placeholderData: (prev) => prev,
  });
  const items = list.data?.items ?? [];
  const known = new Map(items.map((i) => [i.articleId, i]));

  const generate = useMutation({
    mutationFn: (articleIds: number[]) => admin.post('/social/generate', { articleIds }),
    onSuccess: (_d, ids) => {
      toast(ids.length > 1 ? `ה-AI מכין ${ids.length} פוסטים` : 'ה-AI מכין את הפוסט');
      void qc.invalidateQueries({ queryKey: ['social-list'] });
      void qc.invalidateQueries({ queryKey: ['social-share'] });
      if (!open && ids[0]) setOpen(ids[0]);
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });

  const toggle = (id: number) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const allOnPage = items.length > 0 && items.every((i) => selected.includes(i.articleId));
  const selectedItems = selected.map((id) => known.get(id)).filter((x): x is ShareListItem => Boolean(x));
  const withoutKit = selectedItems.filter((i) => !i.hasKit).length;

  return (
    <>
      {list.data && (
        <p className="-mt-2 mb-3">
          <Badge tone={list.data.pendingCount ? 'warn' : 'ok'}>{list.data.pendingCount} כתבות באתר ממתינות לרשתות</Badge>
        </p>
      )}

      <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
        <Card className="min-w-0 flex-1">
          <div className="-mx-5 -mt-5 mb-4 flex flex-wrap items-center gap-2 border-b border-line-soft px-5 py-3">
            <div className="flex gap-1" role="tablist" aria-label="סינון">
              {FILTERS.map((f) => (
                <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} onClick={() => setFilter(f.id)} className={cx('rounded-full px-3 py-1.5 text-sm font-bold', filter === f.id ? 'bg-ink text-white' : 'bg-stone text-ink-2 hover:bg-line')}>
                  {f.label}
                  {f.id === 'pending' && list.data ? ` (${list.data.pendingCount})` : ''}
                </button>
              ))}
            </div>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש לפי כותרת" aria-label="חיפוש לפי כותרת" className={cx(inputClass, 'mr-auto max-w-56 py-1.5')} />
          </div>

          {list.isPending ? (
            <Loading />
          ) : list.isError ? (
            <ErrorBox error={list.error} onRetry={() => list.refetch()} />
          ) : items.length === 0 ? (
            <Empty title={filter === 'pending' ? 'כל הכתבות כבר יצאו לרשתות' : 'אין כתבות להצגה'}>{filter === 'pending' ? 'כתבות חדשות שיעלו לאתר יופיעו כאן.' : 'נסו סינון אחר או חיפוש אחר.'}</Empty>
          ) : (
            <>
              <label className="mb-2 flex items-center gap-2 text-sm text-muted">
                <input type="checkbox" checked={allOnPage} onChange={() => setSelected(allOnPage ? selected.filter((id) => !known.has(id)) : [...new Set([...selected, ...items.map((i) => i.articleId)])])} />
                בחירת כל הכתבות בעמוד
              </label>
              <ul className="-mx-5 divide-y divide-line-soft">
                {items.map((i) => (
                  <li key={i.articleId} className={cx('flex items-center gap-3 px-5 py-3', open === i.articleId && 'bg-brand-soft/50')}>
                    <input type="checkbox" checked={selected.includes(i.articleId)} onChange={() => toggle(i.articleId)} aria-label={`בחירת "${i.title}"`} />
                    <button type="button" onClick={() => setOpen(i.articleId)} className="flex min-w-0 flex-1 items-center gap-3 text-right">
                      <Thumb src={i.thumbUrl} className="h-14 w-24 shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-bold">{i.title}</span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                          <span>{i.category}</span>
                          <span>·</span>
                          <span>{timeAgo(i.publishedAt)}</span>
                          {i.busy ? (
                            <span className="flex items-center gap-1 font-semibold text-info">
                              <Spinner small /> ה-AI עובד
                            </span>
                          ) : i.hasKit ? (
                            <Badge tone="info">פוסט מוכן · {i.template ? SHARE_TEMPLATE[i.template].name : ''}</Badge>
                          ) : null}
                          <PostChips item={i} />
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {list.data && list.data.total > list.data.pageSize && (
                <div className="mt-4 flex items-center justify-center gap-3 text-sm">
                  <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                    הקודם
                  </Button>
                  <span className="text-muted">
                    עמוד {page} מתוך {Math.ceil(list.data.total / list.data.pageSize)}
                  </span>
                  <Button size="sm" disabled={page * list.data.pageSize >= list.data.total} onClick={() => setPage(page + 1)}>
                    הבא
                  </Button>
                </div>
              )}
            </>
          )}

          {selected.length > 0 && (
            <div className="sticky bottom-0 -mx-5 -mb-5 mt-4 flex flex-wrap items-center gap-2 rounded-b-xl border-t border-line bg-white px-5 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.05)]">
              <span className="font-bold">נבחרו {selected.length}</span>
              <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
                ניקוי
              </Button>
              <span className="mr-auto flex gap-2">
                <Button variant="dark" busy={generate.isPending} disabled={selected.length > 20} onClick={() => generate.mutate(selected.filter((id) => !known.get(id)?.hasKit).length ? selected.filter((id) => !known.get(id)?.hasKit) : selected)}>
                  {withoutKit ? `הכנה עם AI (${withoutKit})` : 'ניסוח מחדש עם AI'}
                </Button>
                <Button variant="primary" disabled={selected.length > 20} onClick={() => setPublishing(selected)}>
                  פרסום ברשתות…
                </Button>
              </span>
              {selected.length > 20 && <p className="w-full text-xs text-brand">אפשר עד 20 כתבות בכל פעם.</p>}
            </div>
          )}
        </Card>

        {/* The editor scrolls on its own, so its buttons stay reachable while the list scrolls. */}
        <aside className="w-full shrink-0 xl:sticky xl:top-0 xl:max-h-[calc(100vh-8rem)] xl:w-[560px] xl:overflow-y-auto xl:rounded-xl">

          <Card>
            {open ? (
              <ShareEditor key={open} articleId={open} onPublish={() => setPublishing([open])} />
            ) : (
              <div className="space-y-3 py-4">
                <p className="font-display text-lg font-extrabold">איך זה עובד</p>
                <ol className="list-decimal space-y-1.5 pr-5 text-[15px] text-ink-2">
                  <li>בוחרים כתבות מהרשימה (ברירת המחדל: כתבות שעוד לא יצאו לרשתות).</li>
                  <li>&quot;הכנה עם AI&quot;: מסגרת עיצוב, כותרת לתמונה, משפט פתיחה, טקסט עם שאלה לתגובות והאשטגים.</li>
                  <li>לוחצים על כתבה כדי לראות את הפוסט והסטורי בדיוק כמו שיעלו, ולערוך.</li>
                  <li>&quot;פרסום ברשתות&quot;: בוחרים פוסט, סטורי או שניהם, ואת החשבונות. הקישור לכתבה עולה בתגובה הראשונה בפייסבוק ובאינסטגרם, ובגוף ההודעה בטלגרם.</li>
                </ol>
                <p className="text-sm text-muted">ארבע מסגרות עיצוב: {Object.values(SHARE_TEMPLATE).map((t) => t.name).join(', ')}.</p>
              </div>
            )}
          </Card>
        </aside>
      </div>

      {publishing && (
        <PublishDialog
          articleIds={publishing}
          missingKits={publishing.filter((id) => (known.has(id) ? !known.get(id)!.hasKit : false)).length}
          onClose={() => setPublishing(null)}
          onStarted={() => {
            setSelected([]);
            void qc.invalidateQueries({ queryKey: ['social-list'] });
            void qc.invalidateQueries({ queryKey: ['social-share'] });
          }}
        />
      )}
    </>
  );
}
