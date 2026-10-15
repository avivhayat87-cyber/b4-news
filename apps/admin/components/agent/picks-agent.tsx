'use client';
// The chief editor's picks after every discovery run (Israel and abroad): how many stories it
// recommends and which sections are leisure (fewer of those, but one each). Only an admin changes
// it (an AI call after every run).
import { CATEGORIES, type DiscoveryPickSettings } from '@b4/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { admin, errorMessage } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { Button, Field, LinkButton, Loading, cx, inputClass, useToast } from '../ui';

const SECTIONS = CATEGORIES.filter((c) => c.kind === 'topic');

export function PicksAgent() {
  const qc = useQueryClient();
  const toast = useToast();
  const isAdmin = useCan();
  const query = useQuery({ queryKey: ['agent', 'pick-settings'], queryFn: () => admin.get<DiscoveryPickSettings>('/agent/pick-settings') });
  const [form, setForm] = useState<DiscoveryPickSettings | null>(null);
  useEffect(() => {
    if (query.data && !form) setForm(query.data);
  }, [query.data, form]);
  const save = useMutation({
    mutationFn: (v: DiscoveryPickSettings) => admin.put<DiscoveryPickSettings>('/agent/pick-settings', v),
    onSuccess: (v) => {
      setForm(v);
      qc.setQueryData(['agent', 'pick-settings'], v);
      toast('ההגדרות נשמרו.');
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  if (!form) return <Loading />;
  const dirty = JSON.stringify(form) !== JSON.stringify(query.data);
  const toggleLeisure = (slug: DiscoveryPickSettings['leisure'][number]) =>
    setForm({ ...form, leisure: form.leisure.includes(slug) ? form.leisure.filter((s) => s !== slug) : [...form.leisure, slug] });

  return (
    <div className="space-y-5">
      <h3 className="font-bold">המלצות בכל איתור</h3>
      <label className="flex items-start gap-2 text-[15px] font-semibold">
        <input type="checkbox" checked={form.on} disabled={!isAdmin} onChange={(e) => setForm({ ...form, on: e.target.checked })} className="mt-1 size-4" />
        <span>
          להמליץ על כתבות בסוף כל איתור
          <span className="block text-sm font-normal text-muted">
            בסוף כל איתור, בישראל ומחו״ל, העורך הראשי קורא את הסיפורים שנמצאו ומסמן בכוכב את מה שכדאי לקחת קודם, עם ציון חשיבות וסיבה. תמיד לפחות סיפור אחד מכל מדור שיש בו כתבות. בדף האיתור יש כפתור &quot;מומלצים&quot; שמציג רק אותם, ואפשר לסמן ידנית כל כתבה אחרת.
          </span>
        </span>
      </label>
      <Field label="כמה המלצות בכל איתור" htmlFor="pk-count" hint="בין 5 ל-60. אם יש יותר מדורים מהמספר, כל מדור עדיין מקבל אחת.">
        <input
          id="pk-count"
          type="number"
          min={5}
          max={60}
          disabled={!isAdmin || !form.on}
          value={form.count}
          onChange={(e) => setForm({ ...form, count: Math.min(60, Math.max(5, Number(e.target.value) || 5)) })}
          className={cx(inputClass, 'max-w-32')}
        />
      </Field>
      <fieldset>
        <legend className="mb-2 text-sm font-bold text-ink-2">מדורי פנאי (פחות המלצות מהם, אבל לפחות אחת מכל אחד)</legend>
        <div className="flex flex-wrap gap-2">
          {SECTIONS.map((c) => {
            const on = form.leisure.includes(c.slug);
            return (
              <button
                key={c.slug}
                type="button"
                aria-pressed={on}
                disabled={!isAdmin || !form.on}
                onClick={() => toggleLeisure(c.slug)}
                className={cx('rounded-full px-3 py-1 text-sm font-semibold ring-1 disabled:cursor-not-allowed', on ? 'bg-ink text-white ring-ink' : 'bg-white text-ink-2 ring-line hover:ring-ink')}
              >
                {c.name}
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="rounded-lg bg-info-soft px-4 py-3 text-sm text-info">
        העלות: קריאה אחת למודל המהיר בסוף כל איתור, בערך 1–2 סנט. מה הוא מחפש ואיך הוא מחליט נקבע בסקיל &quot;המלצות באיתור&quot;, בלשונית הסקיל.
      </div>
      <div className="flex flex-wrap gap-2">
        {isAdmin && (
          <Button variant="primary" busy={save.isPending} disabled={!dirty} onClick={() => save.mutate(form)}>
            שמירת ההגדרות
          </Button>
        )}
        <LinkButton href="/discovery">לאיתור הכתבות</LinkButton>
      </div>
      {!isAdmin && <p className="text-sm text-muted">רק מנהל/ת מערכת יכול/ה לשנות את ההגדרות האלה.</p>}
    </div>
  );
}
