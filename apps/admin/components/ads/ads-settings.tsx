'use client';
// The switches over all ads, each place's rotation (positions to sell, seconds per ad), the map of
// the places (fixed in code: few and calm), and Google
// AdSense: the publisher id, the places Google may fill (only where no campaign of ours runs, only
// for readers who agreed to advertising cookies, never Google's automatic placement), each
// place's ad unit, and a step-by-step guide to opening the account and getting paid.
import { AD_SLOTS, type AdSettings, type WebAdSlot, WEB_AD_SLOTS, googleLive } from '@b4/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { SITE_URL, admin, errorMessage } from '@/lib/api';
import { AD_SLOT } from '@/lib/labels';
import { Badge, Button, Card, Field, cx, inputClass, useToast } from '../ui';
import { PlacesRotation } from './occupancy';
import { SiteSpotsLinks, SlotMap } from './slot-map';

const GUIDE: { title: string; body: string }[] = [
  { title: 'פותחים חשבון', body: 'ב-adsense.google.com, עם חשבון Google של העסק (כזה שיישאר שלכם). בוחרים סוג חשבון, אדם פרטי או עסק: שם מקבל התשלום חייב להיות זהה לשם בחשבון הבנק. כדאי להחליט עם רואה החשבון לפני כן, כי קשה לשנות את זה אחר כך.' },
  { title: 'מוסיפים את האתר', body: 'בלשונית "אתרים" מוסיפים את b4news.co.il (בלי https ובלי www). AdSense מציג מספר מפרסם שמתחיל ב-ca-pub: מדביקים אותו כאן למטה ושומרים. המערכת מוסיפה לבד את הקובץ ads.txt שגוגל בודק.' },
  { title: 'מבקשים בדיקה', body: 'ב-AdSense לוחצים "בקשת בדיקה". גוגל עובר על האתר, בדרך כלל כמה ימים ולפעמים 2–4 שבועות. האתר צריך להיות באוויר בדומיין שלו, עם תוכן, מדיניות פרטיות ותנאי שימוש.' },
  { title: 'יוצרים יחידת מודעה לכל מקום', body: 'ב-AdSense: "מודעות" > "לפי יחידת מודעה" > "מודעות תצוגה". נותנים שם (למשל "טור הצד"), שומרים, ומעתיקים את המספר שמופיע בקוד אחרי data-ad-slot. מדביקים אותו כאן ליד המקום המתאים. מקום בלי מספר לא מקבל מודעות של Google.' },
  { title: 'חוסמים מה שלא רוצים', body: 'ב-AdSense: "בקרת חסימות" > "כל האתרים". חוסמים קטגוריות רגישות (הימורים, היכרויות, פוליטיקה, דת) ומפרסמים מסוימים. ב"מרכז בדיקת המודעות" רואים כל מודעה שרצה וחוסמים אותה בלחיצה. לא מפעילים "מודעות אוטומטיות".' },
  { title: 'פרטי תשלום ומס', body: 'ב-AdSense: "תשלומים" > "פרטי תשלום". מוסיפים חשבון בנק ישראלי להעברה בנקאית בשקלים; גוגל מאמת אותו בהפקדה קטנה. ממלאים פרטי מס (טופס אמריקאי, בדרך כלל W-8BEN לאדם פרטי או W-8BEN-E לעסק), רצוי עם רואה החשבון.' },
  { title: 'קוד אימות בדואר (PIN)', body: 'כשמגיעים לסכום קטן ראשון, גוגל שולח מכתב לכתובת בחשבון עם קוד. הוא מגיע תוך 2–4 שבועות, ומקלידים אותו ב-AdSense. בלי הקוד אין תשלום.' },
  { title: 'מקבלים תשלום', body: 'פעם בחודש: ההכנסות של חודש משולמות בחודש שאחריו, ברגע שעוברים את סף התשלום (בדרך כלל 100 דולר; הסף המדויק מופיע בחשבון). סכום קטן יותר עובר לחודש הבא. את ההכנסה מדווחים למס בישראל.' },
];

function GoogleCard({ s, setS }: { s: AdSettings; setS: (s: AdSettings) => void }) {
  const g = s.google;
  const set = (next: Partial<AdSettings['google']>) => setS({ ...s, google: { ...g, ...next } });
  const toggle = (slot: WebAdSlot) => set({ slots: g.slots.includes(slot) ? g.slots.filter((x) => x !== slot) : [...g.slots, slot] });
  const ready = g.slots.filter((slot) => g.units[slot]);
  const state = !g.enabled ? { label: 'כבוי', tone: 'muted' as const } : !g.client ? { label: 'חסר מספר מפרסם', tone: 'warn' as const } : !ready.length ? { label: 'אין מקום עם יחידת מודעה', tone: 'warn' as const } : !s.enabled ? { label: 'כל המודעות כבויות', tone: 'warn' as const } : { label: 'פעיל', tone: 'ok' as const };

  return (
    <Card title="Google AdSense" actions={<Badge tone={state.tone}>{state.label}</Badge>}>
      <div className="space-y-5">
        <p className="text-sm text-ink-2">
          Google ממלא רק מקום שסימנתם, ורק כשאין בו קמפיין שלכם. הוא מוצג רק לגולש שהסכים לעוגיות פרסום (כשמפעילים את Google, באנר ההסכמה באתר מתחיל לשאול על זה). אין &quot;מודעות אוטומטיות&quot;: Google לא מוסיף מודעות לבד. מקום ש-Google לא מילא מתקפל, בלי חור באתר.
        </p>

        <label className="flex items-start gap-3">
          <input type="checkbox" checked={g.enabled} onChange={(e) => set({ enabled: e.target.checked })} className="mt-1" />
          <span>
            <span className="block font-bold">מודעות Google פעילות</span>
            <span className="block text-sm text-muted">כיבוי מוריד את Google מכל האתר מיד. הקמפיינים שלכם ממשיכים לרוץ.</span>
          </span>
        </label>

        <div className="max-w-md">
          <Field
            label="מספר המפרסם מ-AdSense"
            htmlFor="g-client"
            hint={
              <>
                נראה כך: <bdi dir="ltr">ca-pub-1234567890123456</bdi>. אפשר להדביק גם <bdi dir="ltr">pub-…</bdi> והמערכת תשלים.
              </>
            }
          >
            <input id="g-client" dir="ltr" value={g.client} onChange={(e) => set({ client: e.target.value.trim() })} placeholder="ca-pub-" className={inputClass} />
          </Field>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-bold text-ink-2">איפה Google רשאי למלא, ויחידת המודעה של כל מקום</legend>
          <ul className="space-y-2">
            {WEB_AD_SLOTS.map((slot) => {
              const on = g.slots.includes(slot);
              return (
                <li key={slot} className={cx('flex flex-wrap items-center gap-3 rounded-lg p-3 ring-1', on ? 'bg-white ring-ink' : 'bg-stone ring-line')}>
                  <label className="flex min-w-48 flex-1 items-start gap-2">
                    <input type="checkbox" checked={on} onChange={() => toggle(slot)} className="mt-1" />
                    <span>
                      <span className="block font-bold">{AD_SLOT[slot].name}</span>
                      <span className="block text-xs text-muted">{AD_SLOT[slot].where}</span>
                    </span>
                  </label>
                  <input
                    aria-label={`יחידת המודעה של ${AD_SLOT[slot].name}`}
                    dir="ltr"
                    inputMode="numeric"
                    disabled={!on}
                    value={g.units[slot]}
                    onChange={(e) => set({ units: { ...g.units, [slot]: e.target.value.replace(/\D/g, '') } })}
                    placeholder="data-ad-slot"
                    className={cx(inputClass, 'w-44')}
                  />
                  {on && !g.units[slot] && <span className="text-xs text-warn">בלי מספר יחידה Google לא ימלא כאן</span>}
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted">ההמלצה: טור הצד, ליד כתבה ובסוף כתבה. את הבאנרים בראש העמודים כדאי להשאיר ללקוחות שלכם ולבאנר &quot;פרסמו אצלנו&quot;.</p>
        </fieldset>

        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="font-bold text-ink-2">בדיקה:</span>
          <a href={`${SITE_URL}/ads.txt`} target="_blank" rel="noopener noreferrer" className="font-bold text-info underline underline-offset-2">
            הקובץ ads.txt באתר
          </a>
          <span className="text-xs text-muted">(אחרי שמירה עם מספר מפרסם ו-Google פעיל, מופיעה בו שורה של google.com. בלי זה הקובץ ריק.)</span>
        </p>
        {googleLive(s) && (
          <p className="rounded-lg bg-info-soft px-4 py-3 text-sm text-info">
            בסביבת הפיתוח (המחשב שלכם) לא פונים ל-Google: במקום המודעה מופיעה מסגרת כחולה &quot;מודעת Google תופיע כאן&quot;. מודעות אמיתיות מופיעות רק באתר החי, אחרי ש-AdSense אישר את האתר.
          </p>
        )}

        <details className="rounded-lg bg-stone p-4">
          <summary className="cursor-pointer font-bold">איך מחברים את Google ומקבלים תשלום, צעד אחר צעד</summary>
          <ol className="mt-4 space-y-3">
            {GUIDE.map((step, i) => (
              <li key={step.title} className="flex gap-3">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-ink text-sm font-bold text-white">{i + 1}</span>
                <span className="text-sm leading-relaxed">
                  <b className="block">{step.title}</b>
                  {step.body}
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-xs text-muted">הכסף מגיע מ-Google ישירות לחשבון הבנק שבחשבון AdSense. המערכת שלנו לא נוגעת בתשלום ולא רואה אותו; את ההכנסות רואים בדוחות של AdSense.</p>
        </details>
      </div>
    </Card>
  );
}

export function AdsSettings({ settings }: { settings: AdSettings }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [s, setS] = useState(settings);
  const save = useMutation({
    mutationFn: () => admin.put<AdSettings>('/ads/settings', s),
    onSuccess: (saved) => {
      setS(saved);
      void qc.invalidateQueries({ queryKey: ['ads'] });
      toast('ההגדרות נשמרו.');
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  const saveButton = (
    <Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>
      שמירה
    </Button>
  );
  return (
    <div className="space-y-6">
      <Card title="מתגים">
        <div className="space-y-4">
          <label className="flex items-start gap-3">
            <input type="checkbox" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} className="mt-1" />
            <span>
              <span className="block font-bold">מודעות פעילות באתר ובאפליקציה</span>
              <span className="block text-sm text-muted">כיבוי מוריד את כל המודעות מיד, גם של Google, בלי לגעת בקמפיינים.</span>
            </span>
          </label>
          <label className="flex items-start gap-3">
            <input type="checkbox" checked={s.housePromo} onChange={(e) => setS({ ...s, housePromo: e.target.checked })} className="mt-1" />
            <span>
              <span className="block font-bold">מקום ריק מציג את הבאנר &quot;פרסמו אצלנו&quot;</span>
              <span className="block text-sm text-muted">מוביל לעמוד הפרסום עם הטופס. כבוי: מקום בלי קמפיין פשוט לא מופיע.</span>
            </span>
          </label>
          <div className="max-w-xs">
            <Field label="באפליקציה: מודעה אחת אחרי כל" htmlFor="ad-every" hint="כתבות בפיד. מומלץ 8 ומעלה, כדי שלא יהיה עומס.">
              <input id="ad-every" type="number" min={4} max={30} value={s.appFeedEvery} onChange={(e) => setS({ ...s, appFeedEvery: Number(e.target.value) || 8 })} className={inputClass} />
            </Field>
          </div>
          {saveButton}
        </div>
      </Card>

      <PlacesRotation s={s} setS={setS} />
      <div className="-mt-3">{saveButton}</div>

      <GoogleCard s={s} setS={setS} />
      <div className="-mt-3">{saveButton}</div>

      <Card title="המקומות באתר ובאפליקציה">
        <div className="space-y-4">
          <p className="text-sm text-ink-2">
            המקומות קבועים, מעטים ושקטים: אין חלונות קופצים, אין מודעה שצפה מעל התוכן ואין מסך מלא. בכל עמוד יש לכל היותר שתי מודעות. כל מודעה מסומנת &quot;פרסומת&quot; עם שם המפרסם, וזה לא ניתן לכיבוי. מקום רחב בלי מודעה מציג את הבאנר &quot;פרסמו אצלנו&quot; (בעמוד מדור, בשם המדור).
          </p>
          <SlotMap selected={[...AD_SLOTS]} />
          <SiteSpotsLinks />
        </div>
      </Card>
    </div>
  );
}
