'use client';
// A campaign's ads. A banner comes ready from the advertiser (uploaded in its exact size), or is set
// here from words in the brand fonts, in every size at once; an article-style ad has a picture
// (uploaded, or drawn by the image model from a description), a headline, a line and a button.
// Before it runs, the ads agent can check it; a changed ad is checked again.
import { AD_SLOT_FORMATS, BANNER_THEMES, adSize, type AdComposeDto, type AdFormat, type AdImageDto, type AdTaskDto, type BannerTheme, type CampaignDto, type CreativeDto, type CreativeInput } from '@b4/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { admin, errorMessage } from '@/lib/api';
import { AD_FORMAT, AD_VERDICT, BANNER_THEME, ctr } from '@/lib/labels';
import { Badge, Button, Card, Field, cx, inputClass, useToast } from '../ui';
import { AdPreview } from './ad-preview';
import { useAdTask } from './use-ad-task';

type Picture = { key: string; url: string } | null;
type ImageUse = 'billboard-desktop' | 'billboard-mobile' | 'rectangle' | 'native' | 'photo';

/** Picks a file and uploads it for one use (each use has its own size rule on the server). */
function PickImage({ use, label, onPicked }: { use: ImageUse; label: string; onPicked(p: AdImageDto): void }) {
  const input = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return admin.upload<AdImageDto>(`/ads/images?use=${use}`, form);
    },
    onSuccess: onPicked,
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  return (
    <>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/avif" className="hidden" onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])} />
      <Button size="sm" busy={upload.isPending} onClick={() => input.current?.click()}>
        {label}
      </Button>
    </>
  );
}

function Editor({ campaign, creative, onDone }: { campaign: CampaignDto; creative: CreativeDto | null; onDone(): void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const formats = [...new Set(campaign.slots.flatMap((s) => AD_SLOT_FORMATS[s]))] as AdFormat[];
  const [format, setFormat] = useState<AdFormat>(creative?.format ?? formats[0] ?? 'native');
  const [text, setText] = useState({ headline: creative?.headline ?? '', body: creative?.body ?? '', cta: creative?.cta ?? (campaign.action === 'lead' ? 'השאירו פרטים' : 'לפרטים'), sponsor: creative?.sponsor ?? campaign.advertiserName, alt: creative?.alt ?? '' });
  const [desktop, setDesktop] = useState<Picture>(creative?.desktopImage ? { key: creative.desktopImage, url: creative.desktopUrl! } : null);
  const [mobile, setMobile] = useState<Picture>(creative?.mobileImage ? { key: creative.mobileImage, url: creative.mobileUrl! } : null);
  const [mode, setMode] = useState<'upload' | 'compose'>('compose');
  const [theme, setTheme] = useState<BannerTheme>('dark');
  const [color, setColor] = useState('#0F3D5E');
  const [photo, setPhoto] = useState<Picture>(null);
  const [idea, setIdea] = useState('');
  const draw = useAdTask();
  const banner = format !== 'native';

  const compose = useMutation({
    mutationFn: () => admin.post<AdComposeDto>('/ads/compose', { format, headline: text.headline, body: text.body, cta: text.cta, sponsor: text.sponsor || campaign.advertiserName, theme, color, photo: photo?.key ?? null }),
    onSuccess: (r) => {
      setDesktop({ key: r.desktop.key, url: r.desktop.url });
      setMobile(format === 'billboard' ? { key: r.mobile.key, url: r.mobile.url } : null);
      setText((t) => ({ ...t, alt: [t.headline, t.body].filter(Boolean).join('. ') }));
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  const startDraw = useMutation({
    mutationFn: () => admin.post<AdTaskDto>('/ads/agent/draw', { idea }),
    onSuccess: draw.track,
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  // The drawn picture becomes the card's picture.
  const drawn = draw.task?.status === 'done' ? draw.task.image : null;
  useEffect(() => {
    if (!drawn) return;
    setDesktop({ key: drawn.key, url: drawn.url });
    draw.clear();
  }, [drawn, draw]);

  const body: CreativeInput = {
    format,
    headline: text.headline,
    body: text.body,
    cta: text.cta,
    sponsor: text.sponsor,
    desktopImage: desktop?.key ?? null,
    mobileImage: format === 'billboard' ? (mobile?.key ?? null) : null,
    alt: text.alt,
    active: creative?.active ?? true,
  };
  const save = useMutation({
    mutationFn: () => (creative ? admin.put<CampaignDto>(`/ads/creatives/${creative.id}`, body) : admin.post<CampaignDto>(`/ads/campaigns/${campaign.id}/creatives`, body)),
    onSuccess: (c) => {
      qc.setQueryData(['ad-campaign', campaign.id], c);
      void qc.invalidateQueries({ queryKey: ['ads'] });
      toast('המודעה נשמרה.');
      onDone();
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  const textField = (k: keyof typeof text, label: string, max: number, hint?: string) => (
    <Field label={label} htmlFor={`cr-${k}`} hint={hint}>
      <input id={`cr-${k}`} maxLength={max} value={text[k]} onChange={(e) => setText({ ...text, [k]: e.target.value })} className={inputClass} />
    </Field>
  );

  return (
    <div className="space-y-5 rounded-xl bg-stone/60 p-4 ring-1 ring-line">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="סוג המודעה">
        {formats.map((f) => (
          <button key={f} type="button" role="radio" aria-checked={format === f} onClick={() => setFormat(f)} className={cx('rounded-lg px-3 py-2 text-right ring-1', format === f ? 'bg-ink text-white ring-ink' : 'bg-white ring-line hover:ring-ink')}>
            <span className="block text-sm font-bold">{AD_FORMAT[f].name}</span>
            <span className={cx('block text-xs', format === f ? 'text-white/70' : 'text-muted')}>{AD_FORMAT[f].size}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          {banner && (
            <div className="inline-flex rounded-lg bg-white p-1 ring-1 ring-line" role="tablist">
              {(
                [
                  ['compose', 'עיצוב מהמילים'],
                  ['upload', 'יש באנר מוכן'],
                ] as const
              ).map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={mode === id} onClick={() => setMode(id)} className={cx('rounded-md px-3 py-1.5 text-sm font-bold', mode === id ? 'bg-ink text-white' : 'text-ink-2')}>
                  {label}
                </button>
              ))}
            </div>
          )}

          {(!banner || mode === 'compose') && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">{textField('headline', 'כותרת', banner ? 70 : 90, 'קצרה וברורה: מה מקבלים.')}</div>
              <div className="sm:col-span-2">{textField('body', 'שורה נוספת (לא חובה)', banner ? 120 : 200)}</div>
              {textField('cta', 'הכפתור', banner ? 24 : 30)}
              {textField('sponsor', 'בחסות', 60, 'השם שמופיע ליד "פרסומת".')}
            </div>
          )}

          {banner && mode === 'compose' && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold text-ink-2">צבעים:</span>
                {BANNER_THEMES.map((t) => (
                  <button key={t} type="button" aria-pressed={theme === t} onClick={() => setTheme(t)} className={cx('rounded-full px-3 py-1 text-sm font-bold ring-1', theme === t ? 'bg-ink text-white ring-ink' : 'bg-white ring-line')}>
                    {BANNER_THEME[t]}
                  </button>
                ))}
                {theme === 'custom' && <input type="color" aria-label="הצבע של המפרסם" value={color} onChange={(e) => setColor(e.target.value)} className="h-8 w-12 rounded" />}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <PickImage use="photo" label={photo ? 'החלפת תמונה' : 'תמונה לבאנר (לא חובה)'} onPicked={(p) => setPhoto({ key: p.key, url: p.url })} />
                {photo && (
                  <Button size="sm" variant="ghost" onClick={() => setPhoto(null)}>
                    בלי תמונה
                  </Button>
                )}
              </div>
              <Button variant="dark" busy={compose.isPending} disabled={text.headline.trim().length < 2} onClick={() => compose.mutate()}>
                {desktop ? 'לעצב מחדש' : 'לעצב את הבאנר'}
              </Button>
              <p className="text-xs text-muted">בלי עלות: הבאנר נבנה אצלנו בגופנים של האתר, בכל הגדלים בבת אחת.</p>
            </div>
          )}

          {banner && mode === 'upload' && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <PickImage use={format === 'billboard' ? 'billboard-desktop' : 'rectangle'} label={format === 'billboard' ? `באנר למחשב: ${adSize(970, 250)}` : `הבאנר: ${adSize(300, 250)}`} onPicked={(p) => setDesktop({ key: p.key, url: p.url })} />
                {format === 'billboard' && <PickImage use="billboard-mobile" label={`באנר לנייד: ${adSize(320, 100)}`} onPicked={(p) => setMobile({ key: p.key, url: p.url })} />}
              </div>
              <p className="text-xs text-muted">בדיוק בגודל הזה, או כפול (למסכים חדים). בלי אנימציה. {format === 'billboard' && 'בלי באנר לנייד, המודעה לא תוצג בטלפונים.'}</p>
              {textField('sponsor', 'בחסות', 60)}
              {textField('alt', 'מה כתוב בבאנר', 200, 'לקוראי מסך (נגישות): המילים שבתמונה.')}
            </div>
          )}

          {!banner && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <PickImage use="native" label={desktop ? 'החלפת תמונה' : 'העלאת תמונה'} onPicked={(p) => setDesktop({ key: p.key, url: p.url })} />
                {desktop && (
                  <Button size="sm" variant="ghost" onClick={() => setDesktop(null)}>
                    בלי תמונה
                  </Button>
                )}
              </div>
              <Field label="או: תמונה מ-AI" htmlFor="cr-idea" hint="תארו את התמונה במילים. עולה כמה סנטים, ונוצרת רק בלחיצה.">
                <div className="flex gap-2">
                  <input id="cr-idea" value={idea} maxLength={800} onChange={(e) => setIdea(e.target.value)} placeholder="למשל: מטבח מודרני מואר, עם אי עץ" className={inputClass} />
                  <Button busy={startDraw.isPending || draw.running} disabled={idea.trim().length < 5} onClick={() => startDraw.mutate()}>
                    לצייר
                  </Button>
                </div>
              </Field>
              {draw.task?.status === 'failed' && <p className="text-sm text-brand">{draw.task.lastError}</p>}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <p className="text-sm font-bold text-ink-2">כך זה ייראה באתר</p>
          <AdPreview ad={{ format, ...text, desktopUrl: desktop?.url ?? null, mobileUrl: mobile?.url ?? null }} device="desktop" />
          {format === 'billboard' && <AdPreview ad={{ format, ...text, desktopUrl: desktop?.url ?? null, mobileUrl: mobile?.url ?? null }} device="mobile" />}
        </div>
      </div>

      <div className="flex gap-2">
        <Button variant="primary" busy={save.isPending} disabled={banner ? !desktop : !text.headline.trim()} onClick={() => save.mutate()}>
          שמירת המודעה
        </Button>
        <Button variant="ghost" onClick={onDone}>
          ביטול
        </Button>
      </div>
    </div>
  );
}

function CreativeRow({ campaign, creative }: { campaign: CampaignDto; creative: CreativeDto }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const review = useAdTask();
  const updated = (c: CampaignDto) => {
    qc.setQueryData(['ad-campaign', campaign.id], c);
    void qc.invalidateQueries({ queryKey: ['ads'] });
  };
  const onError = (e: unknown) => toast(errorMessage(e), 'danger');
  const toggle = useMutation({
    mutationFn: () => admin.put<CampaignDto>(`/ads/creatives/${creative.id}`, { ...creative, active: !creative.active }),
    onSuccess: updated,
    onError,
  });
  const remove = useMutation({ mutationFn: () => admin.del<CampaignDto>(`/ads/creatives/${creative.id}`), onSuccess: updated, onError });
  const check = useMutation({ mutationFn: () => admin.post<AdTaskDto>(`/ads/creatives/${creative.id}/review`), onSuccess: review.track, onError });
  // The check is saved on the ad: read the campaign again when it is done.
  const checked = review.task?.status === 'done';
  useEffect(() => {
    if (!checked) return;
    review.clear();
    void qc.invalidateQueries({ queryKey: ['ad-campaign', campaign.id] });
  }, [checked, review, qc, campaign.id]);
  if (editing) return <Editor campaign={campaign} creative={creative} onDone={() => setEditing(false)} />;
  const t = creative.totals;
  return (
    <li className={cx('grid gap-4 rounded-xl p-4 ring-1 md:grid-cols-[320px_minmax(0,1fr)]', creative.active ? 'bg-white ring-line' : 'bg-stone/60 ring-line-soft')}>
      <AdPreview ad={creative} />
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold">{AD_FORMAT[creative.format].name}</span>
          {!creative.active && <Badge tone="muted">כבויה</Badge>}
          {creative.review ? <Badge tone={AD_VERDICT[creative.review.verdict].tone}>הסוכן: {AD_VERDICT[creative.review.verdict].label}</Badge> : <Badge tone="info">עוד לא נבדקה</Badge>}
        </div>
        <p className="text-sm text-ink-2">
          {t.views.toLocaleString('he-IL')} צפיות · {t.clicks.toLocaleString('he-IL')} לחיצות ({ctr(t.clicks, t.views)}){campaign.action === 'lead' ? ` · ${t.leads} לידים` : ''}
        </p>
        {creative.review && creative.review.issues.length > 0 && (
          <ul className="space-y-2 rounded-lg bg-warn-soft p-3 text-sm">
            {creative.review.issues.map((i, n) => (
              <li key={n}>
                <b>&quot;{i.what.replace(/^["״“”]+|["״“”]+$/g, '')}&quot;</b>: {i.why} <span className="text-ink-2">תיקון: {i.fix}</span>
              </li>
            ))}
          </ul>
        )}
        {review.task?.status === 'failed' && <p className="text-sm text-brand">{review.task.lastError}</p>}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setEditing(true)}>
            עריכה
          </Button>
          <Button size="sm" busy={check.isPending || review.running} onClick={() => check.mutate()}>
            {creative.review ? 'לבדוק שוב' : 'בדיקת סוכן הפרסום'}
          </Button>
          <Button size="sm" variant="ghost" busy={toggle.isPending} onClick={() => toggle.mutate()}>
            {creative.active ? 'כיבוי' : 'הפעלה'}
          </Button>
          {t.served === 0 && (
            <Button size="sm" variant="ghost" busy={remove.isPending} onClick={() => confirm('למחוק את המודעה?') && remove.mutate()}>
              מחיקה
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}

export function Creatives({ campaign }: { campaign: CampaignDto }) {
  const [adding, setAdding] = useState(campaign.creatives.length === 0);
  return (
    <Card title={`המודעות (${campaign.creatives.length})`} actions={!adding && <Button size="sm" onClick={() => setAdding(true)}>הוספת מודעה</Button>}>
      <div className="space-y-4">
        {campaign.creatives.length > 1 && <p className="text-sm text-muted">כמה מודעות באותו קמפיין מוצגות לסירוגין, וכך רואים איזו עובדת טוב יותר.</p>}
        <ul className="space-y-3">
          {campaign.creatives.map((c) => (
            <CreativeRow key={c.id} campaign={campaign} creative={c} />
          ))}
        </ul>
        {adding && <Editor campaign={campaign} creative={null} onDone={() => setAdding(false)} />}
      </div>
    </Card>
  );
}
