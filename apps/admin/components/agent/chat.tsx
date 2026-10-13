'use client';
// The chat with the newsroom agent. Questions are answered from the system;
// every change it proposes shows up as a card with approve / decline.
import type { AgentConversationDto, AgentConversationSummary, AgentMessageDto, AgentStatusDto } from '@b4/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { admin, errorMessage } from '@/lib/api';
import { timeAgo } from '@/lib/labels';
import { Badge, Button, Spinner, cx, inputClass, useToast } from '../ui';

const SUGGESTIONS = ['מה המצב במערכת עכשיו?', 'תתחיל איתור כתבות מחו״ל', 'אילו כתבות עוד לא עלו לרשתות?', 'אילו אתרים מחכים לאישור?', 'מה סוכן העריכה למד לאחרונה?'];

/** Plain text with **bold** and CMS paths as links (the agent points to screens by path). */
function RichText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|(\/(?:drafts|magazines|social|sources|discovery|saved|learning|agent)(?:\/[\w-]+)*)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) parts.push(text.slice(last, m.index));
    parts.push(
      m[1] ? (
        <b key={m.index}>{m[1]}</b>
      ) : (
        <Link key={m.index} href={m[2]!} className="font-semibold text-brand underline-offset-2 hover:underline" dir="ltr">
          {m[2]}
        </Link>
      ),
    );
    last = m.index! + m[0].length;
  }
  parts.push(text.slice(last));
  return <p className="whitespace-pre-wrap break-words leading-relaxed">{parts}</p>;
}

function inputSummary(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  return Object.entries(input as Record<string, unknown>)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? `${v.length} פריטים` : typeof v === 'object' ? '…' : String(v)}`)
    .join(' · ');
}

function ActionCard({ m, onDecide, busy }: { m: AgentMessageDto; onDecide(toolUseId: string, approve: boolean): void; busy: boolean }) {
  const a = m.action!;
  if (!a.write) {
    return (
      <div className={cx('flex items-center gap-2 text-xs', a.status === 'failed' ? 'text-brand' : 'text-muted')}>
        <span aria-hidden>{a.status === 'failed' ? '⚠' : '🔎'}</span>
        <span>{a.label}</span>
        {a.status === 'failed' && a.outcome && <span>· {a.outcome}</span>}
      </div>
    );
  }
  return (
    <div className={cx('max-w-xl rounded-xl p-4 ring-1', a.status === 'pending' ? 'bg-warn-soft ring-warn/30' : 'bg-white ring-line')}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-extrabold">{a.label}</span>
        {a.status === 'pending' && <Badge tone="warn">מחכה לאישור שלך</Badge>}
        {a.status === 'approved' && <Badge tone="info">מבצע…</Badge>}
        {a.status === 'done' && <Badge tone="ok">בוצע</Badge>}
        {a.status === 'declined' && <Badge tone="muted">נדחה</Badge>}
        {a.status === 'failed' && <Badge tone="danger">נכשל</Badge>}
      </div>
      {inputSummary(a.input) && (
        <p className="mt-1 text-xs text-muted" dir="auto">
          {inputSummary(a.input)}
        </p>
      )}
      {a.outcome && a.status !== 'declined' && <div className={cx('mt-2 text-sm', a.status === 'failed' ? 'text-brand' : 'text-ok')}><RichText text={a.outcome} /></div>}
      {a.status === 'pending' && (
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="primary" busy={busy} onClick={() => onDecide(a.toolUseId, true)}>
            אישור וביצוע
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDecide(a.toolUseId, false)}>
            דחייה
          </Button>
        </div>
      )}
    </div>
  );
}

export function AgentChat({ status }: { status: AgentStatusDto | undefined }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [current, setCurrent] = useState<string | null>(null);
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);

  const list = useQuery({ queryKey: ['agent', 'conversations'], queryFn: () => admin.get<AgentConversationSummary[]>('/agent/conversations') });
  const conv = useQuery({
    queryKey: ['agent', 'conversation', current],
    queryFn: () => admin.get<AgentConversationDto>(`/agent/conversations/${current}`),
    enabled: Boolean(current),
    refetchInterval: (q) => (q.state.data?.status === 'working' ? 1500 : false),
  });
  const data = current ? conv.data : undefined;
  const working = data?.status === 'working';
  const waiting = data?.status === 'awaiting_approval';

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [data?.messages.length, working]);
  // When a turn finishes, refresh the list (titles, statuses).
  useEffect(() => {
    if (data && !working) void qc.invalidateQueries({ queryKey: ['agent', 'conversations'] });
  }, [data, working, qc]);

  const refresh = () => void qc.invalidateQueries({ queryKey: ['agent', 'conversation', current] });
  const send = useMutation({
    mutationFn: (message: string) => admin.post<{ conversationId: string }>('/agent/messages', { text: message, conversationId: current ?? undefined }),
    onSuccess: (r) => {
      setText('');
      setCurrent(r.conversationId);
      void qc.invalidateQueries({ queryKey: ['agent'] });
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  const decide = useMutation({
    mutationFn: (v: { toolUseId: string; approve: boolean }) => admin.post(`/agent/conversations/${current}/decide`, v),
    onSuccess: refresh,
    onError: (e) => toast(errorMessage(e), 'danger'),
  });

  const submit = (message: string) => {
    if (message.trim() && !send.isPending && !working && !waiting) send.mutate(message.trim());
  };

  return (
    <div className="flex h-[calc(100vh-15rem)] min-h-[520px] overflow-hidden rounded-xl bg-white ring-1 ring-line">
      <aside className="flex w-64 shrink-0 flex-col border-l border-line-soft bg-canvas">
        <div className="p-3">
          <Button variant="dark" className="w-full" onClick={() => setCurrent(null)}>
            + שיחה חדשה
          </Button>
        </div>
        <ul className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3" aria-label="שיחות קודמות">
          {list.data?.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setCurrent(c.id)}
                className={cx('w-full rounded-lg px-3 py-2 text-right text-sm', current === c.id ? 'bg-brand-soft font-bold text-brand-deep' : 'hover:bg-stone')}
              >
                <span className="block truncate">{c.title || 'שיחה'}</span>
                <span className="flex items-center gap-1 text-xs text-muted">
                  {c.status === 'awaiting_approval' && <span className="size-2 rounded-full bg-warn" aria-label="מחכה לאישור" />}
                  {c.status === 'working' && <Spinner small />}
                  {timeAgo(c.updatedAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        {status && !status.live && (
          <p className="bg-warn-soft px-4 py-2 text-sm font-semibold text-warn">
            Claude עוד לא מחובר, אז הסוכן עונה במצב הדגמה (מבין רק כמה בקשות פשוטות). חברו את Claude ב&quot;הגדרות&quot; ← &quot;חיבורים&quot;.
          </p>
        )}
        <div className="flex-1 space-y-3 overflow-y-auto p-5" aria-live="polite">
          {!data ? (
            <div className="mx-auto max-w-lg py-10 text-center">
              <p className="font-display text-xl font-extrabold">במה אפשר לעזור?</p>
              <p className="mt-2 text-[15px] text-muted">הסוכן קורא את המערכת ויכול לבצע פעולות: איתור, שמירה לעריכה, פרסום, רשתות חברתיות והגדרות סוכן העריכה. כל שינוי מחכה לאישור שלכם.</p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" onClick={() => submit(s)} className="rounded-full bg-stone px-3 py-1.5 text-sm font-semibold text-ink-2 hover:bg-line">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            data.messages.map((m) =>
              m.kind === 'user' ? (
                <div key={m.id} className="mr-0 ml-auto max-w-xl rounded-2xl rounded-tr-sm bg-ink px-4 py-2.5 text-white">
                  <RichText text={m.text} />
                </div>
              ) : m.kind === 'assistant' ? (
                <div key={m.id} className="max-w-2xl rounded-2xl rounded-tl-sm bg-stone px-4 py-2.5">
                  <RichText text={m.text} />
                </div>
              ) : m.kind === 'action' ? (
                <ActionCard key={m.id} m={m} busy={decide.isPending} onDecide={(toolUseId, approve) => decide.mutate({ toolUseId, approve })} />
              ) : (
                <p key={m.id} className="text-sm font-semibold text-warn">
                  {m.text}
                </p>
              ),
            )
          )}
          {working && (
            <p className="flex items-center gap-2 text-sm text-muted" role="status">
              <Spinner small /> הסוכן עובד…
            </p>
          )}
          <div ref={end} />
        </div>

        <form
          className="flex items-end gap-2 border-t border-line-soft p-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit(text);
          }}
        >
          <textarea
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit(text);
              }
            }}
            placeholder={waiting ? 'אשרו או דחו את הפעולה שהסוכן הציע כדי להמשיך' : 'כתבו לסוכן… (Enter לשליחה, Shift+Enter לשורה חדשה)'}
            disabled={working || waiting}
            aria-label="הודעה לסוכן"
            className={cx(inputClass, 'flex-1 resize-none')}
          />
          <Button type="submit" variant="primary" busy={send.isPending} disabled={!text.trim() || working || waiting}>
            שליחה
          </Button>
        </form>
      </section>
    </div>
  );
}
