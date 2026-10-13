'use client';
// The reel of one article, in steps the editor approves one by one:
//   1. the AI writes two prompts in Hebrew (the picture, the video), the editor edits them;
//   2. the picture and its branded cover;
//   3. the video, made from the clean picture.
// A picture or a video is made only on the editor's click, and only an approved video is
// published. Music: Instagram's API can't add songs from its library; that is done in the app.
import { REEL_DURATIONS, REEL_MOTIONS, REEL_RESOLUTIONS, type ReelSettings, type ShareDto, VIDEO_MODELS, VIDEO_PRICE_PER_SECOND } from '@b4/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';
import { admin, errorMessage } from '@/lib/api';
import { REEL_MOTION, REEL_STAGE, VIDEO_MODEL } from '@/lib/labels';
import { Badge, Button, Field, Spinner, cx, inputClass, useToast } from '../ui';

const usd = (n: number) => `$${n.toFixed(2)}`;

const RUNNING: Record<string, string> = {
  'social.reel_prompts': 'ה-AI כותב את ההנחיות…',
  'social.reel_image': 'יוצר את התמונה…',
  'social.reel_video': 'יוצר את הסרטון (דקה-שתיים)…',
};

function estimate(settings: ReelSettings, defaultModel: string): number | null {
  const price = VIDEO_PRICE_PER_SECOND[settings.model || defaultModel]?.[settings.resolution];
  return price === undefined ? null : price * settings.durationSeconds;
}

function Step({ n, title, active, done, children }: { n: number; title: string; active: boolean; done: boolean; children: ReactNode }) {
  return (
    <li className={cx('rounded-xl p-4 ring-1', active ? 'bg-white ring-ink' : 'bg-white/60 ring-line')}>
      <div className="mb-2 flex items-center gap-2">
        <span className={cx('grid size-6 place-items-center rounded-full text-xs font-extrabold', done ? 'bg-ok text-white' : active ? 'bg-ink text-white' : 'bg-stone text-muted')}>{done ? '✓' : n}</span>
        <h4 className="font-extrabold">{title}</h4>
      </div>
      {children}
    </li>
  );
}

export function ReelPanel({ share, textDirty }: { share: ShareDto; textDirty: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { plan } = share.reel;
  const stage = plan?.stage ?? null;
  const running = share.activeJob && RUNNING[share.activeJob.kind] ? share.activeJob.kind : null;

  const [prompts, setPrompts] = useState({ imagePrompt: plan?.imagePrompt ?? '', videoPrompt: plan?.videoPrompt ?? '' });
  const [promptsDirty, setPromptsDirty] = useState(false);
  const [direction, setDirection] = useState('');
  const [settings, setSettings] = useState<ReelSettings>(share.reel.settings);
  const [settingsDirty, setSettingsDirty] = useState(false);
  useEffect(() => {
    if (!promptsDirty) setPrompts({ imagePrompt: plan?.imagePrompt ?? '', videoPrompt: plan?.videoPrompt ?? '' });
    if (!settingsDirty) setSettings(share.reel.settings);
  }, [share, plan, promptsDirty, settingsDirty]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['social-share', share.articleId] });
    void qc.invalidateQueries({ queryKey: ['social-list'] });
  };
  const onError = (e: unknown) => toast(errorMessage(e), 'danger');
  const base = `/social/articles/${share.articleId}/reel`;
  // Unsaved edits go first, so each step uses exactly what the editor sees.
  const saveEdits = async () => {
    if (promptsDirty) await admin.put(`${base}/prompts`, prompts);
    if (settingsDirty) {
      await admin.put(`/social/articles/${share.articleId}`, {
        version: share.version,
        template: share.template,
        kicker: share.kicker,
        headline: share.headline,
        hook: share.hook,
        caption: share.caption,
        hashtags: share.hashtags,
        reelSettings: settings,
      });
    }
    setPromptsDirty(false);
    setSettingsDirty(false);
  };
  const runStep = async (path: string, body?: unknown) => {
    await saveEdits();
    return admin.post(`${base}/${path}`, body);
  };
  const doneWith = (message: string) => () => {
    refresh();
    toast(message);
  };
  const writePrompts = useMutation({
    mutationFn: () => runStep('prompts', { instruction: direction.trim() || undefined }),
    onSuccess: doneWith('ה-AI כותב הנחיות. הן יופיעו כאן לעריכה ולאישור.'),
    onError,
  });
  const makeImage = useMutation({ mutationFn: () => runStep('image'), onSuccess: doneWith('התמונה בהכנה.'), onError });
  const makeVideo = useMutation({ mutationFn: () => runStep('video'), onSuccess: doneWith('הסרטון בהכנה. זה לוקח דקה-שתיים.'), onError });
  const approve = useMutation({ mutationFn: () => runStep('approve'), onSuccess: doneWith('הריל אושר ומוכן לפרסום.'), onError });
  const save = useMutation({ mutationFn: saveEdits, onSuccess: doneWith('נשמר.'), onError });
  const editPrompt = (patch: Partial<typeof prompts>) => {
    setPrompts({ ...prompts, ...patch });
    setPromptsDirty(true);
  };

  const busy = Boolean(running) || writePrompts.isPending || makeImage.isPending || makeVideo.isPending || approve.isPending;
  const cost = estimate(settings, share.reel.model);
  const hasPicture = Boolean(share.reel.image) && stage !== 'prompts';
  const setSetting = (patch: Partial<ReelSettings>) => {
    setSettings({ ...settings, ...patch });
    setSettingsDirty(true);
  };

  return (
    <section className="space-y-4 rounded-xl bg-canvas p-4 ring-1 ring-line" aria-label="ריל">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-extrabold">ריל</h3>
        {stage ? <Badge tone={REEL_STAGE[stage].tone}>{REEL_STAGE[stage].label}</Badge> : <Badge tone="info">כל שלב רק באישור שלך</Badge>}
      </div>

      <div className="grid grid-cols-[minmax(0,180px)_1fr] gap-4">
        {/* Preview: the video, else the cover, else the picture */}
        <div className="relative aspect-[9/16] self-start overflow-hidden rounded-xl bg-night shadow-md">
          {share.reel.videoUrl ? (
            <video key={share.reel.videoUrl} src={share.reel.videoUrl} poster={share.reel.posterUrl ?? undefined} controls loop muted playsInline className="h-full w-full object-cover" />
          ) : share.reel.posterUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- API-rendered cover
            <img src={share.reel.posterUrl} alt="עטיפת הריל" className="h-full w-full object-cover" />
          ) : (
            <span className="absolute inset-0 grid place-items-center p-3 text-center text-sm text-white/70">התמונה והסרטון יופיעו כאן</span>
          )}
          {running && (
            <span className="absolute inset-0 grid place-items-center bg-black/55 p-3 text-center text-sm font-semibold text-white">
              <span className="flex flex-col items-center gap-2">
                <Spinner />
                {RUNNING[running]}
              </span>
            </span>
          )}
        </div>

        <ol className="min-w-0 space-y-3">
          {share.reel.error && !running && <p className="rounded-lg bg-brand-soft px-3 py-2 text-sm font-semibold text-brand-deep">{share.reel.error}</p>}

          <Step n={1} title="הנחיות לתמונה ולסרטון" active={!stage || stage === 'prompts'} done={Boolean(stage && stage !== 'prompts')}>
            {!plan ? (
              <>
                <p className="mb-2 text-sm text-ink-2">ה-AI קורא את הכתבה ומסתכל על התמונות שלה, וכותב בעברית מה רואים בתמונה ומה קורה בסרטון. בלי עלות של תמונה או סרטון.</p>
                <Button variant="dark" busy={writePrompts.isPending} disabled={busy || textDirty} onClick={() => writePrompts.mutate()}>
                  כתיבת הנחיות
                </Button>
              </>
            ) : (
              <div className="space-y-3">
                <Field label="מה רואים בתמונה" htmlFor="reel-image-prompt">
                  <textarea
                    id="reel-image-prompt"
                    rows={3}
                    value={prompts.imagePrompt}
                    disabled={busy}
                    onChange={(e) => editPrompt({ imagePrompt: e.target.value })}
                    className={inputClass}
                  />
                </Field>
                <Field label="מה קורה בסרטון (תנועה, אור, אווירה)" htmlFor="reel-video-prompt">
                  <textarea
                    id="reel-video-prompt"
                    rows={3}
                    value={prompts.videoPrompt}
                    disabled={busy}
                    onChange={(e) => editPrompt({ videoPrompt: e.target.value })}
                    className={inputClass}
                  />
                </Field>
                <div className="flex flex-wrap items-center gap-2">
                  <input value={direction} onChange={(e) => setDirection(e.target.value)} placeholder="כיוון ל-AI להנחיות חדשות (לא חובה)" aria-label="כיוון ל-AI" disabled={busy} className={cx(inputClass, 'max-w-xs py-1.5')} />
                  <Button size="sm" variant="ghost" busy={writePrompts.isPending} disabled={busy} onClick={() => writePrompts.mutate()}>
                    הנחיות חדשות מה-AI
                  </Button>
                  {promptsDirty && (
                    <Button size="sm" busy={save.isPending} disabled={busy} onClick={() => save.mutate()}>
                      שמירת ההנחיות
                    </Button>
                  )}
                </div>
              </div>
            )}
          </Step>

          <Step n={2} title="תמונה" active={stage === 'prompts' || stage === 'image'} done={stage === 'video' || stage === 'approved'}>
            {hasPicture && <p className="mb-2 text-sm text-ink-2">בתצוגה: העטיפה של הריל, עם הכותרת על התמונה החדשה. הסרטון ייווצר מהתמונה עצמה, בלי הטקסט.</p>}
            <Button
              variant={stage === 'prompts' ? 'dark' : 'secondary'}
              busy={makeImage.isPending}
              disabled={busy || !plan || textDirty}
              onClick={() => confirm(hasPicture ? 'ליצור תמונה חדשה? הסרטון הקיים יוחלף.' : 'לאשר את ההנחיות וליצור את התמונה?') && makeImage.mutate()}
            >
              {hasPicture ? 'תמונה חדשה' : 'אישור ההנחיות ויצירת תמונה'}
            </Button>
          </Step>

          <Step n={3} title="סרטון" active={stage === 'image' || stage === 'video'} done={stage === 'approved'}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="מודל וידאו" htmlFor="reel-model">
                <select id="reel-model" value={settings.model ?? ''} disabled={busy} onChange={(e) => setSetting({ model: e.target.value || undefined })} className={inputClass}>
                  <option value="">ברירת המחדל ({VIDEO_MODEL[share.reel.model] ?? share.reel.model})</option>
                  {VIDEO_MODELS.map((m) => (
                    <option key={m} value={m}>
                      {VIDEO_MODEL[m] ?? m}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="תנועת מצלמה" htmlFor="reel-motion">
                <select id="reel-motion" value={settings.motion} disabled={busy} onChange={(e) => setSetting({ motion: e.target.value as ReelSettings['motion'] })} className={inputClass}>
                  {REEL_MOTIONS.map((m) => (
                    <option key={m} value={m}>
                      {REEL_MOTION[m]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="אורך" htmlFor="reel-duration">
                <select id="reel-duration" value={settings.durationSeconds} disabled={busy} onChange={(e) => setSetting({ durationSeconds: Number(e.target.value) as ReelSettings['durationSeconds'] })} className={inputClass}>
                  {REEL_DURATIONS.map((d) => (
                    <option key={d} value={d}>
                      {d} שניות
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="איכות" htmlFor="reel-resolution">
                <select id="reel-resolution" value={settings.resolution} disabled={busy} onChange={(e) => setSetting({ resolution: e.target.value as ReelSettings['resolution'] })} className={inputClass}>
                  {REEL_RESOLUTIONS.map((r) => (
                    <option key={r} value={r}>
                      {r === '1080p' ? '1080p (מומלץ לרילס)' : r}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-sm text-ink-2">
                עלות משוערת לסרטון: <b>{cost === null ? 'לא ידועה' : usd(cost)}</b>
              </span>
              <Button
                variant={stage === 'image' ? 'dark' : 'secondary'}
                className="mr-auto"
                busy={makeVideo.isPending}
                disabled={busy || !hasPicture}
                onClick={() =>
                  confirm(`${stage === 'image' ? 'לאשר את התמונה וליצור את הסרטון?' : 'ליצור סרטון חדש לפי ההנחיה?'}\nעלות משוערת אצל Google: ${cost === null ? 'לא ידועה' : `כ-${usd(cost)}`}.`) &&
                  makeVideo.mutate()
                }
              >
                {stage === 'video' || stage === 'approved' ? 'סרטון חדש' : 'אישור התמונה ויצירת סרטון'}
              </Button>
            </div>
          </Step>

          <Step n={4} title="אישור לפרסום" active={stage === 'video'} done={stage === 'approved'}>
            {stage === 'approved' ? (
              <p className="text-sm font-semibold text-ok">הסרטון אושר. אפשר לפרסם את הריל בפייסבוק ובאינסטגרם.</p>
            ) : (
              <Button variant="primary" busy={approve.isPending} disabled={busy || stage !== 'video'} onClick={() => approve.mutate()}>
                אישור הסרטון לפרסום
              </Button>
            )}
            <p className="mt-2 text-xs text-muted">מוזיקה: אינסטגרם לא מאפשר להוסיף שירים מהספרייה שלו דרך מערכות חיצוניות. אפשר להוסיף שיר באפליקציה אחרי הפרסום, או לפרסם את הריל ידנית.</p>
          </Step>
        </ol>
      </div>
      {textDirty && <p className="text-xs text-warn">יש שינויים שלא נשמרו בטקסט. שמרו אותם קודם, כי הכותרת נכנסת לעטיפה של הריל.</p>}
    </section>
  );
}
