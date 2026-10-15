'use client';
// "סוכן הפרסום": a short brief about a business becomes a campaign proposal (headlines, text,
// button, places, sections, lead form, a picture idea, and what to check). Nothing runs from here:
// the proposal becomes a draft campaign, and an admin finishes and approves it.
import { AD_GOALS, CATEGORIES, type AdBriefDto, type AdBriefInput, type AdTaskDto, type AdvertiserDto, type CampaignDto } from '@b4/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { admin, errorMessage } from '@/lib/api';
import { AD_GOAL, AD_SLOT } from '@/lib/labels';
import { Badge, Button, Card, Field, cx, inputClass, useToast } from '../ui';
import { useAdTask } from './use-ad-task';

function Choice({ name, options, value, onChange }: { name: string; options: string[]; value: number; onChange(i: number): void }) {
  return (
    <div className="space-y-1.5" role="radiogroup" aria-label={name}>
      <p className="text-sm font-bold text-ink-2">{name}</p>
      {options.map((o, i) => (
        <label key={i} className={cx('flex cursor-pointer gap-2 rounded-lg px-3 py-2 ring-1', value === i ? 'bg-brand-soft ring-brand' : 'bg-white ring-line')}>
          <input type="radio" checked={value === i} onChange={() => onChange(i)} />
          <span>{o}</span>
        </label>
      ))}
    </div>
  );
}

function Proposal({ brief, input, advertisers }: { brief: AdBriefDto; input: AdBriefInput; advertisers: AdvertiserDto[] }) {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const [pick, setPick] = useState({ headline: 0, body: 0, cta: 0 });
  const [advertiserId, setAdvertiserId] = useState(input.advertiserId ?? advertisers.find((a) => a.name === input.business)?.id ?? '');
  const create = useMutation({
    mutationFn: async () => {
      const owner = advertiserId || (await admin.post<AdvertiserDto>('/ads/advertisers', { name: input.business, website: input.website })).id;
      const campaign = await admin.post<CampaignDto>('/ads/campaigns', {
        advertiserId: owner,
        name: `${input.business}: ${brief.headlines[pick.headline] ?? 'קמפיין'}`.slice(0, 120),
        slots: brief.slots.length ? brief.slots : ['sidebar'],
        categories: brief.categories,
        action: brief.action === 'link' && input.website ? 'link' : 'lead',
        url: brief.action === 'link' ? input.website : '',
        leadForm: { fields: brief.leadFields, question: brief.leadQuestion, thankYou: 'תודה! הפרטים התקבלו, ויחזרו אליך בהקדם.' },
        notes: [`הוצע על ידי סוכן הפרסום.`, ...brief.warnings.map((w) => `לבדוק: ${w}`)].join('\n'),
      });
      const formats = new Set(campaign.slots.flatMap((s) => (s === 'home_top' ? ['billboard'] : ['native'])));
      if (formats.has('native')) {
        await admin.post(`/ads/campaigns/${campaign.id}/creatives`, { format: 'native', headline: brief.headlines[pick.headline] ?? '', body: brief.bodies[pick.body] ?? '', cta: brief.ctas[pick.cta] ?? '' });
      }
      return campaign;
    },
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: ['ads'] });
      toast('נוצרה טיוטת קמפיין. מוסיפים תמונה, בודקים ומאשרים.');
      router.push(`/ads/${c.id}`);
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });

  return (
    <Card title="ההצעה של סוכן הפרסום">
      <div className="space-y-5">
        <p className="leading-relaxed text-ink-2">{brief.summary}</p>
        {brief.warnings.length > 0 && (
          <div className="rounded-lg bg-warn-soft px-4 py-3 text-sm">
            <p className="font-bold text-warn">לבדוק לפני שזה עולה:</p>
            <ul className="mt-1 list-disc space-y-1 pr-5">
              {brief.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="grid gap-5 lg:grid-cols-3">
          <Choice name="כותרת" options={brief.headlines} value={pick.headline} onChange={(headline) => setPick({ ...pick, headline })} />
          <Choice name="שורה" options={brief.bodies} value={pick.body} onChange={(body) => setPick({ ...pick, body })} />
          <Choice name="כפתור" options={brief.ctas} value={pick.cta} onChange={(cta) => setPick({ ...pick, cta })} />
        </div>
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div className="rounded-lg bg-stone p-3">
            <dt className="text-muted">מקומות</dt>
            <dd className="font-bold">{brief.slots.map((s) => AD_SLOT[s].name).join(' · ') || '—'}</dd>
          </div>
          <div className="rounded-lg bg-stone p-3">
            <dt className="text-muted">מדורים</dt>
            <dd className="font-bold">{brief.categories.map((c) => CATEGORIES.find((x) => x.slug === c)?.name ?? c).join(' · ') || 'כל האתר'}</dd>
          </div>
          <div className="rounded-lg bg-stone p-3">
            <dt className="text-muted">בלחיצה</dt>
            <dd className="font-bold">{brief.action === 'lead' ? `טופס: ${brief.leadQuestion || 'השארת פרטים'}` : 'מעבר לאתר שלהם'}</dd>
          </div>
        </dl>
        {brief.imageIdea && (
          <p className="text-sm text-ink-2">
            <Badge tone="info">רעיון לתמונה</Badge> {brief.imageIdea}
          </p>
        )}
        <div className="flex flex-wrap items-end gap-3 border-t border-line-soft pt-4">
          <Field label="למפרסם" htmlFor="ag-owner">
            <select id="ag-owner" value={advertiserId} onChange={(e) => setAdvertiserId(e.target.value)} className={inputClass}>
              <option value="">מפרסם חדש: {input.business}</option>
              {advertisers.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <Button variant="primary" busy={create.isPending} onClick={() => create.mutate()}>
            יצירת טיוטת קמפיין מההצעה
          </Button>
        </div>
        <p className="text-xs text-muted">הטיוטה לא מופיעה באתר. בעמוד הקמפיין מוסיפים תמונה (או מבקשים מה-AI לצייר לפי הרעיון), מריצים בדיקה ומאשרים.</p>
      </div>
    </Card>
  );
}

export function AgentTab({ advertisers }: { advertisers: AdvertiserDto[] }) {
  const toast = useToast();
  const brief = useAdTask();
  const [input, setInput] = useState<AdBriefInput>({ advertiserId: null, business: '', website: '', offer: '', goal: 'leads', audience: '', notes: '' });
  const [sent, setSent] = useState<AdBriefInput | null>(null);
  const start = useMutation({
    mutationFn: () => admin.post<AdTaskDto>('/ads/agent/brief', input),
    onSuccess: (t) => {
      setSent(input);
      brief.track(t);
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  const set = <K extends keyof AdBriefInput>(k: K, v: AdBriefInput[K]) => setInput((x) => ({ ...x, [k]: v }));

  return (
    <div className="space-y-6">
      <Card title="קמפיין חדש עם סוכן הפרסום">
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            start.mutate();
          }}
        >
          <Field label="מפרסם קיים (לא חובה)" htmlFor="ag-adv">
            <select
              id="ag-adv"
              value={input.advertiserId ?? ''}
              onChange={(e) => {
                const a = advertisers.find((x) => x.id === e.target.value);
                setInput((x) => ({ ...x, advertiserId: a?.id ?? null, business: a?.name ?? x.business, website: a?.website ?? x.website }));
              }}
              className={inputClass}
            >
              <option value="">עסק חדש</option>
              {advertisers.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="שם העסק" htmlFor="ag-biz">
            <input id="ag-biz" required maxLength={120} value={input.business} onChange={(e) => set('business', e.target.value)} className={inputClass} />
          </Field>
          <Field label="האתר שלהם (לא חובה)" htmlFor="ag-site" hint="הסוכן קורא את עמוד הבית כדי להכיר את העסק (בלי עלות).">
            <input id="ag-site" dir="ltr" value={input.website} onChange={(e) => set('website', e.target.value)} placeholder="https://" className={inputClass} />
          </Field>
          <Field label="המטרה" htmlFor="ag-goal">
            <select id="ag-goal" value={input.goal} onChange={(e) => set('goal', e.target.value as AdBriefInput['goal'])} className={inputClass}>
              {AD_GOALS.map((g) => (
                <option key={g} value={g}>
                  {AD_GOAL[g]}
                </option>
              ))}
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="מה העסק מציע, ומה מיוחד בקמפיין הזה" htmlFor="ag-offer" hint="מחיר, הנחה ותנאים רק אם העסק נתן אותם: הסוכן לא ממציא.">
              <textarea id="ag-offer" required rows={4} maxLength={1500} value={input.offer} onChange={(e) => set('offer', e.target.value)} className={inputClass} />
            </Field>
          </div>
          <Field label="קהל (לא חובה)" htmlFor="ag-aud">
            <input id="ag-aud" maxLength={500} value={input.audience} onChange={(e) => set('audience', e.target.value)} placeholder="למשל: זוגות צעירים שקונים דירה ראשונה" className={inputClass} />
          </Field>
          <Field label="הערות (לא חובה)" htmlFor="ag-notes">
            <input id="ag-notes" maxLength={1000} value={input.notes} onChange={(e) => set('notes', e.target.value)} className={inputClass} />
          </Field>
          <div className="flex items-center gap-3 sm:col-span-2">
            <Button type="submit" variant="primary" busy={start.isPending || brief.running} disabled={input.business.trim().length < 2 || input.offer.trim().length < 10}>
              {brief.running ? 'הסוכן עובד…' : 'לקבל הצעה'}
            </Button>
            <span className="text-xs text-muted">בערך סנט אחד להצעה (המודל המהיר).</span>
          </div>
        </form>
      </Card>
      {brief.task?.status === 'failed' && <p className="rounded-lg bg-brand-soft px-4 py-3 font-semibold text-brand-deep">{brief.task.lastError}</p>}
      {brief.task?.status === 'done' && brief.task.brief && sent && <Proposal brief={brief.task.brief} input={sent} advertisers={advertisers} />}
    </div>
  );
}
