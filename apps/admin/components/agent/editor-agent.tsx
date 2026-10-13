'use client';
// The editor agent: how far the AI writer moves from the source, length, voice
// and standing instructions; the fixed facts rule; and what it learned from
// each publish batch.
import { ARTICLE_LENGTHS, DIVERGENCE, type EditorAgentSettings, type LearningReportDto } from '@b4/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { admin, errorMessage } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { ARTICLE_LENGTH as LENGTH, DIVERGENCE_LABEL, formatDateTime } from '@/lib/labels';
import { Badge, Button, Card, Field, Loading, LinkButton, cx, inputClass, useToast } from '../ui';

export function EditorAgent() {
  const qc = useQueryClient();
  const toast = useToast();
  const canEdit = useCan('editor');
  const settings = useQuery({ queryKey: ['agent', 'editor-settings'], queryFn: () => admin.get<EditorAgentSettings>('/agent/editor-settings') });
  const reports = useQuery({ queryKey: ['agent', 'learning-reports'], queryFn: () => admin.get<LearningReportDto[]>('/agent/learning-reports') });
  const [form, setForm] = useState<EditorAgentSettings | null>(null);
  useEffect(() => {
    if (settings.data && !form) setForm(settings.data);
  }, [settings.data, form]);
  const save = useMutation({
    mutationFn: (v: EditorAgentSettings) => admin.put<EditorAgentSettings>('/agent/editor-settings', v),
    onSuccess: (v) => {
      setForm(v);
      qc.setQueryData(['agent', 'editor-settings'], v);
      toast('ההגדרות נשמרו. הן חלות על כל כתבה חדשה שה-AI כותב.');
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });

  if (!form) return <Loading />;
  const dirty = JSON.stringify(form) !== JSON.stringify(settings.data);

  return (
    <div className="grid gap-6 xl:grid-cols-[1.1fr_1fr]">
      <Card title="הגדרות סוכן העריכה" actions={<LinkButton href="/learning">הכללים שנלמדו</LinkButton>}>
        <div className="space-y-5">
          <fieldset>
            <legend className="mb-2 text-sm font-bold text-ink-2">כמה להתרחק מהמקור</legend>
            <div className="grid gap-2 sm:grid-cols-3" role="radiogroup">
              {DIVERGENCE.map((d) => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={form.divergence === d}
                  disabled={!canEdit}
                  onClick={() => setForm({ ...form, divergence: d })}
                  className={cx('rounded-xl p-3 text-right ring-1 transition', form.divergence === d ? 'bg-brand-soft ring-2 ring-brand' : 'ring-line hover:ring-ink')}
                >
                  <span className="block font-extrabold">{DIVERGENCE_LABEL[d].name}</span>
                  <span className="mt-0.5 block text-xs text-muted">{DIVERGENCE_LABEL[d].description}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <Field label="אורך הכתבה" htmlFor="ea-length">
            <select id="ea-length" value={form.length} disabled={!canEdit} onChange={(e) => setForm({ ...form, length: e.target.value as EditorAgentSettings['length'] })} className={inputClass}>
              {ARTICLE_LENGTHS.map((l) => (
                <option key={l} value={l}>
                  {LENGTH[l]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="קול וסגנון" htmlFor="ea-tone" hint="במילים שלכם, למשל: עניני וישיר, פונה לקורא, בלי סופרלטיבים">
            <input id="ea-tone" value={form.tone} maxLength={300} disabled={!canEdit} onChange={(e) => setForm({ ...form, tone: e.target.value })} className={inputClass} />
          </Field>
          <Field label="הנחיות קבועות לעורך" htmlFor="ea-instructions" hint="כל מה שה-AI צריך לזכור בכל כתבה (מבנה, מונחים, מה להדגיש)">
            <textarea id="ea-instructions" rows={5} value={form.instructions} maxLength={3000} disabled={!canEdit} onChange={(e) => setForm({ ...form, instructions: e.target.value })} className={inputClass} />
          </Field>

          <div className="rounded-lg bg-info-soft px-4 py-3 text-sm text-info">
            <b>כלל קבוע (לא ניתן לכבות):</b> כל הנתונים העובדתיים של המקור נשארים בכתבה בדיוק כפי שהם: מספרים, אחוזים, סכומים, תאריכים, שמות וציטוטים מיוחסים, גם כשהניסוח והזווית משתנים לגמרי. בדיקת נתונים אוטומטית משווה כל כתבה למקור שלה ומסמנת נתון שחסר או נתון שלא מופיע במקור.
          </div>

          {canEdit && (
            <div className="flex gap-2">
              <Button variant="primary" busy={save.isPending} disabled={!dirty} onClick={() => save.mutate(form)}>
                שמירת ההגדרות
              </Button>
              {dirty && (
                <Button variant="ghost" onClick={() => setForm(settings.data!)}>
                  ביטול
                </Button>
              )}
            </div>
          )}
        </div>
      </Card>

      <Card title="מה הסוכן למד (דוח לכל קבוצת פרסום)">
        <p className="mb-4 text-sm text-muted">
          אחרי כל פרסום, כל הכתבות שעלו יחד נקראות בקריאה אחת: קטע מהמקור, מה העורכים שינו בטיוטה של ה-AI, ואיזו תמונה נבחרה. הסוכן מעדכן מזה את כללי הסגנון שלו וכותב כאן מה למד. כך לא שורפים טוקנים על כל כתבה בנפרד.
        </p>
        {reports.isPending ? (
          <Loading />
        ) : !reports.data?.length ? (
          <p className="text-[15px] text-muted">עוד אין דוחות. הדוח הראשון ייכתב אחרי הפרסום הבא.</p>
        ) : (
          <ul className="space-y-3">
            {reports.data.map((r) => (
              <li key={r.id} className="rounded-lg p-3 ring-1 ring-line">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-bold">{formatDateTime(r.createdAt)}</span>
                  <Badge tone={r.status === 'succeeded' ? 'ok' : r.status === 'skipped' ? 'muted' : 'danger'}>{r.status === 'succeeded' ? `נלמד מ-${r.articleCount} כתבות` : r.status === 'skipped' ? 'לא היה ממה ללמוד' : 'נכשל'}</Badge>
                  {r.inputTokens ? <span className="text-xs text-muted">{r.inputTokens.toLocaleString('he-IL')} טוקנים בקריאה אחת</span> : null}
                </div>
                {r.summary && <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-ink-2">{r.summary}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
