'use client';
// The learning loop, made visible: how much editors change the AI's drafts,
// and the house-style rules the AI learned from those changes.
import type { LearningOverview } from '@b4/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Button, Card, ErrorBox, Loading, PageHeader, inputClass, useToast } from '@/components/ui';
import { admin, errorMessage } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { categoryName, formatDateTime } from '@/lib/labels';

export default function LearningPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const isAdmin = useCan();
  const canEdit = useCan('editor');
  const data = useQuery({
    queryKey: ['learning'],
    queryFn: () => admin.get<LearningOverview>('/learning'),
    refetchInterval: (q) => (q.state.data?.activeJob ? 2500 : false),
  });
  const [rules, setRules] = useState<string | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['learning'] });
  const onError = (e: unknown) => toast(errorMessage(e), 'danger');
  const distill = useMutation({ mutationFn: () => admin.post('/learning/distill'), onSuccess: refresh, onError });
  const activate = useMutation({ mutationFn: (id: number) => admin.post(`/learning/profiles/${id}/activate`), onSuccess: refresh, onError });
  const saveRules = useMutation({ mutationFn: (r: string) => admin.put('/learning/rules', { rules: r }), onSuccess: () => { setRules(null); toast('הכללים נשמרו כגרסה חדשה.'); refresh(); }, onError });

  if (data.isPending) return <Loading />;
  if (data.isError) return <ErrorBox error={data.error} onRetry={() => data.refetch()} />;
  const d = data.data;
  const active = d.profiles.find((p) => p.isActive);

  return (
    <>
      <PageHeader
        title="למידת ה-AI"
        subtitle="בכל פרסום המערכת משווה את הטיוטה של ה-AI לנוסח שפורסם. מהתיקונים האלה ה-AI לומד את הסגנון שלנו לכתבות הבאות."
        actions={
          canEdit && (
            <Button variant="primary" busy={distill.isPending || !!d.activeJob} onClick={() => distill.mutate()} disabled={d.pending === 0}>
              ללמוד עכשיו מ-{d.pending} תיקונים
            </Button>
          )
        }
      />
      <div className="mb-6 grid grid-cols-3 gap-4">
        <div className="rounded-xl bg-white p-5 ring-1 ring-line">
          <p className="text-sm font-semibold text-muted">תיקונים שממתינים ללמידה</p>
          <p className="mt-1 font-display text-3xl font-extrabold">{d.pending}</p>
        </div>
        <div className="rounded-xl bg-white p-5 ring-1 ring-line">
          <p className="text-sm font-semibold text-muted">תיקונים שנלמדו</p>
          <p className="mt-1 font-display text-3xl font-extrabold">{d.distilled}</p>
        </div>
        <div className="rounded-xl bg-white p-5 ring-1 ring-line">
          <p className="text-sm font-semibold text-muted">שינוי ממוצע של העורכים</p>
          <p className="mt-1 font-display text-3xl font-extrabold">{d.averageEditRatio === null ? '—' : `${Math.round(d.averageEditRatio * 100)}%`}</p>
          <p className="text-xs text-muted">ככל שהמספר יורד, ה-AI כותב קרוב יותר לסגנון שלנו</p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card
          title="כללי הסגנון הפעילים"
          actions={
            isAdmin &&
            rules === null && (
              <Button size="sm" onClick={() => setRules(active?.rules ?? '')}>
                עריכה ידנית
              </Button>
            )
          }
        >
          {rules !== null ? (
            <div className="space-y-2">
              <textarea rows={14} value={rules} onChange={(e) => setRules(e.target.value)} className={inputClass} />
              <div className="flex gap-2">
                <Button variant="dark" busy={saveRules.isPending} onClick={() => saveRules.mutate(rules)}>
                  שמירה כגרסה חדשה
                </Button>
                <Button variant="ghost" onClick={() => setRules(null)}>
                  ביטול
                </Button>
              </div>
            </div>
          ) : active ? (
            <pre className="whitespace-pre-wrap font-sans text-[15px] leading-relaxed">{active.rules}</pre>
          ) : (
            <p className="text-muted">עוד אין כללים נלמדים. הם ייווצרו אוטומטית אחרי כמה פרסומים.</p>
          )}
          {d.profiles.length > 1 && (
            <div className="mt-5 border-t border-line-soft pt-4">
              <p className="mb-2 text-sm font-bold text-ink-2">גרסאות קודמות</p>
              <ul className="space-y-1.5 text-sm">
                {d.profiles.map((p) => (
                  <li key={p.id} className="flex items-center gap-2">
                    <span>{formatDateTime(p.createdAt)}</span>
                    <span className="text-muted">{p.feedbackCount ? `מ-${p.feedbackCount} תיקונים` : `ידני${p.approvedBy ? ` · ${p.approvedBy}` : ''}`}</span>
                    {p.isActive ? (
                      <Badge tone="ok">פעילה</Badge>
                    ) : (
                      isAdmin && (
                        <Button size="sm" variant="ghost" onClick={() => activate.mutate(p.id)}>
                          שחזור
                        </Button>
                      )
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <Card title="תיקונים אחרונים">
          {d.recent.length === 0 ? (
            <p className="text-muted">עוד לא פורסמו כתבות שה-AI כתב.</p>
          ) : (
            <ul className="divide-y divide-line-soft">
              {d.recent.map((f) => (
                <li key={f.id} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{f.articleTitle ?? '—'}</p>
                    <p className="text-xs text-muted">
                      {categoryName(f.category)} · {f.editorName ?? '—'} · {formatDateTime(f.createdAt)}
                    </p>
                  </div>
                  <div className="w-24">
                    <div className="h-2 overflow-hidden rounded-full bg-stone">
                      <div className="h-full bg-brand" style={{ width: `${Math.round(f.editRatio * 100)}%` }} />
                    </div>
                    <p className="mt-0.5 text-left text-xs text-muted">{Math.round(f.editRatio * 100)}% שונה</p>
                  </div>
                  <Badge tone={f.status === 'pending' ? 'warn' : f.status === 'distilled' ? 'ok' : 'muted'}>{f.status === 'pending' ? 'ממתין' : f.status === 'distilled' ? 'נלמד' : 'כמעט בלי שינוי'}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
