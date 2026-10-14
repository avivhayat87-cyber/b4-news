'use client';
// "מנויים וגולשים": who signed up to comment (readers sign in with a one-time email code, no
// password) and who signed up for the newsletter (confirmed by email), what the newsroom can do
// about them, and what this environment still needs for their mail to arrive.
import type { AdminReaderComment, AdminReaderDto, AudienceOverview, ReaderList, SubscriberDto, SubscriberList } from '@b4/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDeferredValue, useState } from 'react';
import { Badge, Button, Card, Empty, ErrorBox, Loading, PageHeader, cx, inputClass, useToast } from '@/components/ui';
import { SITE_URL, admin, errorMessage } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { AUDIENCE_SETUP_LABEL, SUBSCRIBER_STATUS, formatDateTime, timeAgo } from '@/lib/labels';

const TABS = [
  { id: 'readers', label: 'גולשים רשומים' },
  { id: 'newsletter', label: 'ניוזלטר' },
] as const;

const READER_FILTER = [
  { id: 'all', label: 'כולם' },
  { id: 'active', label: 'פעילים' },
  { id: 'banned', label: 'חסומים' },
] as const;

const SUBSCRIBER_FILTER = [
  { id: 'active', label: 'מנויים פעילים' },
  { id: 'pending', label: 'ממתינים לאישור' },
  { id: 'unsubscribed', label: 'הוסרו' },
  { id: 'all', label: 'כולם' },
] as const;

function Segments<T extends string>({ items, value, onChange, label }: { items: readonly { id: T; label: string }[]; value: NoInfer<T>; onChange: (v: NoInfer<T>) => void; label: string }) {
  return (
    <div className="inline-flex rounded-lg bg-white p-1 ring-1 ring-line" role="tablist" aria-label={label}>
      {items.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cx('rounded-md px-4 py-2 font-bold', value === t.id ? 'bg-ink text-white' : 'text-ink-2 hover:bg-stone')}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="rounded-xl bg-white p-5 ring-1 ring-line">
      <p className="text-sm font-semibold text-muted">{label}</p>
      <p className="mt-1 font-display text-3xl font-extrabold">{value.toLocaleString('he-IL')}</p>
      {note && <p className="text-xs text-muted">{note}</p>}
    </div>
  );
}

export default function AudiencePage() {
  const canSee = useCan('editor');
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('readers');
  const overview = useQuery({ queryKey: ['audience'], queryFn: () => admin.get<AudienceOverview>('/audience') });
  const o = overview.data;
  const missing = o?.setup.filter((x) => !x.ok) ?? [];

  return (
    <>
      <PageHeader
        title="מנויים וגולשים"
        subtitle="מי שנרשם לאתר כדי להגיב, ומי שנרשם לניוזלטר. גולשים מתחברים עם קוד חד-פעמי שנשלח למייל, בלי סיסמה, ומאשרים את תנאי השימוש."
      />

      {overview.isError ? (
        <ErrorBox error={overview.error} onRetry={() => overview.refetch()} />
      ) : !o ? (
        <Loading />
      ) : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="גולשים רשומים" value={o.readers.total} note={`${o.readers.newThisWeek} הצטרפו השבוע · ${o.readers.banned} חסומים`} />
            <Stat label="נכנסו בחודש האחרון" value={o.readers.active30d} />
            <Stat label="מנויי ניוזלטר פעילים" value={o.subscribers.active} note={`${o.subscribers.pending} ממתינים לאישור · ${o.subscribers.unsubscribed} הוסרו`} />
            <Stat label="התראות באפליקציה" value={o.devices.ios + o.devices.android + o.devices.web} note={`iPhone ${o.devices.ios} · Android ${o.devices.android}`} />
          </div>

          <Card title={missing.length ? `מה עוד צריך כדי שזה יעבוד (${missing.length})` : 'הכל מוגדר'} actions={<Badge tone={missing.length ? 'warn' : 'ok'}>{missing.length ? 'חסרות הגדרות' : 'מוכן'}</Badge>}>
            <ul className="space-y-3">
              {o.setup.map((x) => (
                <li key={x.key} className="flex gap-3">
                  <span className={cx('mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white', x.ok ? 'bg-ok' : 'bg-warn')} aria-hidden>
                    {x.ok ? '✓' : '!'}
                  </span>
                  <div>
                    <p className="font-bold">
                      {AUDIENCE_SETUP_LABEL[x.key].title}
                      <span className="sr-only">{x.ok ? ' (מוגדר)' : ' (חסר)'}</span>
                    </p>
                    {!x.ok && <p className="text-sm text-ink-2">{AUDIENCE_SETUP_LABEL[x.key].why}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}

      <div className="mb-4 mt-8">
        <Segments items={TABS} value={tab} onChange={setTab} label="סוג הרשמה" />
      </div>
      {!canSee ? (
        <Empty title="רשימות הגולשים והמנויים כוללות פרטים אישיים, ולכן הן פתוחות לעורכים ולמנהלים בלבד." />
      ) : tab === 'readers' ? (
        <Readers />
      ) : (
        <Subscribers />
      )}
    </>
  );
}

function Readers() {
  const qc = useQueryClient();
  const toast = useToast();
  const isAdmin = useCan('admin');
  const [filter, setFilter] = useState<(typeof READER_FILTER)[number]['id']>('all');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const q = useDeferredValue(search.trim());
  const list = useInfiniteQuery({
    queryKey: ['readers', filter, q],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ status: filter });
      if (q) params.set('q', q);
      if (pageParam) params.set('cursor', pageParam);
      return admin.get<ReaderList>(`/readers?${params}`);
    },
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const done = (message: string) => () => {
    toast(message);
    void qc.invalidateQueries({ queryKey: ['readers'] });
    void qc.invalidateQueries({ queryKey: ['audience'] });
  };
  const onError = (e: unknown) => toast(errorMessage(e), 'danger');

  const ban = useMutation({
    mutationFn: ({ r, reason }: { r: AdminReaderDto; reason: string }) => admin.post(`/readers/${r.id}/ban`, { reason, hideComments: true }),
    onSuccess: done('הגולש נחסם, נותק מכל המכשירים, והתגובות שלו הוסתרו.'),
    onError,
  });
  const unban = useMutation({ mutationFn: (r: AdminReaderDto) => admin.post(`/readers/${r.id}/unban`), onSuccess: done('החסימה בוטלה. תגובות שהוסתרו נשארות מוסתרות; אפשר להחזיר אותן במסך התגובות.'), onError });
  const signOut = useMutation({ mutationFn: (r: AdminReaderDto) => admin.post(`/readers/${r.id}/sign-out`), onSuccess: done('הגולש נותק מכל המכשירים. בכניסה הבאה יקבל קוד חדש למייל.'), onError });
  const remove = useMutation({ mutationFn: (r: AdminReaderDto) => admin.del(`/readers/${r.id}`), onSuccess: done('החשבון נמחק לצמיתות, עם התגובות שלו.'), onError });

  const askBan = (r: AdminReaderDto) => {
    const reason = prompt(`למה לחסום את ${r.displayName}? (הסיבה נשמרת ביומן, הגולש לא רואה אותה)`)?.trim();
    if (reason && reason.length >= 2) ban.mutate({ r, reason });
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segments items={READER_FILTER} value={filter} onChange={setFilter} label="מצב הגולש" />
        <div className="w-72">
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="חיפוש לפי שם או מייל…" aria-label="חיפוש גולשים" className={inputClass} />
        </div>
      </div>
      {list.isPending ? (
        <Loading />
      ) : list.isError ? (
        <ErrorBox error={list.error} onRetry={() => list.refetch()} />
      ) : items.length === 0 ? (
        <Empty title={q || filter !== 'all' ? 'אין גולשים שמתאימים לחיפוש' : 'עוד אין גולשים רשומים. הם נרשמים באתר או באפליקציה כשהם רוצים להגיב.'} />
      ) : (
        <ul className="space-y-3">
          {items.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-4 rounded-xl bg-white p-4 ring-1 ring-line">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">{r.displayName}</span>
                  <span className="text-sm text-ink-2" dir="ltr">
                    {r.email}
                  </span>
                  {r.status === 'banned' && <Badge tone="danger">חסום</Badge>}
                  {r.signedIn && <Badge tone="info">מחובר</Badge>}
                  {!r.termsAccepted && <Badge tone="muted">עוד לא אישר את התנאים המעודכנים</Badge>}
                </div>
                <p className="mt-1 text-sm text-muted">
                  הצטרף {formatDateTime(r.createdAt)} · כניסה אחרונה {timeAgo(r.lastLoginAt)} · {r.comments} תגובות
                  {r.hiddenComments > 0 && ` (${r.hiddenComments} מוסתרות)`}
                </p>
                {r.bannedReason && <p className="mt-1 text-sm text-brand-deep">סיבת החסימה: {r.bannedReason}</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                {r.comments > 0 && (
                  <Button size="sm" variant="ghost" aria-expanded={openId === r.id} onClick={() => setOpenId(openId === r.id ? null : r.id)}>
                    {openId === r.id ? 'סגירת התגובות' : `התגובות (${r.comments})`}
                  </Button>
                )}
                {r.status === 'banned' ? (
                  <Button size="sm" busy={unban.isPending && unban.variables?.id === r.id} onClick={() => unban.mutate(r)}>
                    ביטול חסימה
                  </Button>
                ) : (
                  <Button size="sm" variant="danger" busy={ban.isPending && ban.variables?.r.id === r.id} onClick={() => askBan(r)}>
                    חסימה
                  </Button>
                )}
                {r.signedIn && (
                  <Button size="sm" variant="ghost" busy={signOut.isPending && signOut.variables?.id === r.id} onClick={() => signOut.mutate(r)}>
                    ניתוק מכל המכשירים
                  </Button>
                )}
                {isAdmin && (
                  <Button
                    size="sm"
                    variant="ghost"
                    busy={remove.isPending && remove.variables?.id === r.id}
                    onClick={() => confirm(`למחוק לצמיתות את החשבון של ${r.displayName}? כל התגובות שלו יימחקו ואי אפשר יהיה לשחזר. (לבקשת פרטיות של הגולש)`) && remove.mutate(r)}
                  >
                    מחיקה לצמיתות
                  </Button>
                )}
              </div>
              {openId === r.id && <ReaderComments readerId={r.id} />}
            </li>
          ))}
        </ul>
      )}
      {list.hasNextPage && (
        <div className="mt-4 text-center">
          <Button busy={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
            עוד גולשים
          </Button>
        </div>
      )}
    </>
  );
}

const COMMENT_STATUS = { visible: { label: 'מוצגת', tone: 'ok' }, hidden: { label: 'מוסתרת', tone: 'warn' }, removed: { label: 'נמחקה', tone: 'muted' } } as const;

/** Everything one reader wrote: on which article, its status, likes and the editors' pick. */
function ReaderComments({ readerId }: { readerId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ['reader-comments', readerId], queryFn: () => admin.get<AdminReaderComment[]>(`/readers/${readerId}/comments`) });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['reader-comments', readerId] });
    void qc.invalidateQueries({ queryKey: ['readers'] });
  };
  const onError = (e: unknown) => toast(errorMessage(e), 'danger');
  const setStatus = useMutation({ mutationFn: ({ id, status }: { id: string; status: 'visible' | 'hidden' }) => admin.patch(`/comments/${id}`, { status }), onSuccess: refresh, onError });
  const pick = useMutation({ mutationFn: ({ id, picked }: { id: string; picked: boolean }) => admin.post(`/comments/${id}/pick`, { picked }), onSuccess: refresh, onError });

  if (list.isPending) return <Loading />;
  if (list.isError) return <ErrorBox error={list.error} onRetry={() => list.refetch()} />;
  const totalLikes = list.data.reduce((n, c) => n + c.likeCount, 0);
  return (
    <div className="w-full border-t border-line-soft pt-3">
      <p className="mb-2 text-sm text-muted">
        {list.data.length} תגובות · {totalLikes} לייקים בסך הכל · {list.data.filter((c) => c.picked).length} בבחירת העורכים
      </p>
      <ul className="space-y-2">
        {list.data.map((c) => (
          <li key={c.id} className="rounded-lg bg-stone/60 p-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <a href={`${SITE_URL}/article/${c.article.slug}#comments`} target="_blank" rel="noopener noreferrer" className="font-semibold hover:text-brand hover:underline">
                {c.article.title}
              </a>
              <span className="text-muted">· {formatDateTime(c.createdAt)}</span>
              {c.isReply && <span className="text-muted">· תשובה בשיחה</span>}
              <Badge tone={COMMENT_STATUS[c.status].tone}>{COMMENT_STATUS[c.status].label}</Badge>
              {c.likeCount > 0 && <span className="text-muted">♥ {c.likeCount}</span>}
              {c.picked && <Badge tone="info">בחירת העורכים</Badge>}
            </div>
            <p className="mt-1 whitespace-pre-wrap text-[15px]">{c.body}</p>
            {c.status !== 'removed' && (
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="ghost" onClick={() => setStatus.mutate({ id: c.id, status: c.status === 'visible' ? 'hidden' : 'visible' })}>
                  {c.status === 'visible' ? 'הסתרה' : 'הצגה'}
                </Button>
                {c.status === 'visible' && (
                  <Button size="sm" variant="ghost" onClick={() => pick.mutate({ id: c.id, picked: !c.picked })}>
                    {c.picked ? 'הוצאה מבחירת העורכים' : 'בחירת העורכים'}
                  </Button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Subscribers() {
  const qc = useQueryClient();
  const toast = useToast();
  const isAdmin = useCan('admin');
  const [filter, setFilter] = useState<(typeof SUBSCRIBER_FILTER)[number]['id']>('active');
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const list = useInfiniteQuery({
    queryKey: ['subscribers', filter, q],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ status: filter });
      if (q) params.set('q', q);
      if (pageParam) params.set('cursor', pageParam);
      return admin.get<SubscriberList>(`/newsletter/subscribers?${params}`);
    },
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const done = (message: string) => () => {
    toast(message);
    void qc.invalidateQueries({ queryKey: ['subscribers'] });
    void qc.invalidateQueries({ queryKey: ['audience'] });
  };
  const onError = (e: unknown) => toast(errorMessage(e), 'danger');
  const unsubscribe = useMutation({ mutationFn: (x: SubscriberDto) => admin.post(`/newsletter/subscribers/${x.id}/unsubscribe`), onSuccess: done('הכתובת הוסרה מרשימת התפוצה.'), onError });
  const remove = useMutation({ mutationFn: (x: SubscriberDto) => admin.del(`/newsletter/subscribers/${x.id}`), onSuccess: done('הכתובת נמחקה לצמיתות.'), onError });

  return (
    <>
      <p className="mb-4 max-w-3xl text-sm text-muted">
        נרשמים בטופס הניוזלטר באתר, מאשרים את תנאי השימוש ולוחצים על קישור אישור במייל. רק אחרי האישור הם מנויים פעילים. כל ניוזלטר יוצא עם קישור הסרה בלחיצה אחת, וכתובת שהוסרה נשמרת עם תאריך ההסרה כפי שהחוק דורש.
      </p>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segments items={SUBSCRIBER_FILTER} value={filter} onChange={setFilter} label="מצב המנוי" />
        <div className="w-72">
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="חיפוש לפי מייל…" aria-label="חיפוש מנויים" className={inputClass} />
        </div>
      </div>
      {list.isPending ? (
        <Loading />
      ) : list.isError ? (
        <ErrorBox error={list.error} onRetry={() => list.refetch()} />
      ) : items.length === 0 ? (
        <Empty title={q ? 'אין מנויים שמתאימים לחיפוש' : 'אין כאן מנויים עדיין.'} />
      ) : (
        <ul className="divide-y divide-line-soft rounded-xl bg-white ring-1 ring-line">
          {items.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1 font-semibold" dir="ltr">
                {x.email}
              </span>
              <Badge tone={SUBSCRIBER_STATUS[x.status].tone}>{SUBSCRIBER_STATUS[x.status].label}</Badge>
              <span className="text-sm text-muted">
                {x.unsubscribedAt ? `הוסר ${formatDateTime(x.unsubscribedAt)}` : x.confirmedAt ? `אישר ${formatDateTime(x.confirmedAt)}` : `נרשם ${formatDateTime(x.createdAt)}`}
              </span>
              <div className="flex gap-2">
                {x.status !== 'unsubscribed' && (
                  <Button size="sm" variant="ghost" busy={unsubscribe.isPending && unsubscribe.variables?.id === x.id} onClick={() => confirm(`להסיר את ${x.email} מרשימת התפוצה?`) && unsubscribe.mutate(x)}>
                    הסרה מהרשימה
                  </Button>
                )}
                {isAdmin && (
                  <Button size="sm" variant="ghost" busy={remove.isPending && remove.variables?.id === x.id} onClick={() => confirm(`למחוק לצמיתות את ${x.email}, כולל רישום ההסכמה? (לבקשת פרטיות)`) && remove.mutate(x)}>
                    מחיקה לצמיתות
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {list.hasNextPage && (
        <div className="mt-4 text-center">
          <Button busy={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
            עוד מנויים
          </Button>
        </div>
      )}
    </>
  );
}
