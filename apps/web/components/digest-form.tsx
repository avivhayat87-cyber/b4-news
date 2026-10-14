'use client';
// "העיתון שלי": the topics in the reader's order (tap to add, tap again to remove), the hour it
// arrives, daily or weekly, and how (mail; for signed-in readers also their phone). Used after
// confirming the newsletter, from the link in every issue, and in the account.
import type { DigestPrefs } from '@b4/shared';
import { useEffect, useState } from 'react';
import { ApiFailure } from '@/lib/client-api';
import { CATEGORIES } from '@/lib/site';

const PRESETS = [
  { hour: 7, label: 'בוקר', time: '07:00' },
  { hour: 13, label: 'צהריים', time: '13:00' },
  { hour: 20, label: 'ערב', time: '20:00' },
];

export function DigestForm({
  load,
  save,
  allowPush = false,
  intro,
}: {
  load: () => Promise<DigestPrefs>;
  save: (prefs: DigestPrefs) => Promise<DigestPrefs>;
  /** Signed-in readers can get it on their phone (the app). */
  allowPush?: boolean;
  intro?: string;
}) {
  const [prefs, setPrefs] = useState<DigestPrefs | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    load()
      .then(setPrefs)
      .catch((e) =>
        setStatus(
          e instanceof ApiFailure && (e.status === 400 || e.status === 404)
            ? 'הקישור לא תקין או שהמנוי הוסר. פתחו את הקישור מתוך גיליון שקיבלתם לאחרונה במייל.'
            : 'לא הצלחנו לטעון את ההעדפות. נסו לרענן.',
        ),
      );
  }, [load]);

  if (!prefs) return status ? <p className="text-ink-2">{status}</p> : <p className="text-ink-2">טוען…</p>;

  const toggleSection = (slug: string) =>
    setPrefs({ ...prefs, sections: prefs.sections.includes(slug) ? prefs.sections.filter((s) => s !== slug) : [...prefs.sections, slug] });

  const submit = async () => {
    setBusy(true);
    setStatus(null);
    try {
      setPrefs(await save(prefs));
      setStatus(prefs.email || prefs.push ? `נשמר. העיתון שלך יגיע ${prefs.frequency === 'weekly' ? 'בכל יום ראשון' : 'כל יום'} ב-${String(prefs.hour).padStart(2, '0')}:00.` : 'נשמר. העיתון כבוי.');
    } catch {
      setStatus('השמירה נכשלה. נסו שוב.');
    } finally {
      setBusy(false);
    }
  };

  const chip = 'rounded-full border-[1.5px] px-4 py-2 text-[15px] font-bold transition';
  return (
    <div className="flex flex-col gap-6">
      {intro ? <p className="text-lg text-ink-2">{intro}</p> : null}

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-lg font-extrabold">מה מעניין אותך?</legend>
        <p className="text-sm text-ink-2">לחצו לפי סדר החשיבות: הראשון יופיע ראשון. בלי בחירה, תקבלו את הכל.</p>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => {
            const place = prefs.sections.indexOf(c.slug);
            return (
              <button
                key={c.slug}
                type="button"
                aria-pressed={place >= 0}
                onClick={() => toggleSection(c.slug)}
                className={`${chip} ${place >= 0 ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink hover:border-ink'}`}
              >
                {place >= 0 ? <span className="me-1.5 tabular-nums text-brand">{place + 1}</span> : null}
                {c.name}
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-lg font-extrabold">מתי לשלוח?</legend>
        <div className="flex flex-wrap items-center gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.hour}
              type="button"
              aria-pressed={prefs.hour === p.hour}
              onClick={() => setPrefs({ ...prefs, hour: p.hour })}
              className={`${chip} ${prefs.hour === p.hour ? 'border-ink bg-ink text-white' : 'border-line bg-white hover:border-ink'}`}
            >
              {p.label} <span className="tabular-nums opacity-80">{p.time}</span>
            </button>
          ))}
          <label className="flex items-center gap-2 text-[15px]">
            <span className="text-ink-2">או שעה אחרת:</span>
            <select
              value={prefs.hour}
              onChange={(e) => setPrefs({ ...prefs, hour: Number(e.target.value) })}
              className="h-10 rounded-full border-[1.5px] border-line bg-white px-3 tabular-nums"
              aria-label="שעת המשלוח"
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, '0')}:00
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex gap-4 text-[15px]">
          {(
            [
              ['daily', 'כל יום'],
              ['weekly', 'פעם בשבוע (ביום ראשון)'],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2">
              <input type="radio" name="digest-frequency" checked={prefs.frequency === value} onChange={() => setPrefs({ ...prefs, frequency: value })} className="size-4" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      {allowPush ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-lg font-extrabold">איך?</legend>
          <label className="flex items-center gap-3 text-[16px]">
            <input type="checkbox" className="size-5" checked={prefs.email} onChange={(e) => setPrefs({ ...prefs, email: e.target.checked })} />
            במייל
          </label>
          <label className="flex items-center gap-3 text-[16px]">
            <input type="checkbox" className="size-5" checked={prefs.push} onChange={(e) => setPrefs({ ...prefs, push: e.target.checked })} />
            התראה בטלפון (באפליקציה, כשמחוברים בה לחשבון)
          </label>
        </fieldset>
      ) : null}

      <div className="flex flex-wrap items-center gap-4">
        <button type="button" onClick={submit} disabled={busy} className="inline-flex h-12 items-center rounded-full bg-brand px-6 font-extrabold text-white hover:bg-brand-deep disabled:opacity-60">
          {busy ? 'שומר…' : 'שמירה'}
        </button>
        {status ? (
          <p role="status" className="text-[15px] text-ink-2">
            {status}
          </p>
        ) : null}
      </div>
    </div>
  );
}
