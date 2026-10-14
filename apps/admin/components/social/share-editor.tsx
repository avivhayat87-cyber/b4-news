'use client';
// One article on the social page: the branded post and story as they will go
// out (rendered by the server), the frame, the texts, the background image,
// the AI, the text per network, and what was already posted.
import { SHARE_FORMATS, SHARE_LIMITS, SHARE_TEMPLATES, type MediaDto, type ShareDto, type ShareFormat, type ShareTargetDto, type ShareTemplate } from '@b4/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { admin, errorMessage } from '@/lib/api';
import { PLATFORM, SHARE_FORMAT, SHARE_TEMPLATE, SOCIAL_POST_STATUS as STATUS, formatDateTime } from '@/lib/labels';
import { UploadButton } from '../image-upload';
import { ReelPanel } from './reel-panel';
import { Badge, Button, Field, Loading, Spinner, cx, inputClass, useToast } from '../ui';

type Form = { template: ShareTemplate; kicker: string; headline: string; hook: string; caption: string; hashtags: string; formats: ShareFormat[] };

const fromShare = (s: ShareDto): Form => ({
  template: s.template,
  kicker: s.kicker,
  headline: s.headline,
  hook: s.hook,
  caption: s.caption,
  hashtags: s.hashtags.map((h) => `#${h}`).join(' '),
  formats: s.formats,
});
const parseTags = (text: string) =>
  text
    .split(/[\s,]+/)
    .map((t) => t.replace(/^#+/, '').trim())
    .filter(Boolean)
    .slice(0, SHARE_LIMITS.hashtags);

function Counter({ value, max }: { value: string; max: number }) {
  return <span className={cx('text-xs tabular-nums', value.length > max ? 'font-bold text-brand' : 'text-muted')}>{value.length}/{max}</span>;
}

/** Thumbnails of the four frames; the chosen one is outlined. */
export function TemplatePicker({ value, onChange, disabled }: { value: ShareTemplate; onChange(t: ShareTemplate): void; disabled?: boolean }) {
  const swatch: Record<ShareTemplate, string> = {
    headline: 'bg-gradient-to-b from-stone-400 via-night to-night',
    breaking: 'bg-[linear-gradient(to_bottom,var(--color-brand)_0_18%,#55555c_18%_62%,white_62%)]',
    quote: 'bg-[linear-gradient(to_bottom,#55555c_0_40%,var(--color-night)_40%)]',
    explainer: 'bg-[linear-gradient(to_bottom,var(--color-stone)_0_10%,#55555c_10%_52%,var(--color-stone)_52%_88%,var(--color-brand)_88%)]',
  };
  return (
    <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="מסגרת עיצוב">
      {SHARE_TEMPLATES.map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={value === t}
          disabled={disabled}
          onClick={() => onChange(t)}
          title={SHARE_TEMPLATE[t].use}
          className={cx('rounded-xl p-1.5 text-center ring-1 transition', value === t ? 'bg-brand-soft ring-2 ring-brand' : 'ring-line hover:ring-ink')}
        >
          <span aria-hidden className={cx('mx-auto block aspect-[4/5] w-full rounded-md', swatch[t])} />
          <span className="mt-1 block text-xs font-bold">{SHARE_TEMPLATE[t].name}</span>
        </button>
      ))}
    </div>
  );
}

export function Preview({ src, ratio, label, busy }: { src: string | null; ratio: string; label: string; busy: boolean }) {
  return (
    <figure className="min-w-0">
      <div className={cx('relative overflow-hidden rounded-xl bg-stone shadow-md ring-1 ring-line', ratio)}>
        {src ? (
          <a href={src} target="_blank" rel="noopener noreferrer" title="פתיחה בגודל מלא">
            {/* eslint-disable-next-line @next/next/no-img-element -- API-rendered design */}
            <img src={src} alt={`תצוגה מקדימה: ${label}`} className="h-full w-full object-cover" />
          </a>
        ) : (
          <span className="absolute inset-0 grid place-items-center p-3 text-center text-sm text-muted">העיצוב יופיע אחרי שיהיה טקסט</span>
        )}
        {busy && (
          <span className="absolute inset-0 grid place-items-center bg-white/60">
            <Spinner />
          </span>
        )}
      </div>
      <figcaption className="mt-1.5 flex items-center justify-between text-xs text-muted">
        <span className="font-bold text-ink-2">{label}</span>
        {src && (
          <a href={src} download className="font-semibold text-brand hover:underline">
            הורדה
          </a>
        )}
      </figcaption>
    </figure>
  );
}

export function ShareEditor({ articleId, onPublish }: { articleId: number; onPublish(): void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const key = ['social-share', articleId];
  const share = useQuery({ queryKey: key, queryFn: () => admin.get<ShareDto>(`/social/articles/${articleId}`), refetchInterval: (q) => (q.state.data?.activeJob ? 2000 : false) });
  const targets = useQuery({ queryKey: ['social-targets'], queryFn: () => admin.get<ShareTargetDto[]>('/social/targets') });
  const [form, setForm] = useState<Form | null>(null);
  const [dirty, setDirty] = useState(false);
  const [note, setNote] = useState('');
  const [imageMediaId, setImageMediaId] = useState<string | null | undefined>(undefined);
  const [tab, setTab] = useState<string | null>(null);

  const data = share.data;
  useEffect(() => {
    if (data && !dirty) {
      setForm(fromShare(data));
      setImageMediaId(undefined);
    }
  }, [data, dirty]);
  useEffect(() => {
    setDirty(false);
    setNote('');
    setTab(null);
  }, [articleId]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ['social-list'] });
  };
  const onError = (e: unknown) => toast(errorMessage(e), 'danger');
  const generate = useMutation({
    mutationFn: (instruction?: string) => admin.post('/social/generate', { articleIds: [articleId], instruction }),
    onSuccess: () => {
      setDirty(false);
      setNote('');
      refresh();
    },
    onError,
  });
  const save = useMutation({
    mutationFn: (f: Form) =>
      admin.put<ShareDto>(`/social/articles/${articleId}`, {
        version: data!.version,
        template: f.template,
        kicker: f.kicker,
        headline: f.headline,
        hook: f.hook,
        caption: f.caption,
        hashtags: parseTags(f.hashtags),
        formats: f.formats,
        ...(imageMediaId !== undefined ? { imageMediaId } : {}),
      }),
    onSuccess: (next) => {
      qc.setQueryData(key, next);
      setDirty(false);
      void qc.invalidateQueries({ queryKey: ['social-list'] });
      toast('נשמר. העיצוב עודכן.');
    },
    onError,
  });

  const markPosted = useMutation({
    mutationFn: (body: { accountId: string; format: ShareFormat }) => admin.post(`/social/articles/${articleId}/posted`, body),
    onSuccess: refresh,
    onError,
  });

  if (share.isPending || !form) return <Loading />;
  if (share.isError) return <p className="p-6 text-brand">{errorMessage(share.error)}</p>;
  const s = share.data;
  const busy = Boolean(s.activeJob) || generate.isPending;
  const writing = busy && s.activeJob?.kind === 'social.kit';
  const set = (patch: Partial<Form>) => {
    setForm({ ...form, ...patch });
    setDirty(true);
  };
  const tooLong = form.kicker.length > SHARE_LIMITS.kicker || form.headline.length > SHARE_LIMITS.headline || form.hook.length > SHARE_LIMITS.hook || form.caption.length > SHARE_LIMITS.caption;
  const hasKit = s.version > 0;
  const accounts = targets.data ?? [];
  const activeTab = tab ?? accounts[0]?.id ?? null;
  const background = imageMediaId === null ? null : imageMediaId ? 'uploaded' : s.image ? 'chosen' : 'article';

  return (
    <div className="space-y-5">
      <header>
        <p className="text-xs font-bold text-brand">{s.article.category}</p>
        <h2 className="mt-0.5 text-lg font-extrabold leading-snug">{s.article.title}</h2>
        <a href={s.article.url} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-ink-2 underline-offset-2 hover:underline">
          לכתבה באתר ↗
        </a>
      </header>

      {!hasKit && !busy && !dirty ? (
        <div className="rounded-xl bg-stone p-5">
          <p className="font-display text-lg font-extrabold">עוד אין פוסט לכתבה הזו</p>
          <p className="mt-1 text-[15px] text-ink-2">ה-AI יבחר מסגרת עיצוב, יכתוב כותרת לתמונה, משפט פתיחה, טקסט לפוסט עם שאלה לתגובות, והאשטגים. אחר כך אפשר לערוך הכול.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => generate.mutate(undefined)}>
              הכנת פוסט וסטורי עם AI
            </Button>
            <Button variant="ghost" onClick={() => set({ headline: s.article.title.slice(0, SHARE_LIMITS.headline), hook: s.article.excerpt.slice(0, SHARE_LIMITS.hook), kicker: s.article.category.slice(0, SHARE_LIMITS.kicker) })}>
              כתיבה ידנית
            </Button>
          </div>
        </div>
      ) : (
        <>
          {writing && (
            <p className="flex items-center gap-2 text-sm font-semibold text-info" role="status">
              <Spinner small /> ה-AI כותב ומעצב…
            </p>
          )}

          <fieldset className="flex flex-wrap items-center gap-2">
            <legend className="sr-only">מה ליצור לכתבה הזו</legend>
            <span className="text-sm font-bold text-ink-2">מה ליצור:</span>
            {SHARE_FORMATS.map((f) => (
              <label key={f} className={cx('flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ring-1', form.formats.includes(f) ? 'bg-brand-soft text-brand-deep ring-brand' : 'ring-line')}>
                <input
                  type="checkbox"
                  checked={form.formats.includes(f)}
                  disabled={busy}
                  onChange={() => {
                    const next = form.formats.includes(f) ? form.formats.filter((x) => x !== f) : [...form.formats, f];
                    if (next.length) set({ formats: next });
                  }}
                />
                {SHARE_FORMAT[f].name}
              </label>
            ))}
            <span className="text-xs text-muted">רק מה שמסומן נוצר. ריל נבנה שלב אחרי שלב, ושום שלב לא רץ בלי האישור שלך.</span>
          </fieldset>

          {(form.formats.includes('feed') || form.formats.includes('story')) && (
            <div className={cx('grid items-start gap-3', form.formats.includes('feed') && form.formats.includes('story') ? 'grid-cols-[1.35fr_1fr]' : 'grid-cols-[minmax(0,1fr)] max-w-xs')}>
              {form.formats.includes('feed') && <Preview src={s.rendered.feed} ratio="aspect-[4/5]" label="פוסט 4:5" busy={busy || save.isPending} />}
              {form.formats.includes('story') && <Preview src={s.rendered.story} ratio="aspect-[9/16]" label="סטורי 9:16" busy={busy || save.isPending} />}
            </div>
          )}
          {dirty && <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm font-semibold text-warn">יש שינויים שלא נשמרו. &quot;שמירה ועדכון העיצוב&quot; מצייר את התמונות מחדש.</p>}
          {form.formats.includes('reel') && hasKit && <ReelPanel share={s} textDirty={dirty} />}

          <section>
            <p className="mb-2 text-sm font-bold text-ink-2">מסגרת עיצוב</p>
            <TemplatePicker value={form.template} onChange={(t) => set({ template: t })} disabled={busy} />
            <p className="mt-1.5 text-xs text-muted">{SHARE_TEMPLATE[form.template].use}</p>
          </section>

          <div className="grid grid-cols-[1fr_2fr] gap-3">
            <Field label="תווית" htmlFor="sh-kicker" hint={<Counter value={form.kicker} max={SHARE_LIMITS.kicker} />}>
              <input id="sh-kicker" value={form.kicker} onChange={(e) => set({ kicker: e.target.value })} disabled={busy} className={inputClass} placeholder="נדל״ן / מבזק / מדריך" />
            </Field>
            <Field label="האשטגים" htmlFor="sh-tags" hint="עד 5, מופרדים ברווח">
              <input id="sh-tags" value={form.hashtags} onChange={(e) => set({ hashtags: e.target.value })} disabled={busy} className={inputClass} dir="auto" />
            </Field>
          </div>
          <Field label="כותרת על התמונה" htmlFor="sh-headline" hint={<Counter value={form.headline} max={SHARE_LIMITS.headline} />}>
            <textarea id="sh-headline" rows={2} value={form.headline} onChange={(e) => set({ headline: e.target.value })} disabled={busy} className={cx(inputClass, 'font-bold')} />
          </Field>
          <Field label="משפט פתיחה (על התמונה ובתחילת הפוסט)" htmlFor="sh-hook" hint={<Counter value={form.hook} max={SHARE_LIMITS.hook} />}>
            <textarea id="sh-hook" rows={2} value={form.hook} onChange={(e) => set({ hook: e.target.value })} disabled={busy} className={inputClass} />
          </Field>
          <Field label="טקסט הפוסט (הקשר + שאלה לתגובות)" htmlFor="sh-caption" hint={<Counter value={form.caption} max={SHARE_LIMITS.caption} />}>
            <textarea id="sh-caption" rows={3} value={form.caption} onChange={(e) => set({ caption: e.target.value })} disabled={busy} className={inputClass} />
          </Field>

          <section className="flex flex-wrap items-center gap-2 rounded-lg bg-stone px-3 py-2.5 text-sm">
            <span className="font-bold text-ink-2">תמונת רקע:</span>
            <span className="text-ink-2">{background === 'article' || background === null ? 'התמונה הראשית של הכתבה' : background === 'uploaded' ? 'תמונה חדשה (תישמר בשמירה)' : 'תמונה שהועלתה'}</span>
            <span className="mr-auto flex gap-1.5">
              <UploadButton
                variant="ghost"
                label="החלפה"
                onUploaded={(m: MediaDto) => {
                  setImageMediaId(m.id);
                  setDirty(true);
                }}
              />
              {(s.image || imageMediaId) && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setImageMediaId(null);
                    setDirty(true);
                  }}
                >
                  חזרה לתמונת הכתבה
                </Button>
              )}
            </span>
          </section>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="dark" busy={save.isPending} disabled={!dirty || busy || tooLong || !form.headline.trim()} onClick={() => save.mutate(form)}>
              שמירה ועדכון העיצוב
            </Button>
            {dirty && (
              <Button variant="ghost" onClick={() => setDirty(false)}>
                ביטול השינויים
              </Button>
            )}
            <Button variant="primary" className="mr-auto" disabled={!hasKit || dirty || busy} onClick={onPublish}>
              פרסום ברשתות…
            </Button>
          </div>

          <section className="rounded-lg p-3 ring-1 ring-line">
            <Field label="ניסוח מחדש עם AI" htmlFor="sh-note" hint="ה-AI כותב מחדש את הטקסט ושומר על מסגרת העיצוב שבחרתם.">
              <textarea id="sh-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder='למשל: "כותרת עם המספר בהתחלה", "שאלה אישית יותר בסוף", "קצר יותר"' className={inputClass} />
            </Field>
            <Button size="sm" className="mt-2" busy={generate.isPending} disabled={busy} onClick={() => generate.mutate(note.trim() || undefined)}>
              {note.trim() ? 'ניסוח לפי ההערה' : 'ניסוח חדש'}
            </Button>
          </section>

          {hasKit && accounts.length > 0 && (
            <section>
              <p className="mb-2 text-sm font-bold text-ink-2">הטקסט שיעלה, לפי רשת</p>
              <div className="flex flex-wrap gap-1" role="tablist">
                {accounts.map((a) => (
                  <button key={a.id} type="button" role="tab" aria-selected={activeTab === a.id} onClick={() => setTab(a.id)} className={cx('rounded-full px-3 py-1 text-xs font-bold', activeTab === a.id ? 'bg-ink text-white' : 'bg-stone text-ink-2')}>
                    {PLATFORM[a.platform]}
                  </button>
                ))}
              </div>
              {activeTab && s.texts[activeTab] && (
                <div className="mt-2 rounded-lg bg-stone p-3">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed" dir="auto">
                    {s.texts[activeTab]}
                  </p>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="mt-2"
                    onClick={() => navigator.clipboard.writeText(s.texts[activeTab]!).then(() => toast('הטקסט הועתק'), () => toast('ההעתקה נכשלה', 'danger'))}
                  >
                    העתקת הטקסט
                  </Button>
                  {accounts.find((a) => a.id === activeTab)?.linkInFirstComment && <p className="mt-1 text-xs text-muted">הקישור לכתבה עולה בתגובה הראשונה, לא בגוף הפוסט.</p>}
                </div>
              )}
            </section>
          )}

          {s.posts.length > 0 && (
            <section>
              <p className="mb-2 text-sm font-bold text-ink-2">מה כבר יצא</p>
              <ul className="space-y-1.5">
                {s.posts.map((p) => (
                  <li key={`${p.accountId}-${p.format}`} className="flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-sm ring-1 ring-line">
                    <span className="font-semibold">{PLATFORM[p.platform]}</span>
                    <span className="text-muted">{p.format === 'message' ? 'הודעה' : SHARE_FORMAT[p.format].name}</span>
                    <Badge tone={STATUS[p.status]?.tone}>{STATUS[p.status]?.label ?? p.status}</Badge>
                    {p.postedAt && <span className="text-xs text-muted">{formatDateTime(p.postedAt)}</span>}
                    {(p.status === 'skipped' || p.status === 'failed') && p.format !== 'message' && (
                      <span className="mr-auto flex items-center gap-3">
                        {(p.format === 'reel' ? s.reel.videoUrl : s.rendered[p.format]) && (
                          <a href={(p.format === 'reel' ? s.reel.videoUrl : s.rendered[p.format])!} download className="text-xs font-semibold text-brand hover:underline">
                            {p.format === 'reel' ? 'הורדת הסרטון' : 'הורדת התמונה'}
                          </a>
                        )}
                        <Button size="sm" variant="ghost" busy={markPosted.isPending} onClick={() => markPosted.mutate({ accountId: p.accountId, format: p.format as ShareFormat })}>
                          ✓ פרסמתי ידנית
                        </Button>
                      </span>
                    )}
                    {p.lastError && <span className="w-full text-xs text-muted">{p.lastError}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
