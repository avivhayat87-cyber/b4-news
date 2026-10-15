'use client';
// "כתבות באתר": everything published. Editing opens the article in the editor (the site
// changes only on "שמירה ועדכון באתר"); removing takes it off the site at once and can be
// undone; an admin can delete a removed article for good.
import { CATEGORIES, type PublishedArticleDto, type PublishedArticleList } from '@b4/shared';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useDeferredValue, useState } from 'react';
import { Badge, Button, Empty, ErrorBox, Loading, PageHeader, Thumb, cx, inputClass, useToast } from '@/components/ui';
import { SITE_URL, admin, errorMessage } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { ARTICLE_STATUS, PLACEMENT, categoryName, formatDateTime } from '@/lib/labels';

const TABS = [
  { id: 'published', label: 'באתר' },
  { id: 'unpublished', label: 'הוסרו מהאתר' },
] as const;

type Tab = (typeof TABS)[number]['id'];

export default function ArticlesPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const canEdit = useCan('editor');
  const isAdmin = useCan('admin');
  const [tab, setTab] = useState<Tab>('published');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const q = useDeferredValue(search.trim());

  const list = useInfiniteQuery({
    queryKey: ['articles', tab, q, category],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ status: tab });
      if (q) params.set('q', q);
      if (category) params.set('category', category);
      if (pageParam) params.set('cursor', pageParam);
      return admin.get<PublishedArticleList>(`/articles?${params}`);
    },
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const refresh = () => void qc.invalidateQueries({ queryKey: ['articles'] });
  const onError = (e: unknown) => toast(errorMessage(e), 'danger');

  const edit = useMutation({
    mutationFn: (a: PublishedArticleDto) => admin.post<{ draftId: string }>(`/articles/${a.id}/edit`),
    onSuccess: ({ draftId }) => router.push(`/drafts/${draftId}`),
    onError,
  });
  // The breaking-news ticker: an article goes to its head, or off it (the site shows the newest 12).
  const ticker = useMutation({
    mutationFn: ({ a, on }: { a: PublishedArticleDto; on: boolean }) => admin.post(`/articles/${a.id}/ticker`, { on }),
    onSuccess: (_r, { on }) => {
      toast(on ? 'הכתבה בראש פס המבזקים.' : 'הכתבה ירדה מפס המבזקים.');
      refresh();
    },
    onError,
  });
  const unpublish = useMutation({
    mutationFn: (a: PublishedArticleDto) => admin.post(`/articles/${a.id}/unpublish`),
    onSuccess: () => {
      toast('הכתבה הוסרה מהאתר. אפשר להחזיר אותה מהלשונית "הוסרו מהאתר".');
      refresh();
    },
    onError,
  });
  const republish = useMutation({
    mutationFn: (a: PublishedArticleDto) => admin.post(`/articles/${a.id}/republish`),
    onSuccess: () => {
      toast('הכתבה חזרה לאתר.');
      refresh();
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: (a: PublishedArticleDto) => admin.del(`/articles/${a.id}`),
    onSuccess: () => {
      toast('הכתבה נמחקה לצמיתות.');
      refresh();
    },
    onError,
  });

  return (
    <>
      <PageHeader
        title="כתבות באתר"
        subtitle='כל מה שמתפרסם באתר ובאפליקציה. "עריכה" פותחת את הכתבה בעורך; השינויים עולים לאתר רק אחרי "שמירה ועדכון באתר", באותה כתובת.'
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg bg-white p-1 ring-1 ring-line" role="tablist" aria-label="מצב הכתבות">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cx('rounded-md px-4 py-2 font-bold', tab === t.id ? 'bg-ink text-white' : 'text-ink-2 hover:bg-stone')}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="w-64">
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="חיפוש בכותרות…" aria-label="חיפוש בכותרות" className={inputClass} />
        </div>
        <div className="w-48">
          <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="קטגוריה" className={inputClass}>
            <option value="">כל הקטגוריות</option>
            {CATEGORIES.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {list.isPending ? (
        <Loading />
      ) : list.isError ? (
        <ErrorBox error={list.error} onRetry={() => list.refetch()} />
      ) : items.length === 0 ? (
        <Empty title={tab === 'published' ? 'אין כתבות שמתאימות לחיפוש' : 'אין כתבות שהוסרו מהאתר'} />
      ) : (
        <ul className="space-y-3">
          {items.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-4 rounded-xl bg-white p-3 ring-1 ring-line">
              <Thumb src={a.thumbUrl} className="h-16 w-28 shrink-0 rounded-md" />
              <div className="min-w-0 flex-1">
                <a
                  href={`${SITE_URL}/article/${a.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cx('font-bold hover:text-brand hover:underline', a.status === 'unpublished' && 'pointer-events-none text-ink-2')}
                >
                  {a.title}
                </a>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
                  <span>{categoryName(a.category)}</span>
                  <span>· {formatDateTime(a.publishedAt)}</span>
                  {a.author && <span>· {a.author}</span>}
                  {a.commentCount > 0 && <span>· {a.commentCount} תגובות</span>}
                  {a.onHomepage && <Badge tone="info">{PLACEMENT[a.onHomepage]}</Badge>}
                  {a.onTicker && <Badge tone="warn">במבזקים</Badge>}
                  {a.status !== 'published' && <Badge tone={ARTICLE_STATUS[a.status].tone}>{ARTICLE_STATUS[a.status].label}</Badge>}
                  {a.editing && <Badge tone="warn">בעריכה, עוד לא עודכן באתר</Badge>}
                </div>
              </div>
              {canEdit && (
                <div className="flex flex-wrap gap-2">
                  {a.status !== 'unpublished' ? (
                    <>
                      <Button size="sm" variant="dark" busy={edit.isPending && edit.variables?.id === a.id} onClick={() => edit.mutate(a)}>
                        עריכה
                      </Button>
                      {a.status === 'published' && (
                        <Button size="sm" busy={ticker.isPending && ticker.variables?.a.id === a.id} onClick={() => ticker.mutate({ a, on: !a.onTicker })}>
                          {a.onTicker ? 'הורדה מהמבזקים' : 'למבזקים'}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="danger"
                        busy={unpublish.isPending && unpublish.variables?.id === a.id}
                        onClick={() => confirm(`להסיר את "${a.title}" מהאתר? אפשר יהיה להחזיר אותה.`) && unpublish.mutate(a)}
                      >
                        הסרה מהאתר
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button size="sm" busy={republish.isPending && republish.variables?.id === a.id} onClick={() => republish.mutate(a)}>
                        החזרה לאתר
                      </Button>
                      {isAdmin && (
                        <Button
                          size="sm"
                          variant="danger"
                          busy={remove.isPending && remove.variables?.id === a.id}
                          onClick={() =>
                            confirm(`למחוק לצמיתות את "${a.title}"? הכתבה והתגובות עליה יימחקו ואי אפשר יהיה לשחזר אותן.`) && remove.mutate(a)
                          }
                        >
                          מחיקה לצמיתות
                        </Button>
                      )}
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {list.hasNextPage && (
        <div className="mt-4 text-center">
          <Button busy={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
            עוד כתבות
          </Button>
        </div>
      )}
    </>
  );
}
