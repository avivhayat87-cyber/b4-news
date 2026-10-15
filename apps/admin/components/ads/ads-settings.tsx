'use client';
// The switches over all ads, the map of the places (fixed in code: few and calm), and where
// Google comes in later: only in the places marked for it, only when nothing of ours runs there.
import { AD_SLOTS, type AdSettings } from '@b4/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { admin, errorMessage } from '@/lib/api';
import { Button, Card, Field, inputClass, useToast } from '../ui';
import { SiteSpotsLinks, SlotMap } from './slot-map';

export function AdsSettings({ settings }: { settings: AdSettings }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [s, setS] = useState(settings);
  const save = useMutation({
    mutationFn: () => admin.put<AdSettings>('/ads/settings', s),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ads'] });
      toast('ההגדרות נשמרו.');
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  return (
    <div className="space-y-6">
      <Card title="מתגים">
        <div className="space-y-4">
          <label className="flex items-start gap-3">
            <input type="checkbox" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} className="mt-1" />
            <span>
              <span className="block font-bold">מודעות פעילות באתר ובאפליקציה</span>
              <span className="block text-sm text-muted">כיבוי מוריד את כל המודעות מיד, בלי לגעת בקמפיינים.</span>
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
          <Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>
            שמירה
          </Button>
        </div>
      </Card>

      <Card title="המקומות באתר ובאפליקציה">
        <div className="space-y-4">
          <p className="text-sm text-ink-2">
            המקומות קבועים, מעטים ושקטים: אין חלונות קופצים, אין מודעה שצפה מעל התוכן ואין מסך מלא. בכל עמוד יש לכל היותר שתי מודעות. כל מודעה מסומנת &quot;פרסומת&quot; עם שם המפרסם, וזה לא ניתן לכיבוי. מקום רחב בלי מודעה מציג את הבאנר &quot;פרסמו אצלנו&quot; (בעמוד מדור, בשם המדור).
          </p>
          <SlotMap selected={[...AD_SLOTS]} />
          <SiteSpotsLinks />
        </div>
      </Card>

      <Card title="Google AdSense (בשלב הבא)">
        <div className="space-y-2 text-sm text-ink-2">
          <p>כשהאתר יעלה בדומיין שלו, אפשר יהיה לחבר את Google כדי שימלא מקומות שלא נמכרו. השליטה נשארת אצלכם:</p>
          <ul className="list-disc space-y-1 pr-5">
            <li>Google יקבל רק מקום שסימנתם, ורק כשאין בו קמפיין שלנו. בלי &quot;מודעות אוטומטיות&quot; שמפזרות מודעות לבד.</li>
            <li>מתג אחד כאן מכבה את Google בכל האתר.</li>
            <li>בחשבון AdSense חוסמים קטגוריות שלמות (הימורים, היכרויות, פוליטיקה, דת) ומפרסמים מסוימים, ורואים כל מודעה שרצה וחוסמים אותה בלחיצה.</li>
          </ul>
        </div>
      </Card>
    </div>
  );
}
