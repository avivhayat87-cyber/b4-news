'use client';
// The editor's side panels: the read-only original, the AI writing partner,
// the 4-image picker, and the publishing settings.
import { CATEGORIES, DRAFT_COLORS, PLACEMENTS, textToDoc, docToHtml, type AuthorDto, type ChatMessageDto, type DraftDetail, type ImageBatchDto, type JobRef, type MediaDto } from '@b4/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { admin, errorMessage } from '@/lib/api';
import { COLOR, PLACEMENT, categoryName, formatDateTime, formatTime } from '@/lib/labels';
import { FocalPicker, UploadButton } from '../image-upload';
import { Badge, Button, ColorDot, Field, Spinner, cx, inputClass, useToast } from '../ui';

// --- The original (left pane) ------------------------------------------------
export function OriginalPane({ draft }: { draft: DraftDetail }) {
  const o = draft.original;
  if (!o) {
    return <p className="p-6 text-muted">הכתבה נכתבה ידנית, אין מקור להשוואה.</p>;
  }
  // The scraped text is untrusted: rendered through the same safe text-to-HTML path as everything else.
  const html = docToHtml(textToDoc(o.bodyText ?? ''));
  return (
    <article className="p-6">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted">
        <Badge tone="muted">מקור · לקריאה בלבד</Badge>
        <span className="font-bold text-ink-2">{o.sourceName}</span>
        {o.publishedAt && <span>{formatDateTime(o.publishedAt)}</span>}
        <a href={o.url} target="_blank" rel="noopener noreferrer nofollow" className="font-semibold hover:text-ink hover:underline">
          פתיחת המקור ↗
        </a>
      </div>
      {o.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- third-party source image
        <img src={o.imageUrl} alt="" referrerPolicy="no-referrer" className="mb-4 aspect-video w-full rounded-lg bg-stone object-cover" />
      )}
      <h2 className="font-display text-2xl font-extrabold leading-snug">{o.title}</h2>
      {o.intro && <p className="mt-2 text-lg font-semibold text-ink-2">{o.intro}</p>}
      <div className="reading mt-4 text-ink-2" dangerouslySetInnerHTML={{ __html: html }} />
    </article>
  );
}

// --- The AI writing partner --------------------------------------------------
const SUGGESTIONS = ['קצר את הכתבה בשליש', 'כתוב כותרת חדה יותר', 'הוסף כותרות ביניים', 'פשט את השפה', 'הדגש את המספרים החשובים בפתיחה'];

export function AiPanel({ draft, selection, busyJob, onQueued }: { draft: DraftDetail; selection: string; busyJob: JobRef | null; onQueued(): void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState('');
  const [useSelection, setUseSelection] = useState(true);
  const chat = useQuery({ queryKey: ['chat', draft.id], queryFn: () => admin.get<ChatMessageDto[]>(`/drafts/${draft.id}/chat`), refetchInterval: busyJob ? 2500 : false });
  const end = useRef<HTMLDivElement>(null);
  // When the AI finishes, fetch its reply right away.
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !busyJob) void qc.invalidateQueries({ queryKey: ['chat', draft.id] });
    wasBusy.current = !!busyJob;
  }, [busyJob, qc, draft.id]);
  useEffect(() => {
    // Braces matter: newer browsers return a Promise from scrollIntoView, and an effect may only return a cleanup function.
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [chat.data?.length]);
  const locked = draft.status === 'text_final' || draft.status === 'published' || draft.status === 'skipped';

  const send = useMutation({
    mutationFn: (instruction: string) => admin.post(`/drafts/${draft.id}/refine`, { instruction, selection: useSelection && selection ? selection : undefined }),
    onSuccess: () => {
      setText('');
      void qc.invalidateQueries({ queryKey: ['chat', draft.id] });
      onQueued();
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  const retry = useMutation({
    mutationFn: () => admin.post(`/drafts/${draft.id}/retry-ai`),
    onSuccess: onQueued,
    onError: (e) => toast(errorMessage(e), 'danger'),
  });

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto p-5">
        <p className="rounded-lg bg-stone px-3 py-2 text-sm text-ink-2">
          ה-AI כתב את הטיוטה כ"כתב חיצוני": אותן עובדות, ניסוח חדש בסגנון שלנו. כתבו לו הערה והוא יתקן את הכתבה על הקנבס. סמנו קטע בקנבס כדי שיתקן רק אותו.
        </p>
        {draft.status === 'ai_failed' && (
          <div className="rounded-lg bg-brand-soft p-3 text-sm text-brand-deep">
            ה-AI לא הצליח לכתוב את הטיוטה. אפשר לנסות שוב או לכתוב ידנית מהמקור.
            <Button size="sm" className="mr-2" busy={retry.isPending} onClick={() => retry.mutate()}>
              לנסות שוב
            </Button>
          </div>
        )}
        {chat.data?.map((m) => (
          <div key={m.id} className={cx('max-w-[90%] rounded-2xl px-4 py-2.5 text-[15px]', m.role === 'user' ? 'mr-auto bg-ink text-white' : 'bg-white ring-1 ring-line')}>
            <p className="whitespace-pre-wrap">{m.content}</p>
            <p className={cx('mt-1 text-[11px]', m.role === 'user' ? 'text-white/60' : 'text-muted')}>{formatTime(m.createdAt)}</p>
          </div>
        ))}
        {busyJob && (
          <div className="flex items-center gap-2 text-sm font-semibold text-info" role="status">
            <Spinner small /> ה-AI עובד על הכתבה…
          </div>
        )}
        <div ref={end} />
      </div>
      <form
        className="space-y-2 border-t border-line-soft p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim().length >= 2) send.mutate(text.trim());
        }}
      >
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" disabled={locked || !!busyJob} onClick={() => setText(s)} className="rounded-full bg-stone px-2.5 py-1 text-xs font-semibold text-ink-2 hover:bg-line disabled:opacity-50">
              {s}
            </button>
          ))}
        </div>
        {selection && (
          <label className="flex items-start gap-2 rounded-lg bg-info-soft px-3 py-2 text-xs text-info">
            <input type="checkbox" checked={useSelection} onChange={(e) => setUseSelection(e.target.checked)} className="mt-0.5" />
            <span>
              לתקן רק את הקטע המסומן: <q className="line-clamp-2">{selection}</q>
            </span>
          </label>
        )}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={locked ? 'הטקסט סומן כסופי. פתחו אותו לעריכה כדי לבקש תיקונים.' : 'מה לשנות? למשל: "הפסקה השלישית ארוכה מדי"'}
          rows={3}
          disabled={locked || !!busyJob}
          className={inputClass}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
          }}
        />
        <Button type="submit" variant="dark" className="w-full" busy={send.isPending} disabled={locked || !!busyJob || text.trim().length < 2}>
          שליחה ל-AI
        </Button>
      </form>
    </div>
  );
}

// --- Images: 4 AI options, "4 new", or upload ---------------------------------
export function ImagesPanel({ draft, onHero }: { draft: DraftDetail; onHero(m: MediaDto | null): void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const images = useQuery({
    queryKey: ['images', draft.id],
    queryFn: () => admin.get<{ batches: ImageBatchDto[]; activeJob: JobRef | null }>(`/drafts/${draft.id}/images`),
    refetchInterval: (q) => (q.state.data?.activeJob ? 2500 : false),
  });
  const [prompt, setPrompt] = useState<string | null>(null);
  const generate = useMutation({
    mutationFn: () => admin.post(`/drafts/${draft.id}/images`, { prompt: prompt?.trim() || undefined }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['images', draft.id] }),
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  const busy = !!images.data?.activeJob;
  const locked = draft.status === 'published';

  return (
    <div className="space-y-5 p-5">
      <div>
        <h3 className="mb-2 font-extrabold">התמונה הראשית</h3>
        {draft.hero ? (
          <FocalPicker media={draft.hero} onChange={onHero} />
        ) : (
          <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm font-semibold text-warn">עוד לא נבחרה תמונה ראשית. בחרו אחת מהאפשרויות או העלו תמונה.</p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <UploadButton onUploaded={(m) => onHero(m)} label="העלאת תמונה משלי" />
          {draft.hero && (
            <Button variant="ghost" onClick={() => onHero(null)} disabled={locked}>
              הסרת התמונה
            </Button>
          )}
        </div>
      </div>

      <div className="border-t border-line-soft pt-5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="font-extrabold">תמונות AI לבחירה</h3>
          <Button size="sm" variant="dark" busy={generate.isPending || busy} disabled={locked} onClick={() => generate.mutate()}>
            {images.data?.batches.length ? '4 תמונות חדשות' : 'יצירת 4 תמונות'}
          </Button>
        </div>
        <Field label="תיאור לתמונה (אפשר לשנות לפני יצירה)" htmlFor="img-prompt">
          <textarea
            id="img-prompt"
            rows={2}
            value={prompt ?? images.data?.batches[0]?.prompt ?? ''}
            onChange={(e) => setPrompt(e.target.value)}
            className={inputClass}
            dir="auto"
          />
        </Field>
        {busy && (
          <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-info" role="status">
            <Spinner small /> יוצר 4 תמונות…
          </p>
        )}
        <div className="mt-3 space-y-4">
          {images.data?.batches.map((b) => (
            <div key={b.id}>
              <p className="mb-1.5 text-xs text-muted">{formatDateTime(b.createdAt)}</p>
              <div className="grid grid-cols-2 gap-2">
                {b.images.map((m) => {
                  const chosen = draft.hero?.id === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      disabled={locked}
                      onClick={() => onHero(m)}
                      aria-pressed={chosen}
                      className={cx('group relative overflow-hidden rounded-lg ring-offset-2', chosen ? 'ring-4 ring-brand' : 'hover:ring-2 hover:ring-ink')}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- API-hosted image */}
                      <img src={m.thumbUrl} alt="" className="aspect-video w-full object-cover" />
                      {chosen && <span className="absolute right-1.5 top-1.5 rounded bg-brand px-1.5 py-0.5 text-[11px] font-bold text-white">נבחרה</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// --- Publishing settings: placement, category, tags, byline -----------------------
export function MetaPanel({ draft, onSaved }: { draft: DraftDetail; onSaved(): void }) {
  const toast = useToast();
  const authors = useQuery({ queryKey: ['authors'], queryFn: () => admin.get<AuthorDto[]>('/authors'), staleTime: 5 * 60_000 });
  const [tag, setTag] = useState('');
  const locked = draft.status === 'published';
  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) => admin.patch(`/drafts/${draft.id}`, patch),
    onSuccess: onSaved,
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  const addTag = () => {
    const t = tag.trim();
    if (!t || draft.tags.includes(t)) return setTag('');
    save.mutate({ tags: [...draft.tags, t] });
    setTag('');
  };

  return (
    <div className="space-y-6 p-5">
      <fieldset disabled={locked} className="space-y-6">
        <div>
          <legend className="mb-2 text-sm font-bold text-ink-2">מיקום באתר</legend>
          <div className="grid grid-cols-3 gap-2" role="radiogroup">
            {PLACEMENTS.map((p) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={draft.placement === p}
                onClick={() => save.mutate({ placement: p })}
                className={cx('rounded-lg px-3 py-2.5 text-sm font-bold ring-1', draft.placement === p ? 'bg-ink text-white ring-ink' : 'bg-white ring-line hover:bg-stone')}
              >
                {PLACEMENT[p]}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-muted">ראשית: אחת מ-7 הכתבות בראש האתר. חמות: אחת מ-14 בפס החם. בכל מקרה הכתבה מופיעה גם בקטגוריה שלה.</p>
        </div>

        <Field label="קטגוריה" htmlFor="category" hint={draft.suggestedCategory ? `ה-AI הציע: ${categoryName(draft.suggestedCategory)}` : undefined}>
          <select id="category" value={draft.category ?? ''} onChange={(e) => save.mutate({ category: e.target.value || null })} className={inputClass}>
            <option value="">בחרו קטגוריה</option>
            {CATEGORIES.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="תגיות" htmlFor="tag">
          <div className="flex flex-wrap gap-1.5">
            {draft.tags.map((t) => (
              <span key={t} className="inline-flex items-center gap-1 rounded-full bg-stone px-2.5 py-1 text-sm font-semibold">
                {t}
                <button type="button" aria-label={`הסרת ${t}`} onClick={() => save.mutate({ tags: draft.tags.filter((x) => x !== t) })} className="text-muted hover:text-brand">
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input
              id="tag"
              value={tag}
              maxLength={40}
              onChange={(e) => setTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addTag();
                }
              }}
              placeholder="תגית חדשה"
              className={inputClass}
            />
            <Button onClick={addTag}>הוספה</Button>
          </div>
        </Field>

        <Field label="כותב/ת (קרדיט)" htmlFor="author" hint="אם לא נבחר, הכתבה תופיע בשם המערכת. שם העורך/ת נשמר בכל מקרה.">
          <select id="author" value={draft.authorId ?? ''} onChange={(e) => save.mutate({ authorId: e.target.value || null })} className={inputClass}>
            <option value="">מערכת B4</option>
            {authors.data?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.displayName}
                {a.title ? ` · ${a.title}` : ''}
              </option>
            ))}
          </select>
        </Field>

        <label className="flex items-center gap-3 rounded-lg bg-stone px-3 py-2.5 text-sm font-semibold">
          <input type="checkbox" checked={draft.sendPush} onChange={(e) => save.mutate({ sendPush: e.target.checked })} className="size-4" />
          לשלוח התראת פוש באפליקציה עם הפרסום (מבזק)
        </label>

        {!draft.magazine && (
          <div>
            <p className="mb-2 text-sm font-bold text-ink-2">צבע בעריכות השמורות</p>
            <div className="flex gap-1.5">
              {DRAFT_COLORS.map((c) => (
                <button key={c} type="button" aria-label={COLOR[c]} title={COLOR[c]} aria-pressed={draft.colorLabel === c} onClick={() => save.mutate({ colorLabel: c })} className={cx('rounded-full p-1.5', draft.colorLabel === c && 'ring-2 ring-ink')}>
                  <ColorDot color={c} className="size-4" />
                </button>
              ))}
            </div>
          </div>
        )}
      </fieldset>
    </div>
  );
}
