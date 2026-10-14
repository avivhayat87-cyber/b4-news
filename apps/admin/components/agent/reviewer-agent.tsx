'use client';
// The legal reviewer's settings: check every article when its text is final, and email the admins
// when one is stopped. Only an admin changes them: turning the review off lets risks through.
import type { ReviewerSettings } from '@b4/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { admin, errorMessage } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { Button, LinkButton, Loading, useToast } from '../ui';

export function ReviewerAgent() {
  const qc = useQueryClient();
  const toast = useToast();
  const isAdmin = useCan();
  const query = useQuery({ queryKey: ['agent', 'reviewer-settings'], queryFn: () => admin.get<ReviewerSettings>('/agent/reviewer-settings') });
  const [form, setForm] = useState<ReviewerSettings | null>(null);
  useEffect(() => {
    if (query.data && !form) setForm(query.data);
  }, [query.data, form]);
  const save = useMutation({
    mutationFn: (v: ReviewerSettings) => admin.put<ReviewerSettings>('/agent/reviewer-settings', v),
    onSuccess: (v) => {
      setForm(v);
      qc.setQueryData(['agent', 'reviewer-settings'], v);
      toast('ההגדרות נשמרו.');
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  if (!form) return <Loading />;
  const dirty = JSON.stringify(form) !== JSON.stringify(query.data);

  return (
    <div className="space-y-5">
      <label className="flex items-start gap-2 text-[15px] font-semibold">
        <input type="checkbox" checked={form.enabled} disabled={!isAdmin} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} className="mt-1 size-4" />
        <span>
          לבדוק כל כתבה כשהטקסט מסומן כסופי
          <span className="block text-sm font-normal text-muted">כבוי: כתבות לא נבדקות, ואין שום עצירה לפני פרסום. לא מומלץ.</span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-[15px] font-semibold">
        <input type="checkbox" checked={form.emailAdmins} disabled={!isAdmin} onChange={(e) => setForm({ ...form, emailAdmins: e.target.checked })} className="mt-1 size-4" />
        <span>
          לשלוח מייל לכל המנהלים כשכתבה נעצרת
          <span className="block text-sm font-normal text-muted">במייל: מה נמצא, למה זה סיכון, מה כדאי לעשות, וקישור ישיר לכתבה.</span>
        </span>
      </label>
      <div className="rounded-lg bg-info-soft px-4 py-3 text-sm text-info">
        העלות: קריאה אחת למודל המהיר לכל כתבה, בערך עשירית סנט. ניסוח זהיר של קטע (&quot;פרסום בזהירות מוגברת&quot;) עובר למודל הראשי, רק כשמבקשים אותו.
      </div>
      <div className="flex flex-wrap gap-2">
        {isAdmin && (
          <Button variant="primary" busy={save.isPending} disabled={!dirty} onClick={() => save.mutate(form)}>
            שמירת ההגדרות
          </Button>
        )}
        <LinkButton href="/review">כתבות שמחכות להחלטה</LinkButton>
      </div>
      {!isAdmin && <p className="text-sm text-muted">רק מנהל/ת מערכת יכול/ה לשנות את ההגדרות האלה.</p>}
    </div>
  );
}
