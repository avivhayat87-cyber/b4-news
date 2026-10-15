'use client';
// Manual entry, in tabs: from a link or screenshots (the research reporter, or a plain rewrite of
// a link, as discovered articles get), from the newsroom's own idea, from the editorial meeting's
// pitches, or by writing (the editor's own text and image).
import { CATEGORIES, type DraftColor, type MediaDto } from '@b4/shared';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { FocalPicker, UploadButton } from '@/components/image-upload';
import { MeetingTab } from '@/components/research/meeting-tab';
import { ColorPicker, Destination, ResearchTab } from '@/components/research/research-tab';
import { Button, Card, Field, PageHeader, cx, inputClass, useToast } from '@/components/ui';
import { admin, errorMessage } from '@/lib/api';

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

const MODES = ['research', 'idea', 'meeting', 'write'] as const;
type Mode = (typeof MODES)[number];

export default function ManualPage() {
  const [mode, setMode] = useState<Mode>('research');
  // A link straight to a tab (the morning meeting's email opens "ישיבת מערכת").
  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get('tab');
    if (tab && (MODES as readonly string[]).includes(tab)) setMode(tab as Mode);
  }, []);
  return (
    <>
      <PageHeader title="העלאה ידנית" subtitle="דיווח שהכתב-החוקר בודק, רעיון שהוא חוקר, הצעות מישיבת המערכת, או כתבה שאתם כותבים. הכול נכנס לאותו תהליך עריכה והעלאה." />
      <div className="mb-5 inline-flex max-w-full flex-wrap gap-1 rounded-lg bg-white p-1 ring-1 ring-line" role="tablist">
        {(
          [
            ['research', 'מקישור או צילום מסך'],
            ['idea', 'רעיון לתחקיר'],
            ['meeting', 'ישיבת מערכת'],
            ['write', 'כתיבה ידנית'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={mode === id} onClick={() => setMode(id)} className={cx('rounded-md px-4 py-2 font-bold', mode === id ? 'bg-ink text-white' : 'text-ink-2 hover:bg-stone')}>
            {label}
          </button>
        ))}
      </div>
      {mode === 'research' && <ResearchTab mode="report" />}
      {mode === 'idea' && <ResearchTab mode="idea" />}
      {mode === 'meeting' && <MeetingTab />}
      {mode === 'write' && <ByWriting />}
    </>
  );
}
