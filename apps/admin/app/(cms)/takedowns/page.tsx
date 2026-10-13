'use client';
// Content-removal requests ("notice and takedown"): oldest first, with the answer-by
// time. Every decision is kept with who made it and when, and the requester is told.
import { TAKEDOWN_KIND_LABELS, TAKEDOWN_RESPONSE_HOURS, TAKEDOWN_STATUS_LABELS, type TakedownDto } from '@b4/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Button, Empty, ErrorBox, Loading, PageHeader, cx, inputClass, useToast } from '@/components/ui';
import { admin, errorMessage } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { formatDateTime, timeAgo } from '@/lib/labels';

const VIEWS = [
  { id: 'open', label: 'פתוחות' },
  { id: 'closed', label: 'טופלו' },
] as const;

const STATUS_TONE = { new: 'danger', in_review: 'info', removed: 'ok', rejected: 'muted' } as const;

function dueLabel(dueAt: string): { text: string; overdue: boolean } {
  const hours = Math.round((Date.parse(dueAt) - Date.now()) / 3_600_000);
  if (hours < 0) return { text: `באיחור של ${-hours} שעות`, overdue: true };
  return { text: hours < 1 ? 'להשיב בשעה הקרובה' : `להשיב בתוך ${hours} שעות`, overdue: false };
}

export default function TakedownsPage() {
  const [view, setView] = useState<(typeof VIEWS)[number]['id']>('open');
  const list = useQuery({ queryKey: ['takedowns', view], queryFn: () => admin.get<{ items: TakedownDto[] }>(`/takedowns?view=${view}`) });

  return (
    <>
      <PageHeader
        title="בקשות הסרה"
        subtitle={`פניות של קוראים ושל מי שנפגע מתוכן באתר. היעד: תשובה בתוך ${TAKEDOWN_RESPONSE_HOURS} שעות. כל החלטה נשמרת ביומן, והפונה מקבל עדכון במייל.`}
      />
      <div className="mb-5 inline-flex rounded-lg bg-white p-1 ring-1 ring-line" role="tablist">
        {VIEWS.map((v) => (
          <button key={v.id} type="button" role="tab" aria-selected={view === v.id} onClick={() => setView(v.id)} className={cx('rounded-md px-4 py-2 font-bold', view === v.id ? 'bg-ink text-white' : 'text-ink-2 hover:bg-stone')}>
            {v.label}
          </button>
        ))}
      </div>
      {list.isPending ? (
        <Loading />
      ) : list.isError ? (
        <ErrorBox error={list.error} onRetry={() => list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <Empty title={view === 'open' ? 'אין בקשות פתוחות' : 'עוד לא טופלו בקשות'} />
      ) : (
        <ul className="space-y-3">
          {list.data.items.map((t) => (
            <TakedownCard key={t.id} item={t} />
          ))}
        </ul>
      )}
    </>
  );
}

function TakedownCard({ item }: { item: TakedownDto }) {
  const qc = useQueryClient();
  const toast = useToast();
  const canDecide = useCan('editor');
  const [note, setNote] = useState('');
  const [hideComment, setHideComment] = useState(true);
  const open = item.status === 'new' || item.status === 'in_review';
  const due = dueLabel(item.dueAt);

  const decide = useMutation({
    mutationFn: (status: 'in_review' | 'removed' | 'rejected') => admin.patch(`/takedowns/${item.id}`, { status, note: note.trim() || undefined, hideComment }),
    onSuccess: (_r, status) => {
      toast(status === 'in_review' ? 'סומן כבבדיקה.' : 'ההחלטה נשמרה והפונה עודכן/ה במייל.');
      void qc.invalidateQueries({ queryKey: ['takedowns'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });

  return (
    <li className={cx('rounded-xl bg-white p-4 ring-1', open && due.overdue ? 'ring-brand/50' : 'ring-line')}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={STATUS_TONE[item.status]}>{TAKEDOWN_STATUS_LABELS[item.status]}</Badge>
        <b>{TAKEDOWN_KIND_LABELS[item.kind]}</b>
        <span className="font-mono text-xs text-muted">{item.id.slice(0, 8).toUpperCase()}</span>
        <span className="text-muted">· התקבלה {timeAgo(item.createdAt)}</span>
        {open && <Badge tone={due.overdue ? 'danger' : 'warn'}>{due.text}</Badge>}
      </div>
      <p className="mt-2 text-sm">
        <span className="font-semibold">{item.name}</span>{' '}
        <span className="text-muted" dir="ltr">
          {item.email}
        </span>
      </p>
      <a href={item.url} target="_blank" rel="noopener noreferrer nofollow" className="mt-1 block truncate text-sm font-semibold text-brand hover:underline" dir="ltr">
        {item.url}
      </a>
      {item.comment && (
        <div className="mt-3 rounded-lg bg-stone px-3 py-2">
          <p className="text-xs font-bold text-ink-2">
            התגובה המדווחת · {item.comment.author} · {item.comment.status === 'visible' ? 'מוצגת באתר' : item.comment.status === 'hidden' ? 'מוסתרת' : 'הוסרה'}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-[15px]">{item.comment.body}</p>
        </div>
      )}
      <p className="mt-3 whitespace-pre-wrap text-[15px]">{item.details}</p>

      {!open ? (
        <p className="mt-3 text-sm text-muted">
          הוחלט: {TAKEDOWN_STATUS_LABELS[item.status]}
          {item.decidedBy ? ` · ${item.decidedBy}` : ''}
          {item.decidedAt ? ` · ${formatDateTime(item.decidedAt)}` : ''}
          {item.decisionNote ? ` · ${item.decisionNote}` : ''}
        </p>
      ) : canDecide ? (
        <div className="mt-4 space-y-2 border-t border-line-soft pt-3">
          <label htmlFor={`note-${item.id}`} className="block text-sm font-bold text-ink-2">
            נימוק ההחלטה (בדחייה הוא נשלח לפונה)
          </label>
          <textarea id={`note-${item.id}`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} />
          {item.comment && (
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={hideComment} onChange={(e) => setHideComment(e.target.checked)} className="size-4" />
              בהסרה: להסיר את התגובה מהאתר
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            {item.status === 'new' && (
              <Button size="sm" busy={decide.isPending && decide.variables === 'in_review'} onClick={() => decide.mutate('in_review')}>
                בבדיקה
              </Button>
            )}
            <Button size="sm" variant="danger" busy={decide.isPending && decide.variables === 'removed'} onClick={() => decide.mutate('removed')}>
              הסרת התוכן
            </Button>
            <Button size="sm" variant="ghost" busy={decide.isPending && decide.variables === 'rejected'} onClick={() => decide.mutate('rejected')}>
              דחיית הבקשה
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
