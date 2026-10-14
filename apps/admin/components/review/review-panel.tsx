'use client';
// One article's legal review: what was found (the passage, why it is a risk, what to do), and for
// each risk the four choices: approve as is (with a reason), publish with extra caution (the AI
// writes a safer wording, the editor approves it into the text), wait for a response (then add it,
// or note that none came), or don't publish. Shown in the editor and on the review page.
import { REVIEW_FLAG_NAME, type DecideReviewInput, type DraftReviewDto, type ReviewIssueDto } from '@b4/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { admin, errorMessage } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { REVIEW_ACTION, REVIEW_STATE, REVIEW_WHERE_LABEL, formatDateTime } from '@/lib/labels';
import { Badge, Button, ErrorBox, Field, Loading, Spinner, cx, inputClass, useToast } from '../ui';

type Decide = DecideReviewInput;

function useReviewActions(draftId: string) {
  const qc = useQueryClient();
  const toast = useToast();
  const refresh = (next?: DraftReviewDto) => {
    if (next) qc.setQueryData(['review', draftId], next);
    else void qc.invalidateQueries({ queryKey: ['review', draftId] });
    // A decision may change the text, the plan, the counters and the list.
    void qc.invalidateQueries({ queryKey: ['draft', draftId] });
    void qc.invalidateQueries({ queryKey: ['reviews'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const onError = (e: unknown) => toast(errorMessage(e), 'danger');
  return {
    decide: useMutation({
      mutationFn: ({ issueId, body }: { issueId: string; body: Decide }) => admin.post<DraftReviewDto>(`/drafts/${draftId}/review/issues/${issueId}/decide`, body),
      onSuccess: (next) => refresh(next),
      onError,
    }),
    fix: useMutation({ mutationFn: (issueId: string) => admin.post(`/drafts/${draftId}/review/issues/${issueId}/fix`), onSuccess: () => refresh(), onError }),
    recheck: useMutation({ mutationFn: () => admin.post(`/drafts/${draftId}/review`), onSuccess: () => refresh(), onError }),
    waive: useMutation({ mutationFn: (reason: string) => admin.post<DraftReviewDto>(`/drafts/${draftId}/review/waive`, { reason }), onSuccess: (next) => refresh(next), onError }),
  };
}

function Issue({ issue, draftId }: { issue: ReviewIssueDto; draftId: string }) {
  const canEdit = useCan('editor');
  const actions = useReviewActions(draftId);
  const [open, setOpen] = useState<'approve' | 'reject' | null>(null);
  const [reason, setReason] = useState('');
  const [response, setResponse] = useState('');
  const busy = actions.decide.isPending || actions.fix.isPending;
  const decide = (body: Decide) => actions.decide.mutate({ issueId: issue.id, body });
  const awaiting = issue.decision?.action === 'awaiting_response';

  return (
    <li className={cx('rounded-xl p-4 ring-1', issue.open ? 'bg-white ring-brand/40' : 'bg-stone/60 ring-line')}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={issue.open ? 'danger' : 'ok'}>{REVIEW_FLAG_NAME[issue.flag]}</Badge>
        <span className="text-xs text-muted">{REVIEW_WHERE_LABEL[issue.where]}</span>
        {issue.subject && <span className="text-xs text-muted">· נוגע ל: {issue.subject}</span>}
      </div>
      <blockquote className="mt-2 border-r-4 border-brand/50 pr-3 text-[15px] leading-relaxed">{issue.quote}</blockquote>
      <p className="mt-2 text-sm text-ink-2">
        <b>למה:</b> {issue.why}
      </p>
      <p className="text-sm text-ink-2">
        <b>מה כדאי לעשות:</b> {issue.advice}
      </p>

      {issue.decision && (
        <p className={cx('mt-3 rounded-lg px-3 py-2 text-sm', awaiting ? 'bg-warn-soft text-warn' : 'bg-ok-soft text-ok')}>
          <b>{REVIEW_ACTION[issue.decision.action]}</b> · {issue.decision.by} · {formatDateTime(issue.decision.at)}
          {issue.decision.reason && <span className="block">סיבה: {issue.decision.reason}</span>}
          {issue.decision.response && <span className="block">התגובה: {issue.decision.response}</span>}
        </p>
      )}

      {issue.open && canEdit && (
        <div className="mt-3 space-y-3 border-t border-line-soft pt-3">
          {/* Extra caution: the AI's safer wording, shown before and after, put into the text only on approval. */}
          {issue.fix?.status === 'writing' ? (
            <p className="flex items-center gap-2 text-sm font-semibold text-info" role="status">
              <Spinner small /> ה-AI כותב ניסוח זהיר לקטע…
            </p>
          ) : issue.fix?.status === 'ready' ? (
            <div className="space-y-2 rounded-lg bg-info-soft p-3 text-sm">
              <p className="font-bold text-info">פרסום בזהירות מוגברת: כך הקטע ייראה</p>
              <p>
                <span className="font-bold">לפני: </span>
                <span className="line-through decoration-brand/60">{issue.quote}</span>
              </p>
              <p>
                <span className="font-bold">אחרי: </span>
                {issue.fix.after}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="primary" busy={actions.decide.isPending} onClick={() => decide({ action: 'caution' })}>
                  אישור והכנסה לכתבה
                </Button>
                <Button size="sm" variant="ghost" busy={actions.fix.isPending} onClick={() => actions.fix.mutate(issue.id)}>
                  ניסוח אחר
                </Button>
              </div>
            </div>
          ) : issue.fix?.status === 'failed' ? (
            <p className="text-sm text-brand">{issue.fix.error}</p>
          ) : null}

          {awaiting ? (
            <div className="space-y-2">
              <Field label="התגובה, כמו שהיא צריכה להופיע בכתבה" htmlFor={`resp-${issue.id}`}>
                <textarea id={`resp-${issue.id}`} rows={2} value={response} onChange={(e) => setResponse(e.target.value)} placeholder="למשל: מהחברה נמסר בתגובה כי..." className={inputClass} />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="primary" busy={busy} disabled={response.trim().length < 5} onClick={() => decide({ action: 'response_added', response })}>
                  הוספת התגובה לכתבה
                </Button>
                <Button size="sm" busy={busy} onClick={() => decide({ action: 'no_response' })}>
                  לא התקבלה תגובה
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="dark" disabled={busy} onClick={() => setOpen(open === 'approve' ? null : 'approve')}>
                אישור הפרסום
              </Button>
              {issue.fix?.status !== 'ready' && issue.fix?.status !== 'writing' && (
                <Button size="sm" busy={actions.fix.isPending} onClick={() => actions.fix.mutate(issue.id)}>
                  פרסום בזהירות מוגברת
                </Button>
              )}
              <Button size="sm" disabled={busy} onClick={() => decide({ action: 'awaiting_response' })}>
                ממתין לתגובה
              </Button>
              <Button size="sm" variant="danger" disabled={busy} onClick={() => setOpen(open === 'reject' ? null : 'reject')}>
                לא לפרסם
              </Button>
            </div>
          )}

          {open && (
            <div className="space-y-2 rounded-lg bg-stone p-3">
              <Field label={open === 'approve' ? 'למה אפשר לפרסם את זה כמו שזה? (נשמר עם השם שלך)' : 'למה לא לפרסם? (לא חובה)'} htmlFor={`reason-${issue.id}`}>
                <textarea id={`reason-${issue.id}`} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} />
              </Field>
              <Button
                size="sm"
                variant={open === 'approve' ? 'primary' : 'danger'}
                busy={actions.decide.isPending}
                disabled={open === 'approve' && reason.trim().length < 3}
                onClick={() => decide({ action: open, reason })}
              >
                {open === 'approve' ? 'מאשר לפרסם' : 'לא לפרסם את הכתבה'}
              </Button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function ReviewPanel({ draftId, final }: { draftId: string; final: boolean }) {
  const canEdit = useCan('editor');
  const query = useQuery({
    queryKey: ['review', draftId],
    queryFn: () => admin.get<DraftReviewDto>(`/drafts/${draftId}/review`),
    refetchInterval: (q) => (q.state.data?.state === 'checking' || q.state.data?.issues.some((i) => i.fix?.status === 'writing') ? 2000 : false),
  });
  const actions = useReviewActions(draftId);
  const [reason, setReason] = useState('');

  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorBox error={query.error} onRetry={() => query.refetch()} />;
  const r = query.data;
  const state = r.state ? REVIEW_STATE[r.state] : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {state ? <Badge tone={state.tone}>{state.label}</Badge> : <Badge>לא נבדקה</Badge>}
        {r.checkedAt && <span className="text-xs text-muted">נבדקה {formatDateTime(r.checkedAt)}</span>}
        {canEdit && final && r.state !== 'checking' && (
          <Button size="sm" variant="ghost" className="mr-auto" busy={actions.recheck.isPending} onClick={() => actions.recheck.mutate()}>
            {r.state ? 'בדיקה מחדש' : 'בדיקה עכשיו'}
          </Button>
        )}
      </div>

      {r.state === 'checking' && (
        <p className="flex items-center gap-2 text-sm font-semibold text-info" role="status">
          <Spinner small /> הבודק המשפטי קורא את הכתבה…
        </p>
      )}
      {r.state === null && (
        <p className="text-[15px] text-muted">{final ? 'הכתבה סומנה כסופית לפני שהבדיקה המשפטית התחילה לפעול. אפשר לבדוק אותה עכשיו.' : 'הבדיקה המשפטית רצה כשמסמנים את הטקסט כסופי.'}</p>
      )}
      {r.state === 'clear' && <p className="text-[15px] text-ok">הבודק המשפטי לא מצא סיכונים. אפשר לפרסם.</p>}
      {r.state === 'resolved' && <p className="text-[15px] text-ok">כל הסוגיות הוכרעו. אפשר לפרסם.</p>}
      {r.state === 'flagged' && (
        <p className="rounded-lg bg-brand-soft px-3 py-2 text-[15px] font-semibold text-brand-deep" role="alert">
          הכתבה נעצרה: {r.openCount === 1 ? 'סוגיה אחת מחכה' : `${r.openCount} סוגיות מחכות`} להחלטה שלך. עד אז אי אפשר לפרסם אותה.
        </p>
      )}
      {r.state === 'failed' && (
        <div className="space-y-2 rounded-lg bg-warn-soft p-3 text-sm text-warn">
          <p className="font-semibold">{r.error}</p>
          {canEdit && (
            <>
              <Field label="אפשר גם לפרסם בלי בדיקה, עם סיבה (נשמר עם השם שלך)" htmlFor="waive">
                <textarea id="waive" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} />
              </Field>
              <Button size="sm" busy={actions.waive.isPending} disabled={reason.trim().length < 3} onClick={() => actions.waive.mutate(reason)}>
                פרסום בלי בדיקה
              </Button>
            </>
          )}
        </div>
      )}
      {r.state === 'waived' && r.waived && (
        <p className="text-sm text-muted">
          אושר לפרסום בלי בדיקה: {r.waived.by}, {formatDateTime(r.waived.at)}. הסיבה: {r.waived.reason}
        </p>
      )}

      {r.issues.length > 0 && (
        <ul className="space-y-3">
          {r.issues.map((i) => (
            <Issue key={i.id} issue={i} draftId={draftId} />
          ))}
        </ul>
      )}
      <p className="text-xs text-muted">הבדיקה היא רשת ביטחון של AI, לא תחליף לייעוץ משפטי. כל החלטה נשמרת עם השם של מי שהחליט.</p>
    </div>
  );
}
