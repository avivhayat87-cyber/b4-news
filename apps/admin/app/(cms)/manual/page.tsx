'use client';
// Manual entry: by link (same process as discovered articles: original + AI
// draft), or by writing (the editor's own text and image).
import { CATEGORIES, DRAFT_COLORS, type DraftColor, type MediaDto, type SavedEdits } from '@b4/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { FocalPicker, UploadButton } from '@/components/image-upload';
import { Button, Card, ColorDot, Field, PageHeader, cx, inputClass, useToast } from '@/components/ui';
import { admin, errorMessage } from '@/lib/api';
import { COLOR } from '@/lib/labels';

function ColorPicker({ value, onChange }: { value: DraftColor; onChange(c: DraftColor): void }) {
  return (
    <div className="flex gap-1.5" role="radiogroup" aria-label="צבע">
      {DRAFT_COLORS.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={COLOR[c]} title={COLOR[c]} onClick={() => onChange(c)} className={cx('rounded-full p-1.5', value === c && 'ring-2 ring-ink')}>
          <ColorDot color={c} className="size-4" />
        </button>
      ))}
    </div>
  );
}

function Destination({ magazineId, setMagazineId }: { magazineId: string; setMagazineId(v: string): void }) {
  const saved = useQuery({ queryKey: ['saved'], queryFn: () => admin.get<SavedEdits>('/saved') });
  const open = saved.data?.magazines.filter((m) => !['published', 'publishing', 'archived'].includes(m.status)) ?? [];
  return (
    <Field label="לאן לשמור" htmlFor="dest">
      <select id="dest" value={magazineId} onChange={(e) => setMagazineId(e.target.value)} className={inputClass}>
        <option value="">כתבה בודדת (בעריכות השמורות)</option>
        {open.map((m) => (
          <option key={m.id} value={m.id}>
            להוסיף למגזין: {m.title}
          </option>
        ))}
      </select>
    </Field>
  );
}

function ByLink() {
  const router = useRouter();
  const toast = useToast();
  const [url, setUrl] = useState('');
  const [color, setColor] = useState<DraftColor>('blue');
  const [magazineId, setMagazineId] = useState('');
  const create = useMutation({
    mutationFn: () => admin.post<{ draftId: string }>('/manual/url', { url: url.trim(), colorLabel: color, magazineId: magazineId || undefined }),
    onSuccess: (r) => {
      toast('הכתבה נקלטה. ה-AI כותב טיוטה.');
      router.push(`/drafts/${r.draftId}`);
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  return (
    <Card title="העלאה באמצעות קישור">
      <form
        className="space-y-4"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <Field label="קישור לכתבה" htmlFor="url" hint="המערכת קוראת את הכתבה, שומרת אותה כמקור להשוואה, וה-AI כותב טיוטה. בדיוק כמו בכתבות מהאיתור.">
          <input id="url" type="url" dir="ltr" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" className={inputClass} />
        </Field>
        <Destination magazineId={magazineId} setMagazineId={setMagazineId} />
        {!magazineId && (
          <Field label="צבע">
            <ColorPicker value={color} onChange={setColor} />
          </Field>
        )}
        <Button type="submit" variant="primary" busy={create.isPending} disabled={!url.trim()}>
          קליטה ומעבר לעריכה
        </Button>
      </form>
    </Card>
  );
}

function ByWriting() {
  const router = useRouter();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState('');
  const [tags, setTags] = useState('');
  const [hero, setHero] = useState<MediaDto | null>(null);
  const [color, setColor] = useState<DraftColor>('green');
  const [magazineId, setMagazineId] = useState('');
  const create = useMutation({
    mutationFn: () =>
      admin.post<{ draftId: string }>('/manual/write', {
        title,
        subtitle,
        body,
        category,
        heroMediaId: hero?.id ?? null,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        colorLabel: color,
        magazineId: magazineId || undefined,
      }),
    onSuccess: (r) => {
      toast('הכתבה נשמרה בעריכות השמורות.');
      router.push(`/drafts/${r.draftId}`);
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });

  return (
    <Card title="כתיבה ידנית והעלאת תמונה">
      <form
        className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <div className="space-y-4">
          <Field label="כותרת" htmlFor="w-title">
            <input id="w-title" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} className={cx(inputClass, 'font-display text-lg font-bold')} />
          </Field>
          <Field label="כותרת משנה" htmlFor="w-sub">
            <input id="w-sub" maxLength={400} value={subtitle} onChange={(e) => setSubtitle(e.target.value)} className={inputClass} />
          </Field>
          <Field label="גוף הכתבה" htmlFor="w-body" hint='פסקאות מופרדות בשורה ריקה. שורה שמתחילה ב-"## " היא כותרת ביניים, ב-"> " ציטוט, ב-"- " רשימה.'>
            <textarea id="w-body" required rows={16} value={body} onChange={(e) => setBody(e.target.value)} className={cx(inputClass, 'leading-relaxed')} />
          </Field>
        </div>
        <div className="space-y-4">
          <Field label="תמונה ראשית" hint="כל הגדלים (ראשית, כרטיס, ממוזערת, שיתוף, סטורי) נחתכים אוטומטית.">
            {hero ? <FocalPicker media={hero} onChange={setHero} /> : <div className="flex aspect-video items-center justify-center rounded-lg border border-dashed border-line bg-stone text-sm text-muted">אין תמונה</div>}
            <div className="mt-2 flex gap-2">
              <UploadButton onUploaded={setHero} label={hero ? 'החלפת תמונה' : 'העלאת תמונה'} />
              {hero && (
                <Button variant="ghost" onClick={() => setHero(null)}>
                  הסרה
                </Button>
              )}
            </div>
          </Field>
          <Field label="קטגוריה" htmlFor="w-cat">
            <select id="w-cat" required value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass}>
              <option value="">בחרו קטגוריה</option>
              {CATEGORIES.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="תגיות" htmlFor="w-tags" hint="מופרדות בפסיק">
            <input id="w-tags" value={tags} onChange={(e) => setTags(e.target.value)} className={inputClass} />
          </Field>
          <Destination magazineId={magazineId} setMagazineId={setMagazineId} />
          {!magazineId && (
            <Field label="צבע">
              <ColorPicker value={color} onChange={setColor} />
            </Field>
          )}
          <Button type="submit" variant="primary" className="w-full" busy={create.isPending} disabled={!title.trim() || !body.trim() || !category}>
            שמירה ומעבר לעריכה
          </Button>
        </div>
      </form>
    </Card>
  );
}

export default function ManualPage() {
  const [mode, setMode] = useState<'link' | 'write'>('link');
  return (
    <>
      <PageHeader title="העלאה ידנית" subtitle="כתבה מקישור, או כתבה שאתם כותבים. שתיהן נכנסות לאותו תהליך עריכה והעלאה." />
      <div className="mb-5 inline-flex rounded-lg bg-white p-1 ring-1 ring-line" role="tablist">
        {(
          [
            ['link', 'באמצעות קישור'],
            ['write', 'כתיבה ידנית'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={mode === id} onClick={() => setMode(id)} className={cx('rounded-md px-4 py-2 font-bold', mode === id ? 'bg-ink text-white' : 'text-ink-2 hover:bg-stone')}>
            {label}
          </button>
        ))}
      </div>
      {mode === 'link' ? <ByLink /> : <ByWriting />}
    </>
  );
}
