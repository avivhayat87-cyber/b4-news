'use client';
// "העלאה ידנית" > "ישיבת מערכת": the chief editor reads what discovery found in the last hours
// (grouped into topics for free) and proposes original stories in one short AI call. Each pitch
// waits for a person: approved, it goes to the research reporter at the chosen depth.
import { MEETING_HOURS, RESEARCH_DEPTHS, type MeetingDto, type PitchDto, type ResearchDepth, type ResearchOverviewDto } from '@b4/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Badge, Button, Card, Empty, Field, Spinner, cx, inputClass, useToast } from '@/components/ui';
import { admin, errorMessage } from '@/lib/api';
import { MEETING_STATUS, PITCH_STATUS, RESEARCH_DEPTH, RESEARCH_STATUS, categoryName, formatDateTime, timeAgo } from '@/lib/labels';

const WORKING = ['queued', 'thinking'];
const RESEARCHING = ['queued', 'researching', 'writing'];

function PitchCard({ meetingId, pitch, budgetLeft }: { meetingId: string; pitch: PitchDto; budgetLeft: number }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(pitch.title);
  const [angle, setAngle] = useState(pitch.angle);
  const [depth, setDepth] = useState<ResearchDepth>(pitch.depth);
  const done = (m: MeetingDto) => {
    qc.setQueryData<MeetingDto[]>(['meetings'], (list) => list?.map((x) => (x.id === m.id ? m : x)));
    void qc.invalidateQueries({ queryKey: ['research'] });
  };
  const approve = useMutation({
    mutationFn: () => admin.post<MeetingDto>(`/meetings/${meetingId}/pitches/${pitch.id}/approve`, { title: title.trim(), angle: angle.trim(), depth }),
    onSuccess: (m) => {
      toast('אושר. הכתב-החוקר התחיל לחקור.');
      done(m);
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  const reject = useMutation({
    mutationFn: () => admin.post<MeetingDto>(`/meetings/${meetingId}/pitches/${pitch.id}/reject`),
    onSuccess: done,
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  const status = PITCH_STATUS[pitch.status];
  const r = pitch.research;
  const pending = pitch.status === 'pending';

  return (
    <li className={cx('space-y-3 rounded-xl p-4 ring-1', pending ? 'bg-white ring-line' : 'bg-stone/60 ring-line-soft')}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={status.tone}>{status.label}</Badge>
        {pitch.coverage > 1 && <Badge tone="info">מסוקר ב-{pitch.coverage} אתרים</Badge>}
        {pitch.category && <span className="text-xs text-muted">{categoryName(pitch.category)}</span>}
        {pitch.decidedBy && <span className="mr-auto text-xs text-muted">{pitch.decidedBy}</span>}
      </div>

      {editing ? (
        <div className="space-y-2">
          <input aria-label="הכותרת" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} className={cx(inputClass, 'font-bold')} />
          <textarea aria-label="הזווית" rows={3} value={angle} onChange={(e) => setAngle(e.target.value)} maxLength={2000} className={inputClass} />
        </div>
      ) : (
        <div>
          <h3 className="font-display text-lg font-extrabold leading-snug">{title}</h3>
          <p className="mt-1 text-sm leading-relaxed text-ink-2">{angle}</p>
        </div>
      )}

      {pitch.whyNow && (
        <p className="text-sm">
          <span className="font-bold">למה עכשיו: </span>
          {pitch.whyNow}
        </p>
      )}
      {pitch.checks.length > 0 && (
        <div className="text-sm">
          <p className="font-bold">מה לבדוק</p>
          <ul className="list-inside list-disc text-ink-2">
            {pitch.checks.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}
      {pitch.officialSources.length > 0 && (
        <p className="text-sm">
          <span className="font-bold">במקורות הרשמיים: </span>
          {pitch.officialSources.join(' · ')}
        </p>
      )}
      {pitch.leads.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer font-bold text-info">מה האיתור מצא ({pitch.leads.length}): רמזים, לא מקורות</summary>
          <ul className="mt-1 space-y-0.5">
            {pitch.leads.map((l) => (
              <li key={l.itemId}>
                <a href={l.url} target="_blank" rel="noopener noreferrer nofollow" className="underline">
                  {l.title}
                </a>{' '}
                <span className="text-muted">· {l.source}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {pitch.similar.length > 0 && (
        <div className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
          <p className="font-bold">ייתכן שכבר כתבנו על זה</p>
          <ul className="mt-0.5">
            {pitch.similar.map((x) => (
              <li key={`${x.kind}-${x.id}`}>
                {x.kind === 'article' ? (
                  <a href={x.href} target="_blank" rel="noopener noreferrer" className="text-ink underline">
                    {x.title} (באתר) ↗
                  </a>
                ) : (
                  <Link href={x.href} className="text-ink underline">
                    {x.title} (בעריכה)
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {pending && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line-soft pt-3">
          <div className="w-full sm:w-60">
            <select aria-label="עומק התחקיר" value={depth} onChange={(e) => setDepth(e.target.value as ResearchDepth)} className={cx(inputClass, 'py-1.5 text-sm')}>
              {RESEARCH_DEPTHS.map((d) => (
                <option key={d} value={d}>
                  {RESEARCH_DEPTH[d].name} · {RESEARCH_DEPTH[d].cost}
                </option>
              ))}
            </select>
          </div>
          <Button size="sm" variant="primary" busy={approve.isPending} disabled={budgetLeft <= 0 || title.trim().length < 3} onClick={() => approve.mutate()}>
            לאשר ולחקור
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing((v) => !v)}>
            {editing ? 'סיום עריכה' : 'עריכת ההצעה'}
          </Button>
          <Button size="sm" variant="ghost" busy={reject.isPending} onClick={() => reject.mutate()}>
            לא עכשיו
          </Button>
        </div>
      )}
      {r && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line-soft pt-3 text-sm">
          <Badge tone={RESEARCH_STATUS[r.status].tone}>
            {RESEARCHING.includes(r.status) && <Spinner small />} תחקיר: {RESEARCH_STATUS[r.status].label}
          </Badge>
          {r.status === 'done' && !r.official && <span className="font-semibold text-danger">לא נמצא מקור רשמי</span>}
          {r.draftId && (
            <Link href={`/drafts/${r.draftId}`} className="mr-auto rounded-lg bg-ink px-3 py-1 font-bold text-white">
              לעריכה
            </Link>
          )}
        </div>
      )}
    </li>
  );
}

function Meeting({ m, budgetLeft, open }: { m: MeetingDto; budgetLeft: number; open: boolean }) {
  const status = MEETING_STATUS[m.status];
  const body = (
    <div className="space-y-4">
      {WORKING.includes(m.status) && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Spinner small /> העורך הראשי קורא את מה שהאיתור מצא. זה לוקח פחות מדקה.
        </p>
      )}
      {m.error && <p className="text-sm text-danger">{m.error}</p>}
      {m.summary && <p className="rounded-lg bg-stone px-4 py-3 text-sm leading-relaxed">{m.summary}</p>}
      {m.status === 'ready' &&
        (m.pitches.length ? (
          <ol className="space-y-3">
            {m.pitches.map((p) => (
              <PitchCard key={p.id} meetingId={m.id} pitch={p} budgetLeft={budgetLeft} />
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted">לא היו הצעות הפעם.</p>
        ))}
    </div>
  );
  const header = (
    <span className="flex flex-wrap items-center gap-2">
      <Badge tone={status.tone}>{status.label}</Badge>
      <span className="font-bold">{formatDateTime(m.createdAt)}</span>
      {m.focus && <span className="text-sm text-ink-2">· {m.focus}</span>}
      <span className="text-xs text-muted">
        · {m.createdBy}
        {m.status === 'ready' && ` · נקראו ${m.itemsRead} כתבות ב-${m.topics} נושאים · $${m.costUsd.toFixed(2)}`}
      </span>
    </span>
  );
  if (open) return <Card title={header}>{body}</Card>;
  return (
    <details className="rounded-xl bg-white ring-1 ring-line">
      <summary className="cursor-pointer px-5 py-3">{header}</summary>
      <div className="border-t border-line-soft p-5">{body}</div>
    </details>
  );
}

export function MeetingTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const [focus, setFocus] = useState('');
  const meetings = useQuery({
    queryKey: ['meetings'],
    queryFn: () => admin.get<MeetingDto[]>('/meetings'),
    // While the chief editor thinks, or an approved pitch is being researched.
    refetchInterval: (q) => (q.state.data?.some((m) => WORKING.includes(m.status) || m.pitches.some((p) => p.research && RESEARCHING.includes(p.research.status))) ? 4000 : false),
  });
  const overview = useQuery({ queryKey: ['research'], queryFn: () => admin.get<ResearchOverviewDto>('/research') });
  const start = useMutation({
    mutationFn: () => admin.post<MeetingDto>('/meetings', { focus: focus.trim() }),
    onSuccess: () => {
      setFocus('');
      void qc.invalidateQueries({ queryKey: ['meetings'] });
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  const list = meetings.data ?? [];
  const busy = list.some((m) => WORKING.includes(m.status));
  const budgetLeft = overview.data ? overview.data.budgetUsd - overview.data.spentUsd : 1;

  return (
    <div className="space-y-6">
      <Card title="ישיבת מערכת">
        <form
          className="space-y-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            start.mutate();
          }}
        >
          <p className="text-sm leading-relaxed text-ink-2">
            העורך הראשי קורא את מה שהאיתור מצא ב-{MEETING_HOURS} השעות האחרונות, מקבץ לנושאים (בחינם), ומציע כתבות מקוריות שלנו: זווית, מה לבדוק ובאילו מקורות רשמיים. זו קריאה קצרה אחת ל-Claude, בערך 3–6 סנט. שום דבר לא נחקר עד שתאשרו.
          </p>
          <Field label="כיוון (לא חובה)" htmlFor="m-focus" hint="למשל: נדל״ן ומשכנתאות, צרכנות, שוק ההון.">
            <input id="m-focus" value={focus} onChange={(e) => setFocus(e.target.value)} maxLength={300} className={inputClass} />
          </Field>
          <div className="flex flex-wrap items-center gap-4">
            <Button type="submit" variant="primary" busy={start.isPending} disabled={busy || budgetLeft <= 0}>
              לכנס ישיבה
            </Button>
            {overview.data && (
              <span className={cx('text-sm', budgetLeft <= 0 ? 'font-bold text-danger' : 'text-muted')}>
                {budgetLeft <= 0 ? 'התקציב החודשי לתחקירים נגמר.' : `תחקירים וישיבות החודש: $${overview.data.spentUsd.toFixed(2)} מתוך $${overview.data.budgetUsd}`}
              </span>
            )}
          </div>
        </form>
      </Card>

      {meetings.isPending ? (
        <Spinner />
      ) : list.length ? (
        list.map((m, i) => <Meeting key={m.id} m={m} budgetLeft={budgetLeft} open={i === 0} />)
      ) : (
        <Empty title="עוד לא התכנסה ישיבה">ההצעות יופיעו כאן, כל אחת עם כפתור לאישור.</Empty>
      )}
      {list.length > 0 && <p className="text-xs text-muted">הישיבה האחרונה פתוחה; הקודמות מקופלות. ישיבה אחרונה: {timeAgo(list[0]!.createdAt)}.</p>}
    </div>
  );
}
