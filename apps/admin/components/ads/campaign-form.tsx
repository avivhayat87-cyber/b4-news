'use client';
// A campaign's details: the advertiser, where it appears (the places are fixed in code, few and
// calm), the sections and devices, the dates, a views cap, how often one reader sees it, and what
// a click does (a link out, or a short lead form on our site).
import { AD_LEAD_FIELD_LABELS, AD_LEAD_FIELDS, AD_SLOTS, CATEGORIES, type AdLeadField, type AdSlot, type AdvertiserDto, type CampaignDto, type CampaignInput } from '@b4/shared';
import { useState, type FormEvent } from 'react';
import { AD_DEVICE, AD_SLOT } from '@/lib/labels';
import { Button, Field, cx, inputClass } from '../ui';

export type CampaignDraft = Omit<CampaignInput, 'startsAt' | 'endsAt'> & { startsAt: string; endsAt: string };

/** An ISO time as the date-time input shows it, in the browser's own time (Israel). */
function toLocal(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function draftFrom(c: CampaignDto | null, advertiserId = ''): CampaignDraft {
  return {
    advertiserId: c?.advertiserId ?? advertiserId,
    name: c?.name ?? '',
    slots: c?.slots ?? ['sidebar'],
    categories: c?.categories ?? [],
    devices: c?.devices ?? 'all',
    startsAt: toLocal(c?.startsAt ?? null),
    endsAt: toLocal(c?.endsAt ?? null),
    weight: c?.weight ?? 5,
    maxViews: c?.maxViews ?? null,
    perReaderDaily: c?.perReaderDaily ?? 3,
    action: c?.action ?? 'link',
    url: c?.url ?? '',
    leadForm: c?.leadForm ?? { fields: ['name', 'phone'], question: '', thankYou: 'תודה! הפרטים התקבלו, ויחזרו אליך בהקדם.' },
    notes: c?.notes ?? '',
  };
}

export function toInput(d: CampaignDraft): CampaignInput {
  return { ...d, startsAt: d.startsAt ? new Date(d.startsAt).toISOString() : null, endsAt: d.endsAt ? new Date(d.endsAt).toISOString() : null };
}

const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

export function CampaignForm({ initial, advertisers, busy, submitLabel, onSubmit }: { initial: CampaignDraft; advertisers: AdvertiserDto[]; busy: boolean; submitLabel: string; onSubmit(d: CampaignDraft): void }) {
  const [d, setD] = useState<CampaignDraft>(initial);
  const set = <K extends keyof CampaignDraft>(k: K, v: CampaignDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const ready = d.advertiserId && d.name.trim().length >= 2 && d.slots.length > 0 && (d.action === 'lead' || d.url.trim());

  return (
    <form
      className="space-y-6"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSubmit(d);
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="מפרסם" htmlFor="c-adv" hint={advertisers.length ? undefined : 'קודם מוסיפים מפרסם בלשונית "מפרסמים".'}>
          <select id="c-adv" required value={d.advertiserId} onChange={(e) => set('advertiserId', e.target.value)} className={inputClass}>
            <option value="">בחרו מפרסם</option>
            {advertisers.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="שם הקמפיין" htmlFor="c-name" hint="לשימוש פנימי ובדוח של המפרסם.">
          <input id="c-name" required maxLength={120} value={d.name} onChange={(e) => set('name', e.target.value)} className={inputClass} />
        </Field>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-bold text-ink-2">איפה המודעה מופיעה</legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {AD_SLOTS.map((slot: AdSlot) => (
            <label key={slot} className={cx('flex cursor-pointer gap-2 rounded-lg p-3 ring-1', d.slots.includes(slot) ? 'bg-brand-soft ring-brand' : 'bg-white ring-line hover:ring-ink')}>
              <input type="checkbox" checked={d.slots.includes(slot)} onChange={() => set('slots', toggle(d.slots, slot))} className="mt-1" />
              <span>
                <span className="block font-bold">{AD_SLOT[slot].name}</span>
                <span className="block text-xs text-muted">{AD_SLOT[slot].where}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-bold text-ink-2">מדורים</legend>
        <p className="text-xs text-muted">בלי בחירה: בכל האתר. עם בחירה: רק בכתבות ובעמודים של המדורים האלה (לא בדף הבית).</p>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <button
              key={c.slug}
              type="button"
              aria-pressed={d.categories.includes(c.slug)}
              onClick={() => set('categories', toggle(d.categories, c.slug))}
              className={cx('rounded-full px-3 py-1 text-sm font-bold ring-1', d.categories.includes(c.slug) ? 'bg-ink text-white ring-ink' : 'bg-white text-ink-2 ring-line hover:ring-ink')}
            >
              {c.name}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="מכשירים" htmlFor="c-dev">
          <select id="c-dev" value={d.devices} onChange={(e) => set('devices', e.target.value as CampaignDraft['devices'])} className={inputClass}>
            {(Object.keys(AD_DEVICE) as CampaignDraft['devices'][]).map((k) => (
              <option key={k} value={k}>
                {AD_DEVICE[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="מתחיל" htmlFor="c-start" hint="ריק: מרגע האישור.">
          <input id="c-start" type="datetime-local" value={d.startsAt} onChange={(e) => set('startsAt', e.target.value)} className={inputClass} />
        </Field>
        <Field label="נגמר" htmlFor="c-end" hint="ריק: עד שמסיימים ביד.">
          <input id="c-end" type="datetime-local" value={d.endsAt} min={d.startsAt || undefined} onChange={(e) => set('endsAt', e.target.value)} className={inputClass} />
        </Field>
        <Field label="תקרת צפיות" htmlFor="c-cap" hint="ריק: בלי תקרה. בהגעה לתקרה הקמפיין עובר לארכיון.">
          <input id="c-cap" type="number" min={100} step={100} value={d.maxViews ?? ''} onChange={(e) => set('maxViews', e.target.value ? Number(e.target.value) : null)} className={inputClass} />
        </Field>
        <Field label="משקל מול קמפיינים אחרים" htmlFor="c-weight" hint={`${d.weight} מתוך 10: 10 מופיע פי שניים מ-5.`}>
          <input id="c-weight" type="range" min={1} max={10} value={d.weight} onChange={(e) => set('weight', Number(e.target.value))} className="w-full accent-brand" />
        </Field>
        <Field label="פעמים ביום לאותו גולש" htmlFor="c-freq" hint="כדי שלא יימאס. בדרך כלל 2–4.">
          <input id="c-freq" type="number" min={1} max={20} value={d.perReaderDaily} onChange={(e) => set('perReaderDaily', Number(e.target.value) || 1)} className={inputClass} />
        </Field>
      </div>

      <fieldset className="space-y-3 rounded-lg bg-stone p-4">
        <legend className="sr-only">מה קורה בלחיצה</legend>
        <p className="text-sm font-bold text-ink-2">מה קורה בלחיצה על המודעה</p>
        <div className="flex flex-wrap gap-4">
          {(
            [
              ['link', 'מעבר לאתר של המפרסם'],
              ['lead', 'טופס השארת פרטים (ליד)'],
            ] as const
          ).map(([value, text]) => (
            <label key={value} className="flex items-center gap-2 font-semibold">
              <input type="radio" name="c-action" checked={d.action === value} onChange={() => set('action', value)} />
              {text}
            </label>
          ))}
        </div>
        {d.action === 'link' ? (
          <Field label="הכתובת" htmlFor="c-url" hint="הלחיצה נספרת אצלנו, והקורא ממשיך לכתובת עם תגי מעקב (utm), כדי שהמפרסם יראה אותו גם אצלו.">
            <input id="c-url" dir="ltr" required value={d.url} onChange={(e) => set('url', e.target.value)} placeholder="https://" className={inputClass} />
          </Field>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-3">
              {AD_LEAD_FIELDS.map((f: AdLeadField) => (
                <label key={f} className="flex items-center gap-1.5 text-sm font-semibold">
                  <input
                    type="checkbox"
                    checked={d.leadForm.fields.includes(f)}
                    onChange={() => {
                      const fields = toggle(d.leadForm.fields, f);
                      if (fields.length) set('leadForm', { ...d.leadForm, fields });
                    }}
                  />
                  {AD_LEAD_FIELD_LABELS[f]}
                </label>
              ))}
            </div>
            <p className="text-xs text-muted">כמה שפחות שדות: כל שדה נוסף מוריד את מספר הפניות. הגולש מאשר במפורש שהמפרסם יחזור אליו, והאישור נשמר עם הליד.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="הכותרת מעל הטופס" htmlFor="c-q">
                <input id="c-q" maxLength={200} value={d.leadForm.question} onChange={(e) => set('leadForm', { ...d.leadForm, question: e.target.value })} placeholder="רוצים הצעה? השאירו פרטים" className={inputClass} />
              </Field>
              <Field label="ההודעה אחרי השליחה" htmlFor="c-ty">
                <input id="c-ty" maxLength={300} value={d.leadForm.thankYou} onChange={(e) => set('leadForm', { ...d.leadForm, thankYou: e.target.value })} className={inputClass} />
              </Field>
            </div>
          </div>
        )}
      </fieldset>

      <Field label="הערות פנימיות" htmlFor="c-notes" hint="מחיר שסוכם, איש קשר, מה הובטח ללקוח. לא מוצג לאף אחד מחוץ למערכת.">
        <textarea id="c-notes" rows={3} maxLength={2000} value={d.notes} onChange={(e) => set('notes', e.target.value)} className={inputClass} />
      </Field>

      <Button type="submit" variant="primary" busy={busy} disabled={!ready}>
        {submitLabel}
      </Button>
    </form>
  );
}
