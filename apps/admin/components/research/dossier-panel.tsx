'use client';
// The editor's "תיק התחקיר" tab: what the report said, every detail with its label and sources,
// what is still open, who must be asked for a response, and the proof kept of every source (a copy
// of its text and a screenshot of the page), in case the page changes or disappears.
import { CLAIM_LABELS, type ResearchSourceDto, type ResearchTaskDto, type SourceCopyDto } from '@b4/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Button, Spinner, cx, useToast } from '@/components/ui';
import { admin, errorMessage } from '@/lib/api';
import { CLAIM_LABEL, RESEARCH_DEPTH, RESEARCH_STATUS, SOURCE_KIND, formatDateTime } from '@/lib/labels';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-extrabold text-ink-2">{title}</h3>
      {children}
    </section>
  );
}

function SourceCopy({ taskId, source }: { taskId: string; source: ResearchSourceDto }) {
  const [open, setOpen] = useState(false);
  const copy = useQuery({ queryKey: ['source-copy', taskId, source.id], queryFn: () => admin.get<SourceCopyDto>(`/research/${taskId}/sources/${source.id}/text`), enabled: open });
  return (
    <div>
      <button type="button" onClick={() => setOpen((v) => !v)} className="text-xs font-bold text-info underline">
        {open ? 'הסתרת העותק' : 'העותק השמור של הטקסט'}
      </button>
      {open && (
        <div className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg bg-stone p-3 text-xs leading-relaxed text-ink-2">
          {copy.isPending ? <Spinner small /> : copy.isError ? errorMessage(copy.error) : copy.data?.text}
        </div>
      )}
    </div>
  );
}

function SourceCard({ taskId, source }: { taskId: string; source: ResearchSourceDto }) {
  const a = source.archive;
  return (
    <li className="space-y-2 rounded-lg bg-white p-3 ring-1 ring-line">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold">{source.publisher}</span>
        <Badge tone={source.approved ? 'ok' : source.kind === 'news' ? 'warn' : 'muted'}>{SOURCE_KIND[source.kind]}</Badge>
        {!source.approved && source.kind !== 'wiki' && <span className="text-xs text-muted">לא מבסס עובדה</span>}
        <span className="mr-auto text-xs text-muted">{source.id}</span>
      </div>
      <a href={source.url} target="_blank" rel="noopener noreferrer nofollow" dir="auto" className="block truncate text-sm text-info underline">
        {source.title || source.url}
      </a>
      <div className="flex flex-wrap items-start gap-3 text-xs text-muted">
        {a.status === 'pending' && (
          <span className="flex items-center gap-1.5">
            <Spinner small /> שומר עותק…
          </span>
        )}
        {a.status !== 'pending' && <span>{a.status === 'saved' ? `נשמר ${formatDateTime(a.capturedAt)}` : a.status === 'skipped' ? 'לא נשמר: נשמרים עד 12 מקורות לתחקיר' : 'לא נשמר'}</span>}
        {a.error && <span className="text-warn">{a.error}</span>}
      </div>
      {a.screenshotUrl && (
        <a href={a.screenshotUrl} target="_blank" rel="noopener noreferrer" className="block">
          {/* eslint-disable-next-line @next/next/no-img-element -- our own copy of the page */}
          <img src={a.screenshotUrl} alt={`צילום העמוד של ${source.publisher}`} className="max-h-48 w-full rounded-md object-cover object-top ring-1 ring-line" />
        </a>
      )}
      {a.hasText && <SourceCopy taskId={taskId} source={source} />}
    </li>
  );
}

/** An update of this article from a new research: put in at the top by the editor, or set aside. */
function UpdateBox({ task, onDone }: { task: ResearchTaskDto; onDone(): void }) {
  const toast = useToast();
  const apply = useMutation({
    mutationFn: () => admin.post(`/research/${task.id}/apply-update`),
    onSuccess: () => {
      toast('העדכון נכנס לראש הכתבה. באתר הוא יופיע רק אחרי "שמירה ועדכון באתר".');
      onDone();
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  const dismiss = useMutation({ mutationFn: () => admin.post(`/research/${task.id}/dismiss-update`), onSuccess: onDone, onError: (e) => toast(errorMessage(e), 'danger') });
  const u = task.update!;
  if (u.state === 'empty') return <p className="rounded-lg bg-stone px-4 py-3 text-sm text-ink-2">הכתב-החוקר בדק ולא מצא משהו חדש לעומת הכתבה. {u.reason}</p>;
  return (
    <section className={cx('space-y-3 rounded-lg px-4 py-3 ring-1', u.state === 'ready' ? 'bg-info-soft ring-info/30' : 'bg-stone ring-line')}>
      <p className="font-bold text-info">{u.state === 'ready' ? 'הכתב-החוקר מציע עדכון לכתבה' : u.state === 'applied' ? 'העדכון הוכנס לכתבה' : 'העדכון לא הוכנס'}</p>
      <div className="space-y-2 rounded-md bg-white p-3 text-sm leading-relaxed">
        <p className="font-bold">עדכון</p>
        {u.paragraphs.map((p) => (
          <p key={p} dir="auto">
            {p}
          </p>
        ))}
      </div>
      {u.state === 'ready' && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="primary" busy={apply.isPending} onClick={() => apply.mutate()}>
            להכניס לראש הכתבה
          </Button>
          <Button size="sm" variant="ghost" busy={dismiss.isPending} onClick={() => dismiss.mutate()}>
            לא עכשיו
          </Button>
        </div>
      )}
      <p className="text-xs text-muted">העדכון כתוב רק מהתיק שלמטה. מקורות העדכון יצטרפו לשורת המקורות בסוף הכתבה.</p>
    </section>
  );
}

export function DossierPanel({ draftId }: { draftId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [legend, setLegend] = useState(false);
  const q = useQuery({
    queryKey: ['draft-research', draftId],
    queryFn: () => admin.get<ResearchTaskDto | null>(`/drafts/${draftId}/research`),
    refetchInterval: (query) => (query.state.data?.dossier?.sources.some((x) => x.archive.status === 'pending') ? 5000 : false),
  });
  const archive = useMutation({
    mutationFn: () => admin.post(`/research/${q.data!.id}/archive`),
    onSuccess: () => {
      toast('שומרים שוב את המקורות.');
      void qc.invalidateQueries({ queryKey: ['draft-research', draftId] });
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  if (q.isPending) return <div className="p-6"><Spinner /></div>;
  if (q.isError) return <p className="p-6 text-danger">{errorMessage(q.error)}</p>;
  const task = q.data;
  const d = task?.dossier;
  if (!task || !d) return <p className="p-6 text-muted">לכתבה הזאת אין תיק תחקיר.</p>;
  const byId = new Map(d.sources.map((x) => [x.id, x]));
  const unsaved = d.sources.some((x) => x.archive.status === 'failed');

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <Badge tone={RESEARCH_STATUS[task.status].tone}>{RESEARCH_STATUS[task.status].label}</Badge>
        <span>
          תחקיר {RESEARCH_DEPTH[task.depth].name} · {task.searches} חיפושים · ${task.costUsd.toFixed(2)} · {task.createdBy} · {formatDateTime(task.createdAt)}
        </span>
      </div>

      {task.update && <UpdateBox task={task} onDone={() => { void qc.invalidateQueries({ queryKey: ['draft-research', draftId] }); void qc.invalidateQueries({ queryKey: ['draft', draftId] }); }} />}

      {!d.claims.some((c) => c.label === 'verified') && (
        <div className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger" role="note">
          <p className="font-bold">לא נמצא מקור רשמי לאף פרט</p>
          <p className="mt-0.5 text-ink-2">הכתבה נשענת על דיווחים וטענות בלבד. אפשר לנסות תחקיר בעומק &quot;רגיל&quot;, לפנות לגוף הרשמי, או לא לפרסם.</p>
        </div>
      )}

      <Section title={task.kind === 'idea' ? 'הרעיון' : 'מה נטען בדיווח'}>
        <div className="space-y-2 rounded-lg bg-stone p-3 text-sm">
          <p className="text-muted">{[d.original.who, d.original.when].filter(Boolean).join(' · ')}</p>
          <p dir="auto">{d.original.what}</p>
          {d.original.url && (
            <a href={d.original.url} target="_blank" rel="noopener noreferrer nofollow" dir="ltr" className="block truncate text-info underline">
              {d.original.url}
            </a>
          )}
          {task.screenshots.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {task.screenshots.map((src) => (
                <a key={src} href={src} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element -- the uploaded screenshot */}
                  <img src={src} alt="צילום המסך שהועלה" className="h-28 w-20 rounded-md object-cover object-top ring-1 ring-line" />
                </a>
              ))}
            </div>
          )}
          {task.note && <p className="text-xs text-muted">ההערה שלכם: {task.note}</p>}
        </div>
      </Section>

      <Section title="מה ידוע עכשיו">
        <p className="text-sm leading-relaxed" dir="auto">{d.summary}</p>
      </Section>

      {d.responseNeeded.length > 0 && (
        <div className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn" role="note">
          <p className="font-bold">לפני פרסום: לפנות לתגובה</p>
          <ul className="mt-1 list-inside list-disc text-ink-2">
            {d.responseNeeded.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      )}

      <Section title={`הפרטים (${d.claims.length})`}>
        <button type="button" onClick={() => setLegend((v) => !v)} className="text-xs font-bold text-info underline">
          {legend ? 'הסתרת ההסבר' : 'מה כל סימון אומר?'}
        </button>
        {legend && (
          <ul className="space-y-1 rounded-lg bg-stone p-3 text-xs">
            {CLAIM_LABELS.map((l) => (
              <li key={l}>
                <Badge tone={CLAIM_LABEL[l].tone}>{CLAIM_LABEL[l].name}</Badge> {CLAIM_LABEL[l].how}
              </li>
            ))}
          </ul>
        )}
        <ol className="space-y-2">
          {d.claims.map((c) => (
            <li key={c.id} className={cx('space-y-1.5 rounded-lg p-3 ring-1', c.label === 'unverified' || c.label === 'debunked' ? 'bg-danger-soft/40 ring-danger/20' : 'bg-white ring-line')}>
              <div className="flex items-start gap-2">
                <Badge tone={CLAIM_LABEL[c.label].tone}>{CLAIM_LABEL[c.label].name}</Badge>
                <p className="text-sm leading-relaxed" dir="auto">{c.text}</p>
              </div>
              {c.sourceIds.length > 0 && (
                <p className="text-xs text-muted">
                  מקורות:{' '}
                  {c.sourceIds.map((id, i) => {
                    const src = byId.get(id);
                    return src ? (
                      <span key={id}>
                        {i > 0 && ', '}
                        <a href={src.url} target="_blank" rel="noopener noreferrer nofollow" className="underline">
                          {src.publisher}
                        </a>
                      </span>
                    ) : null;
                  })}
                </p>
              )}
              {c.note && <p className="text-xs text-ink-2">{c.note}</p>}
            </li>
          ))}
        </ol>
      </Section>

      {d.background.length > 0 && (
        <Section title="רקע והסבר">
          {d.background.map((p) => (
            <p key={p} className="text-sm leading-relaxed text-ink-2" dir="auto">
              {p}
            </p>
          ))}
        </Section>
      )}

      {d.openQuestions.length > 0 && (
        <Section title="מה עדיין לא ידוע">
          <ul className="list-inside list-disc text-sm text-ink-2">
            {d.openQuestions.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="שורת המקורות בסוף הכתבה">
        <p className="rounded-lg bg-stone px-3 py-2 text-sm font-semibold">{d.creditLine || 'אין מקור רשמי לציין.'}</p>
        <p className="text-xs text-muted">שמות בלבד, בלי קישורים. אתרי חדשות לא מופיעים בה: הם רק עזרו למצוא את המקור.</p>
      </Section>

      <Section title={`המקורות וההוכחות (${d.sources.length})`}>
        <p className="text-xs text-muted">עותק של הטקסט וצילום של כל עמוד נשמרים כאן, למקרה שהעמוד ישתנה או יימחק.</p>
        {unsaved && (
          <Button size="sm" busy={archive.isPending} onClick={() => archive.mutate()}>
            לנסות שוב לשמור את המקורות
          </Button>
        )}
        <ul className="space-y-2">
          {d.sources.map((x) => (
            <SourceCard key={x.id} taskId={task.id} source={x} />
          ))}
        </ul>
      </Section>
    </div>
  );
}
