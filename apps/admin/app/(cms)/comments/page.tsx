'use client';
// Reader comments: held by the filter or reported by readers come first.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Button, Empty, ErrorBox, Loading, PageHeader, cx, useToast } from '@/components/ui';
import { SITE_URL, admin, errorMessage } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { timeAgo } from '@/lib/labels';

type AdminComment = {
  id: string;
  body: string;
  status: 'visible' | 'hidden' | 'removed';
  reportCount: number;
  moderationNote: string | null;
  createdAt: string;
  article: { id: number; title: string; slug: string };
  reader: { id: string; displayName: string; email: string; status: 'active' | 'banned' };
};

const FILTERS = [
  { id: 'review', label: 'לבדיקה', query: '?status=hidden' },
  { id: 'reported', label: 'דווחו', query: '?reported=true' },
  { id: 'all', label: 'הכל', query: '' },
] as const;

const STATUS = { visible: { label: 'מוצגת', tone: 'ok' }, hidden: { label: 'מוסתרת', tone: 'warn' }, removed: { label: 'נמחקה', tone: 'muted' } } as const;

export default function CommentsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const canModerate = useCan('editor');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('review');
  const query = FILTERS.find((f) => f.id === filter)!.query;
  const list = useQuery({ queryKey: ['comments', filter], queryFn: () => admin.get<{ items: AdminComment[] }>(`/comments${query}`) });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['comments'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: AdminComment['status'] }) => admin.patch(`/comments/${id}`, { status }),
    onSuccess: refresh,
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  const ban = useMutation({
    mutationFn: ({ readerId, reason }: { readerId: string; reason: string }) => admin.post(`/readers/${readerId}/ban`, { reason, hideComments: true }),
    onSuccess: () => {
      toast('הקורא נחסם ותגובותיו הוסתרו.');
      refresh();
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });

  return (
    <>
      <PageHeader title="תגובות גולשים" subtitle="תגובות מתפרסמות מיד אחרי סינון אוטומטי. כאן בודקים את מה שהסינון עיכב ואת מה שגולשים דיווחו." />
      <div className="mb-5 inline-flex rounded-lg bg-white p-1 ring-1 ring-line" role="tablist">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} onClick={() => setFilter(f.id)} className={cx('rounded-md px-4 py-2 font-bold', filter === f.id ? 'bg-ink text-white' : 'text-ink-2 hover:bg-stone')}>
            {f.label}
          </button>
        ))}
      </div>
      {list.isPending ? (
        <Loading />
      ) : list.isError ? (
        <ErrorBox error={list.error} onRetry={() => list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <Empty title="אין תגובות כאן" />
      ) : (
        <ul className="space-y-3">
          {list.data.items.map((c) => (
            <li key={c.id} className="rounded-xl bg-white p-4 ring-1 ring-line">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <b>{c.reader.displayName}</b>
                <span className="text-muted" dir="ltr">
                  {c.reader.email}
                </span>
                {c.reader.status === 'banned' && <Badge tone="danger">חסום</Badge>}
                <span className="text-muted">· {timeAgo(c.createdAt)} · על</span>
                <a href={`${SITE_URL}/article/${c.article.slug}#comments`} target="_blank" rel="noopener noreferrer" className="font-semibold hover:text-brand hover:underline">
                  {c.article.title}
                </a>
                <Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge>
                {c.reportCount > 0 && <Badge tone="danger">{c.reportCount} דיווחים</Badge>}
              </div>
              <p className="mt-2 whitespace-pre-wrap text-[15px]">{c.body}</p>
              {c.moderationNote && <p className="mt-1 text-xs text-muted">סיבה: {c.moderationNote}</p>}
              {canModerate && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {c.status !== 'visible' && (
                    <Button size="sm" onClick={() => setStatus.mutate({ id: c.id, status: 'visible' })}>
                      אישור והצגה
                    </Button>
                  )}
                  {c.status === 'visible' && (
                    <Button size="sm" onClick={() => setStatus.mutate({ id: c.id, status: 'hidden' })}>
                      הסתרה
                    </Button>
                  )}
                  {c.status !== 'removed' && (
                    <Button size="sm" variant="danger" onClick={() => setStatus.mutate({ id: c.id, status: 'removed' })}>
                      מחיקה
                    </Button>
                  )}
                  {c.reader.status !== 'banned' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        const reason = window.prompt('סיבת החסימה (תישמר ביומן):');
                        if (reason && reason.trim().length >= 2) ban.mutate({ readerId: c.reader.id, reason: reason.trim() });
                      }}
                    >
                      חסימת הקורא
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
