'use client';
// The editor's side panels: the read-only original, the AI writing partner,
// the image picker, and the publishing settings.
import {
  CATEGORIES,
  DRAFT_COLORS,
  PLACEMENTS,
  textToDoc,
  docToHtml,
  needsInvestmentNotice,
  type AuthorDto,
  type ChatMessageDto,
  type DraftDetail,
  type DraftImagesDto,
  type JobRef,
  type MediaDto,
  type SimilarityDto,
} from '@b4/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { admin, errorMessage } from '@/lib/api';
import { COLOR, PLACEMENT, PROMPT_BY, categoryName, formatDateTime, formatTime } from '@/lib/labels';
import { FocalPicker, UploadButton } from '../image-upload';
import { FactCheck } from './fact-check';
import { Badge, Button, ColorDot, Field, Spinner, cx, inputClass, useToast } from '../ui';
import { HighlightedText } from './highlight';
import { FOCUS_RING } from './readiness';

// --- The original (left pane) ------------------------------------------------
export function OriginalPane({ draft, onQueued }: { draft: DraftDetail; onQueued(): void }) {
  const o = draft.original;
  // A foreign original opens in its Hebrew translation; the original is one click away.
  const [showOriginal, setShowOriginal] = useState(false);
  const written = draft.status !== 'queued_ai' && draft.status !== 'ai_processing';
  const check = useQuery({
    queryKey: ['similarity', draft.id, draft.version],
    queryFn: () => admin.get<SimilarityDto>(`/drafts/${draft.id}/similarity`),
    enabled: !!o && written,
  });
  if (!o) {
    return <p className="p-6 text-muted">{draft.origin === 'research' ? 'הכתבה נכתבה מתחקיר. הדיווח, הפרטים והמקורות בלשונית "תיק התחקיר".' : 'הכתבה נכתבה ידנית, אין מקור להשוואה.'}</p>;
  }
  const t = o.language && !showOriginal ? o.translation : null;
  const shown = { title: t?.title ?? o.title, intro: t ? t.intro : o.intro, bodyText: t ? t.bodyText : o.bodyText };
  const foreignDir = o.language && !t ? 'auto' : undefined;
  // The scraped text is untrusted: rendered through the same safe text-to-HTML path as everything else.
  const html = docToHtml(textToDoc(shown.bodyText ?? ''));
  // The copied wording is marked in the text it was compared with (the Hebrew one for a foreign original).
  const passages = check.data && check.data.level !== 'ok' && (!o.language || t) ? check.data.passages : [];
  return (
    <article className="p-6">
      {written && (
        <div className="mb-4 space-y-3">
          <CopyCheck draft={draft} onQueued={onQueued} />
          <FactCheck draftId={draft.id} version={draft.version} />
        </div>
      )}
      {o.language && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-info-soft px-3 py-2 text-sm text-info">
          <span className="font-bold">כתבה מחו״ל ({o.language.toUpperCase()})</span>
          {o.translation ? (
            <span className="mr-auto inline-flex rounded-md bg-white p-0.5 ring-1 ring-info/20" role="tablist" aria-label="שפת התצוגה">
              <button type="button" role="tab" aria-selected={!showOriginal} onClick={() => setShowOriginal(false)} className={cx('rounded px-2.5 py-1 text-xs font-bold', !showOriginal ? 'bg-info text-white' : 'text-info')}>
                תרגום לעברית
              </button>
              <button type="button" role="tab" aria-selected={showOriginal} onClick={() => setShowOriginal(true)} className={cx('rounded px-2.5 py-1 text-xs font-bold', showOriginal ? 'bg-info text-white' : 'text-info')}>
                המקור
              </button>
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <Spinner small /> מתרגם את המקור לעברית…
            </span>
          )}
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted">
        <Badge tone="muted">{t ? 'תרגום המקור · לקריאה בלבד' : 'מקור · לקריאה בלבד'}</Badge>
        <span className="font-bold text-ink-2">{o.sourceName}</span>
        {o.publishedAt && <span>{formatDateTime(o.publishedAt)}</span>}
        <a
          href={o.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="mr-auto rounded-lg bg-white px-3 py-1.5 font-bold text-ink ring-1 ring-line hover:bg-stone"
        >
          לכתבה המקורית באתר ↗
        </a>
      </div>
      {draft.extraSources.length > 0 && (
        <div className="mb-4 rounded-lg bg-stone px-3 py-2.5 text-sm">
          <p className="font-bold">הכתבה נכתבה מ-{draft.extraSources.length + 1} דיווחים על אותו סיפור. כאן מוצג הראשי, ועוד:</p>
          <ul className="mt-1.5 space-y-1">
            {draft.extraSources.map((x) => (
              <li key={x.url} className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 font-bold text-ink-2">{x.sourceName}</span>
                <a href={x.url} target="_blank" rel="noopener noreferrer nofollow" dir="auto" className="min-w-0 truncate text-info hover:underline">
                  {x.title} ↗
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      {o.imageUrl && (
        <figure className="mb-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- third-party source image */}
          <img src={o.imageUrl} alt="" referrerPolicy="no-referrer" className="aspect-video w-full rounded-lg bg-stone object-cover" />
          <figcaption className="mt-1 text-xs text-muted">התמונה מאתר המקור. היא לא תפורסם אצלנו; בלשונית &quot;תמונות&quot; אפשר ליצור תמונה חדשה בהשראתה.</figcaption>
        </figure>
      )}
      <div dir={foreignDir}>
        <h2 className="font-display text-2xl font-extrabold leading-snug">{shown.title}</h2>
        {shown.intro && <p className="mt-2 text-lg font-semibold text-ink-2">{shown.intro}</p>}
        {passages.length > 0 ? (
          <div className="reading mt-4 text-ink-2">
            <HighlightedText text={shown.bodyText ?? ''} passages={passages} />
          </div>
        ) : (
          <div className="reading mt-4 text-ink-2" dangerouslySetInnerHTML={{ __html: html }} />
        )}
      </div>
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

// --- Images: 3 quick AI drafts in 3 styles (a real photo for a public figure), the agent's pick, or upload ---
export function ImagesPanel({ draft, focus, onHero }: { draft: DraftDetail; focus?: boolean; onHero(m: MediaDto | null): void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const images = useQuery({
    queryKey: ['images', draft.id],
    queryFn: () => admin.get<DraftImagesDto>(`/drafts/${draft.id}/images`),
    refetchInterval: (q) => (q.state.data?.activeJob || q.state.data?.upgrade?.status === 'working' ? 2500 : false),
  });
  const upgrade = images.data?.upgrade ?? null;
  // The full-quality version took the draft's place on the server: show it.
  const heroId = images.data?.heroId;
  useEffect(() => {
    if (heroId !== undefined && heroId !== (draft.hero?.id ?? null)) void qc.invalidateQueries({ queryKey: ['draft', draft.id] });
  }, [heroId, draft.hero?.id, draft.id, qc]);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [useSource, setUseSource] = useState(false);
  const sourceImage = draft.original?.imageUrl ?? null;
  const generate = useMutation({
    // A retry draws the failed round again from its own descriptions.
    mutationFn: (retryOf: string | undefined) =>
      admin.post(`/drafts/${draft.id}/images`, retryOf ? { retryOf } : { prompt: prompt?.trim() || undefined, useSourceImage: useSource && !!sourceImage }),
    onSuccess: () => {
      setPrompt(null);
      void qc.invalidateQueries({ queryKey: ['images', draft.id] });
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  const busy = !!images.data?.activeJob;
  const locked = draft.status === 'published';
  const options = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus) options.current?.scrollIntoView({ block: 'nearest' });
  }, [focus]);

  return (
    <div className="space-y-5 p-5">
      <div>
        <h3 className="mb-2 font-extrabold">התמונה הראשית</h3>
        {draft.hero ? (
          // The focal point is saved on the image itself; the draft only needs to show the new crops.
          <FocalPicker media={draft.hero} onChange={() => void qc.invalidateQueries({ queryKey: ['draft', draft.id] })} />
        ) : (
          <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm font-semibold text-warn">עוד לא נבחרה תמונה ראשית. בחרו אחת מהאפשרויות או העלו תמונה.</p>
        )}
        {images.data?.heroIsDraft && !upgrade && (
          <p className="mt-2 text-xs text-muted">זו עדיין טיוטה מהירה. היא תיווצר באיכות מלאה רק באישור הסופי לפרסום, אז אפשר להחליף אותה עד אז בלי עלות.</p>
        )}
        {upgrade?.status === 'working' && (
          <p className="mt-2 flex items-center gap-2 text-sm font-semibold text-info" role="status">
            <Spinner small /> מכין את התמונה שבחרתם באיכות מלאה…
          </p>
        )}
        {upgrade?.status === 'failed' && draft.hero && (
          <div className="mt-2 rounded-lg bg-brand-soft px-3 py-2.5 text-sm text-brand-deep" role="alert">
            <p className="font-bold">התמונה באיכות מלאה לא נוצרה, ובינתיים מוצגת הטיוטה.</p>
            <p className="mt-0.5">{upgrade.error}</p>
            <Button size="sm" className="mt-2" disabled={locked} onClick={() => onHero(draft.hero)}>
              לנסות שוב
            </Button>
          </div>
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
          <h3 className="font-extrabold">תמונות לבחירה</h3>
          <Button size="sm" variant="dark" busy={generate.isPending || busy} disabled={locked} onClick={() => generate.mutate(undefined)}>
            {images.data?.batches.some((b) => b.images.length) ? '3 טיוטות חדשות' : 'יצירת 3 טיוטות'}
          </Button>
        </div>
        <p className="mb-3 text-xs text-muted">
          שלוש טיוטות מהירות, כל אחת בסגנון אחר (את הסגנונות קובעים ב&quot;הגדרות&quot; &gt; &quot;צוות הסוכנים&quot; &gt; סוכן התמונות). כשהכתבה על אישיות ציבורית, אחת מהן יכולה להיות צילום אמיתי שלה, עם קרדיט. הסוכן מסמן את הבחירה שלו; התמונה שנבחרה נוצרת באיכות מלאה רק באישור הסופי.
        </p>
        {sourceImage && (
          <div className="mb-3 flex gap-3 rounded-lg bg-white p-3 ring-1 ring-line">
            {/* eslint-disable-next-line @next/next/no-img-element -- third-party source image */}
            <img src={sourceImage} alt="" referrerPolicy="no-referrer" className="aspect-video w-32 shrink-0 rounded-md bg-stone object-cover" />
            <div className="min-w-0 text-sm">
              <p className="font-bold">תמונת המקור · {draft.original?.sourceName}</p>
              <p className="mt-0.5 text-xs text-muted">שייכת לאתר המקור ולא תפורסם אצלנו. ה-AI יכול להיעזר בה כדי להבין מה מצולם, וליצור תמונה אחרת משלו.</p>
              <label className="mt-2 flex items-center gap-2 font-semibold">
                <input type="checkbox" checked={useSource} onChange={(e) => setUseSource(e.target.checked)} disabled={locked} className="size-4" />
                ליצור בהשראת תמונת המקור
              </label>
            </div>
          </div>
        )}
        <Field
          label="תיאור משלכם (לא חובה)"
          htmlFor="img-prompt"
          hint="ריק: הסוכן כותב שלושה תיאורים חדשים, אחד לכל סגנון, ומציע רעיונות אחרים בכל פעם. כתבתם תיאור? שלוש התמונות ייווצרו לפיו, והסוכן לומד מזה."
        >
          <textarea
            id="img-prompt"
            rows={2}
            value={prompt ?? ''}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="למשל: מגדלי משרדים בתל אביב בשעת שקיעה, מבט מלמטה"
            className={inputClass}
            dir="auto"
          />
        </Field>
        {busy && (
          <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-info" role="status">
            <Spinner small /> {images.data?.batches[0] && !images.data.batches[0].prompt ? 'סוכן התמונות כותב שלושה תיאורים, מצייר ובוחר…' : 'יוצר 3 טיוטות…'}
          </p>
        )}
        <div ref={options} className={cx('mt-3 space-y-5', focus && FOCUS_RING)}>
          {images.data?.batches.map((b) => (
            <div key={b.id}>
              <p className="mb-1.5 text-xs text-muted">
                {formatDateTime(b.createdAt)}
                {b.promptBy && ` · ${PROMPT_BY[b.promptBy]}`}
              </p>
              {b.variants.length === 0 && b.prompt && (
                <p className="mb-1.5 line-clamp-2 text-xs text-ink-2" dir="auto" title={b.prompt}>
                  {b.prompt}
                </p>
              )}
              {b.status === 'failed' && b.images.length === 0 && (
                <div className="rounded-lg bg-brand-soft px-3 py-2.5 text-sm text-brand-deep" role="alert">
                  <p className="font-semibold">{b.error}</p>
                  <Button size="sm" className="mt-2" busy={generate.isPending} disabled={locked || busy} onClick={() => generate.mutate(b.id)}>
                    לנסות שוב
                  </Button>
                </div>
              )}
              {b.note && <p className="mb-1.5 text-xs font-semibold text-warn">{b.note}</p>}
              {b.pick && (
                <p className="mb-1.5 text-xs text-info">
                  <span className="font-bold">★ בחירת סוכן התמונות:</span> {b.pick.reason}
                </p>
              )}
              <div className="grid grid-cols-3 gap-2">
                {b.images.map((m) => {
                  const chosen = images.data?.chosenId === m.id;
                  const v = b.variants.find((x) => x.mediaId === m.id);
                  const agentPick = b.pick?.mediaId === m.id;
                  return (
                    <figure key={m.id} className="min-w-0">
                      <button
                        type="button"
                        disabled={locked}
                        onClick={() => onHero(m)}
                        aria-pressed={chosen}
                        aria-label={v ? `${v.kind === 'photo' ? 'צילום אמיתי' : v.style}${agentPick ? ', בחירת הסוכן' : ''}` : undefined}
                        className={cx('group relative block w-full overflow-hidden rounded-lg ring-offset-2', chosen ? 'ring-4 ring-brand' : 'hover:ring-2 hover:ring-ink')}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- API-hosted image */}
                        <img src={m.thumbUrl || m.url} alt="" className="aspect-video w-full object-cover" />
                        {chosen && <span className="absolute right-1.5 top-1.5 rounded bg-brand px-1.5 py-0.5 text-[11px] font-bold text-white">נבחרה</span>}
                        {agentPick && <span className="absolute left-1.5 top-1.5 rounded bg-info px-1.5 py-0.5 text-[11px] font-bold text-white">★ הסוכן</span>}
                        {v?.kind === 'photo' && <span className="absolute bottom-1.5 right-1.5 rounded bg-ink/80 px-1.5 py-0.5 text-[11px] font-bold text-white">צילום אמיתי</span>}
                      </button>
                      {v && (
                        <figcaption className="mt-1 text-[11px] leading-snug text-muted" dir="auto">
                          {v.kind === 'photo' ? (
                            <>
                              {v.credit}{' '}
                              {v.sourceUrl && (
                                <a href={v.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-info hover:underline">
                                  הרישיון ↗
                                </a>
                              )}
                            </>
                          ) : (
                            <span title={v.prompt} className="line-clamp-3">
                              <span className="font-bold text-ink-2">{v.style.split(/[,:]/)[0]}:</span> {v.prompt}
                            </span>
                          )}
                        </figcaption>
                      )}
                    </figure>
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

// --- Legal checks: disclosure of interests, wording copied from the original -------
function DisclosureField({ draft, onSave }: { draft: DraftDetail; onSave(value: string): void }) {
  const [value, setValue] = useState(draft.disclosure);
  const finance = draft.category ? needsInvestmentNotice(draft.category) : false;
  return (
    <Field
      label="גילוי נאות (לא חובה)"
      htmlFor="disclosure"
      hint={
        finance
          ? 'כתבת שוק הון: אם לכותב/ת יש החזקות או עניין בחברות שבכתבה, ציינו זאת. הכתבה תסתיים גם בהבהרה שאינה ייעוץ השקעות.'
          : 'יופיע בסוף הכתבה, למשל: "לכותב אין החזקות בחברות הנזכרות בכתבה".'
      }
    >
      <textarea
        id="disclosure"
        rows={2}
        maxLength={300}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => value.trim() !== draft.disclosure && onSave(value.trim())}
        className={inputClass}
      />
    </Field>
  );
}

/**
 * How much of the draft repeats the original word for word (rechecked after every save),
 * with the recommendation as one click: the AI rewords those passages on the canvas.
 */
function CopyCheck({ draft, onQueued, onShowSource }: { draft: DraftDetail; onQueued(): void; onShowSource?: () => void }) {
  const toast = useToast();
  const check = useQuery({ queryKey: ['similarity', draft.id, draft.version], queryFn: () => admin.get<SimilarityDto>(`/drafts/${draft.id}/similarity`) });
  const fix = useMutation({
    mutationFn: () => admin.post(`/drafts/${draft.id}/rewrite-copied`),
    onSuccess: () => {
      toast('ה-AI מנסח מחדש את הקטעים. הכתבה תתעדכן בעוד רגע.');
      onQueued();
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  if (!check.data) return null;
  const { level, ratio, passages } = check.data;
  const tone = level === 'ok' ? 'bg-ok-soft text-ok' : level === 'warn' ? 'bg-warn-soft text-warn' : 'bg-brand-soft text-brand-deep';
  const locked = draft.status === 'text_final' || draft.status === 'published' || draft.status === 'skipped';
  const aiBusy = !!draft.activeJob || draft.status === 'queued_ai' || draft.status === 'ai_processing';
  return (
    <div className={cx('rounded-lg px-3 py-2.5 text-sm', tone)}>
      <p className="font-bold">
        {level === 'ok' ? 'הנוסח שונה מהמקור' : level === 'warn' ? 'יש קטעים שחוזרים על נוסח המקור' : 'הנוסח קרוב מאוד למקור'} ({Math.round(ratio * 100)}% חזרה)
      </p>
      {passages.length > 0 && (
        <ul className="mt-1.5 list-disc space-y-1 pr-4 text-xs">
          {passages.slice(0, 3).map((p) => (
            <li key={p}>
              <q>{p}</q>
            </li>
          ))}
        </ul>
      )}
      {level !== 'ok' && <p className="mt-1.5 text-xs">עובדות מותר להביא; ניסוח של אחרים מוגן. ההמלצה: לנסח מחדש את הקטעים האלה, בלי לשנות את העובדות.</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {level !== 'ok' && (
          <Button size="sm" variant="dark" busy={fix.isPending || aiBusy} disabled={locked} onClick={() => fix.mutate()}>
            קבלת ההמלצה: ה-AI ינסח מחדש
          </Button>
        )}
        {onShowSource && (
          <Button size="sm" variant="ghost" onClick={onShowSource}>
            השוואה מול כתבת המקור המלאה
          </Button>
        )}
      </div>
      {level !== 'ok' && locked && draft.status !== 'published' && <p className="mt-1.5 text-xs">הטקסט נעול. פתחו אותו לעריכה כדי לקבל את ההמלצה.</p>}
    </div>
  );
}

// --- Publishing settings: placement, category, tags, byline -----------------------
export function MetaPanel({ draft, focus, onSaved, onShowSource }: { draft: DraftDetail; focus?: boolean; onSaved(): void; onShowSource(): void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const authors = useQuery({ queryKey: ['authors'], queryFn: () => admin.get<AuthorDto[]>('/authors'), staleTime: 5 * 60_000 });
  const [tag, setTag] = useState('');
  const locked = draft.status === 'published';
  const category = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    if (focus) category.current?.focus();
  }, [focus]);
  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) => admin.patch(`/drafts/${draft.id}`, patch),
    onSuccess: onSaved,
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  const replan = useMutation({
    mutationFn: () => admin.post(draft.magazine ? `/magazines/${draft.magazine.id}/desk-plan` : `/drafts/${draft.id}/desk-plan`),
    onSuccess: () => {
      toast('העורך הראשי מסדר שוב. הבחירות שלו יופיעו כאן בעוד רגע.');
      setTimeout(() => void qc.invalidateQueries({ queryKey: ['draft', draft.id] }), 6000);
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  const addTag = () => {
    const t = tag.trim();
    if (!t || draft.tags.includes(t)) return setTag('');
    save.mutate({ tags: [...draft.tags, t] });
    setTag('');
  };
  const plan = draft.deskPlan;

  return (
    <div className="space-y-6 p-5">
      {plan ? (
        <div className="rounded-lg bg-info-soft px-3 py-2.5 text-sm text-info">
          <p>
            <span className="font-bold">★ העורך הראשי בחר:</span> {PLACEMENT[plan.placement]}
            {plan.ticker ? ' · בפס המבזקים' : ''}
            {plan.category ? ` · מדור ${categoryName(plan.category)}` : ''}
          </p>
          <p className="mt-0.5 text-ink-2">{plan.reason}</p>
          <p className="mt-1 text-xs">{plan.changed.length ? 'שיניתם חלק מהבחירה; הבחירה שלכם קובעת.' : 'לא שיניתם כלום, אז הבחירה מאושרת. אפשר לשנות כאן.'}</p>
        </div>
      ) : (
        !locked &&
        draft.status !== 'queued_ai' &&
        draft.status !== 'ai_processing' && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-stone px-3 py-2.5 text-sm text-ink-2">
            העורך הראשי עוד לא סידר את הכתבה באתר.
            <Button size="sm" busy={replan.isPending} onClick={() => replan.mutate()}>
              לבקש ממנו עכשיו
            </Button>
          </div>
        )
      )}
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
                className={cx('relative rounded-lg px-3 py-2.5 text-sm font-bold ring-1', draft.placement === p ? 'bg-ink text-white ring-ink' : 'bg-white ring-line hover:bg-stone')}
              >
                {PLACEMENT[p]}
                {plan?.placement === p && <span className="absolute -top-2 left-1.5 rounded bg-info px-1 text-[10px] text-white">★ העורך הראשי</span>}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-muted">ראשית: אחת מ-7 הכתבות בראש האתר. חמות: אחת מ-14 בפס החם. בכל מקרה הכתבה מופיעה גם בקטגוריה שלה.</p>
          <label className="mt-3 flex items-center gap-3 rounded-lg bg-stone px-3 py-2.5 text-sm font-semibold">
            <input type="checkbox" checked={draft.ticker} onChange={(e) => save.mutate({ ticker: e.target.checked })} className="size-4" />
            בפס המבזקים בראש האתר
            {plan?.ticker && <span className="text-xs font-normal text-info">(★ העורך הראשי)</span>}
            <span className="mr-auto text-xs font-normal text-muted">עד 12 מבזקים; החדש דוחק את הישן</span>
          </label>
        </div>

        <Field
          label="קטגוריה"
          htmlFor="category"
          hint={plan?.category ? `העורך הראשי בחר: ${categoryName(plan.category)}` : draft.suggestedCategory ? `ה-AI הציע: ${categoryName(draft.suggestedCategory)}` : undefined}
        >
          <select ref={category} id="category" value={draft.category ?? ''} onChange={(e) => save.mutate({ category: e.target.value || null })} className={cx(inputClass, focus && FOCUS_RING)}>
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

        <DisclosureField key={draft.id} draft={draft} onSave={(disclosure) => save.mutate({ disclosure })} />

        <label className="flex items-center gap-3 rounded-lg bg-stone px-3 py-2.5 text-sm font-semibold">
          <input type="checkbox" checked={draft.sendPush} onChange={(e) => save.mutate({ sendPush: e.target.checked })} className="size-4" />
          לשלוח התראת פוש באפליקציה עם הפרסום (מבזק)
        </label>

        {draft.original && <CopyCheck draft={draft} onQueued={onSaved} onShowSource={onShowSource} />}

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
