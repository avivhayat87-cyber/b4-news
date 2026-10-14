'use client';
// The social editor: whether it writes a distribution plan for every article and sends it out on
// publishing, the newsroom's instructions, and the plans the editors changed, which it reads with
// every new plan (that is how it learns, without a learning call of its own).
import type { SocialAgentOverview, SocialAgentSettings, SocialCorrectionDto } from '@b4/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { admin, errorMessage } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { SHARE_FORMAT, SHARE_TEMPLATE, formatDateTime } from '@/lib/labels';
import { Button, Card, ErrorBox, Field, LinkButton, Loading, inputClass, useToast } from '../ui';

type Choice = SocialCorrectionDto['agent'];
function choiceText(c: Choice): string {
  const frame = SHARE_TEMPLATE[c.template as keyof typeof SHARE_TEMPLATE]?.name ?? c.template;
  const out = c.formats.map((f) => SHARE_FORMAT[f as keyof typeof SHARE_FORMAT]?.name ?? f).join(' + ');
  return `${frame} · ${out || 'בלי פוסט'}${c.reel ? ' · ריל' : ''}`;
}

export function SocialAgent() {
  const qc = useQueryClient();
  const toast = useToast();
  const canEdit = useCan('editor');
  const overview = useQuery({ queryKey: ['agent', 'social'], queryFn: () => admin.get<SocialAgentOverview>('/agent/social') });
  const [form, setForm] = useState<SocialAgentSettings | null>(null);
  useEffect(() => {
    if (overview.data && !form) setForm(overview.data.settings);
  }, [overview.data, form]);
  const save = useMutation({
    mutationFn: (v: SocialAgentSettings) => admin.put<SocialAgentSettings>('/agent/social-settings', v),
    onSuccess: (v) => {
      setForm(v);
      void qc.invalidateQueries({ queryKey: ['agent', 'social'] });
      void qc.invalidateQueries({ queryKey: ['social-plans'] });
      toast('ההגדרות נשמרו. הן חלות על כל תוכנית חדשה.');
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });

  if (overview.isError) return <ErrorBox error={overview.error} onRetry={() => overview.refetch()} />;
  if (!form || !overview.data) return <Loading />;
  const d = overview.data;
  const dirty = JSON.stringify(form) !== JSON.stringify(d.settings);

  return (
    <div className="grid gap-6 xl:grid-cols-[1.1fr_1fr]">
      <Card title="הגדרות עורך הרשתות" actions={<LinkButton href="/social">לדוח תוכנית ההפצה</LinkButton>}>
        <p className="mb-4 text-sm text-muted">
          כשמסמנים טקסט של כתבה כסופי, עורך הרשתות מחליט איך היא עולה: מסגרת עיצוב (מבזק, משפט מפתח, מדריך או כותרת על תמונה), פוסט, סטורי, והאם מתאים ריל. הוא מכיר את כל האפשרויות של המערכת ואת החשבונות המחוברים, וכותב את הטקסטים. ההחלטה נכנסת לאותה קריאת AI שכותבת את הטקסטים, בלי קריאות נוספות.
        </p>
        <div className="space-y-5">
          <label className="flex items-start gap-2 text-[15px] font-semibold">
            <input type="checkbox" checked={form.autoPlan} disabled={!canEdit} onChange={(e) => setForm({ ...form, autoPlan: e.target.checked })} className="mt-1 size-4" />
            <span>
              להכין תוכנית הפצה לכל כתבה כשהטקסט מסומן כסופי
              <span className="block text-sm font-normal text-muted">כבוי: מכינים תוכנית רק כשלוחצים &quot;הכנת תוכנית&quot;.</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-[15px] font-semibold">
            <input type="checkbox" checked={form.autoPost} disabled={!canEdit} onChange={(e) => setForm({ ...form, autoPost: e.target.checked })} className="mt-1 size-4" />
            <span>
              לפרסם ברשתות לבד כשהכתבה עולה לאתר
              <span className="block text-sm font-normal text-muted">כבוי: התוכנית נשמרת בדף הרשתות, ומפרסמים משם ידנית.</span>
            </span>
          </label>
          <Field label="הנחיות קבועות לעורך הרשתות" htmlFor="sa-instructions" hint='למשל: "סטורי רק לחדשות של היום", "מבזק רק להחלטות של בנק ישראל"'>
            <textarea id="sa-instructions" rows={4} maxLength={3000} value={form.instructions} disabled={!canEdit} onChange={(e) => setForm({ ...form, instructions: e.target.value })} className={inputClass} />
          </Field>
          <Field label="מתי שווה ריל" htmlFor="sa-reel" hint='למשל: "רק לכתבות נדל"ן וצרכנות", "לא יותר מריל אחד ביום"'>
            <textarea id="sa-reel" rows={2} maxLength={1000} value={form.reelGuidance} disabled={!canEdit} onChange={(e) => setForm({ ...form, reelGuidance: e.target.value })} className={inputClass} />
          </Field>
          <div className="rounded-lg bg-info-soft px-4 py-3 text-sm text-info">
            <b>כלל קבוע (לא ניתן לכבות):</b> ריל עולה כסף, ולכן עורך הרשתות רק ממליץ עליו. ריל נוצר רק אחרי שמישהו אישר אותו בתוכנית, והסרטון עולה רק אחרי אישור נוסף.
          </div>
          {canEdit && (
            <div className="flex gap-2">
              <Button variant="primary" busy={save.isPending} disabled={!dirty} onClick={() => save.mutate(form)}>
                שמירת ההגדרות
              </Button>
              {dirty && (
                <Button variant="ghost" onClick={() => setForm(d.settings)}>
                  ביטול
                </Button>
              )}
            </div>
          )}
        </div>
      </Card>

      <Card title="ממה הוא לומד">
        <p className="mb-4 text-sm text-muted">
          כל פעם שמשנים לו בחירה (מסגרת, פוסט או סטורי, ריל), זה נשמר. כל תוכנית חדשה קוראת את השינויים האחרונים, והוא בוחר כמו שאתם בוחרים. ב-30 הימים האחרונים: {d.planned} תוכניות, {d.changed} מהן שיניתם.
        </p>
        {d.corrections.length === 0 ? (
          <p className="text-[15px] text-muted">עוד לא שיניתם אף תוכנית.</p>
        ) : (
          <ul className="space-y-2">
            {d.corrections.map((c) => (
              <li key={c.draftId} className="rounded-lg p-3 text-sm ring-1 ring-line">
                <p className="font-bold">{c.title}</p>
                <p className="mt-1 text-muted">הוא בחר: {choiceText(c.agent)}</p>
                <p className="text-ink-2">אתם בחרתם: {choiceText(c.editor)}</p>
                <p className="mt-1 text-xs text-muted">{formatDateTime(c.at)}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
