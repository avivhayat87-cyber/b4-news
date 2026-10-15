'use client';
// The chief editor's morning meeting: held by itself every day at its hour on the live site, with
// discovery of the Israeli sites half an hour before, and its pitches emailed to the admins and the
// editors. Only an admin changes it (it is a daily AI call).
import type { MeetingSettings } from '@b4/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { admin, errorMessage } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { Button, Field, LinkButton, Loading, inputClass, useToast } from '../ui';

const HOURS = [5, 6, 7, 8, 9, 10, 11, 12];

export function MeetingAgent() {
  const qc = useQueryClient();
  const toast = useToast();
  const isAdmin = useCan();
  const query = useQuery({ queryKey: ['agent', 'meeting-settings'], queryFn: () => admin.get<MeetingSettings>('/agent/meeting-settings') });
  const [form, setForm] = useState<MeetingSettings | null>(null);
  useEffect(() => {
    if (query.data && !form) setForm(query.data);
  }, [query.data, form]);
  const save = useMutation({
    mutationFn: (v: MeetingSettings) => admin.put<MeetingSettings>('/agent/meeting-settings', v),
    onSuccess: (v) => {
      setForm(v);
      qc.setQueryData(['agent', 'meeting-settings'], v);
      toast('ההגדרות נשמרו.');
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  if (!form) return <Loading />;
  const dirty = JSON.stringify(form) !== JSON.stringify(query.data);

  return (
    <div className="space-y-5">
      <h3 className="font-bold">ישיבת הבוקר</h3>
      <label className="flex items-start gap-2 text-[15px] font-semibold">
        <input type="checkbox" checked={form.morning} disabled={!isAdmin} onChange={(e) => setForm({ ...form, morning: e.target.checked })} className="mt-1 size-4" />
        <span>
          לכנס ישיבת מערכת לבד כל בוקר
          <span className="block text-sm font-normal text-muted">חצי שעה לפני הישיבה רץ איתור כתבות באתרים הישראליים (בחינם). אחר כך העורך הראשי קורא את מה שנמצא ומציע כתבות, והמנהלים והעורכים מקבלים מייל עם ההצעות וקישור לאישור. שום דבר לא נחקר עד שמאשרים. רק באתר החי.</span>
        </span>
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="השעה" htmlFor="mt-hour">
          <select id="mt-hour" disabled={!isAdmin || !form.morning} value={form.hour} onChange={(e) => setForm({ ...form, hour: Number(e.target.value) })} className={inputClass}>
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, '0')}:00
              </option>
            ))}
          </select>
        </Field>
        <Field label="כיוון קבוע (לא חובה)" htmlFor="mt-focus" hint="למשל: צרכנות ונדל״ן. ריק: מה שחם היום.">
          <input id="mt-focus" disabled={!isAdmin || !form.morning} maxLength={300} value={form.focus} onChange={(e) => setForm({ ...form, focus: e.target.value })} className={inputClass} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-[15px]">
        <input type="checkbox" checked={form.skipSaturday} disabled={!isAdmin || !form.morning} onChange={(e) => setForm({ ...form, skipSaturday: e.target.checked })} className="size-4" />
        בלי ישיבה בשבת
      </label>
      <div className="rounded-lg bg-info-soft px-4 py-3 text-sm text-info">
        העלות: קריאה אחת ל-Claude בכל בוקר, בערך 3–6 סנט (כ-$1.5 בחודש), מתוך התקציב של הכתב-החוקר. אם כבר כונסה ישיבה באותו יום, או שהאיתור לא מצא מספיק כתבות, היא מדלגת.
      </div>
      <div className="flex flex-wrap gap-2">
        {isAdmin && (
          <Button variant="primary" busy={save.isPending} disabled={!dirty} onClick={() => save.mutate(form)}>
            שמירת ההגדרות
          </Button>
        )}
        <LinkButton href="/manual?tab=meeting">לישיבת המערכת</LinkButton>
      </div>
      {!isAdmin && <p className="text-sm text-muted">רק מנהל/ת מערכת יכול/ה לשנות את ההגדרות האלה.</p>}
    </div>
  );
}
