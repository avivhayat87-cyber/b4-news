'use client';
// The research reporter's settings: the month's budget, the default depth, the sources that may
// back a fact besides the official ones, and the screenshots kept as proof. Only an admin changes them.
import { NEWS_DOMAINS, OFFICIAL_DOMAINS, RESEARCH_DEPTHS, type ResearchOverviewDto, type ResearcherSettings } from '@b4/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { admin, errorMessage } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { RESEARCH_DEPTH } from '@/lib/labels';
import { Button, Field, LinkButton, Loading, inputClass, useToast } from '../ui';
import { OfficialSources } from './official-sources';

export function ResearcherAgent() {
  const qc = useQueryClient();
  const toast = useToast();
  const isAdmin = useCan();
  const query = useQuery({ queryKey: ['agent', 'researcher-settings'], queryFn: () => admin.get<ResearcherSettings>('/agent/researcher-settings') });
  const overview = useQuery({ queryKey: ['research'], queryFn: () => admin.get<ResearchOverviewDto>('/research') });
  const [form, setForm] = useState<ResearcherSettings | null>(null);
  const [showLists, setShowLists] = useState(false);
  useEffect(() => {
    if (query.data && !form) setForm(query.data);
  }, [query.data, form]);
  const save = useMutation({
    mutationFn: (v: ResearcherSettings) => admin.put<ResearcherSettings>('/agent/researcher-settings', v),
    onSuccess: (v) => {
      setForm(v);
      qc.setQueryData(['agent', 'researcher-settings'], v);
      void qc.invalidateQueries({ queryKey: ['research'] });
      toast('ההגדרות נשמרו.');
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  if (!form) return <Loading />;
  const dirty = JSON.stringify(form) !== JSON.stringify(query.data);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="תקציב חודשי לתחקירים (דולר)" htmlFor="rs-budget" hint={overview.data ? `החודש: $${overview.data.spentUsd.toFixed(2)}. כשהתקציב נגמר, תחקיר חדש לא מתחיל עד החודש הבא.` : undefined}>
          <input
            id="rs-budget"
            type="number"
            min={0}
            max={5000}
            step={5}
            dir="ltr"
            disabled={!isAdmin}
            value={form.monthlyBudgetUsd}
            onChange={(e) => setForm({ ...form, monthlyBudgetUsd: Number(e.target.value) })}
            className={inputClass}
          />
        </Field>
        <Field label="עומק ברירת המחדל" htmlFor="rs-depth" hint="אפשר לבחור אחר בכל תחקיר.">
          <select id="rs-depth" disabled={!isAdmin} value={form.defaultDepth} onChange={(e) => setForm({ ...form, defaultDepth: e.target.value as ResearcherSettings['defaultDepth'] })} className={inputClass}>
            {RESEARCH_DEPTHS.map((d) => (
              <option key={d} value={d}>
                {RESEARCH_DEPTH[d].name} · {RESEARCH_DEPTH[d].cost}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field
        label="מקורות מאושרים נוספים (רשימה חופשית)"
        htmlFor="rs-sources"
        hint="שורה לכל מקור: אתר (למשל example.co.il) או כתובת של חשבון ברשת (למשל x.com/bank_of_israel). פוסט ברשת חברתית מבסס עובדה רק מחשבון שברשימה."
      >
        <textarea
          id="rs-sources"
          rows={5}
          dir="ltr"
          disabled={!isAdmin}
          value={form.approvedSources}
          onChange={(e) => setForm({ ...form, approvedSources: e.target.value })}
          placeholder={'x.com/bank_of_israel\nt.me/some_official_channel'}
          className={inputClass}
        />
      </Field>
      <button type="button" onClick={() => setShowLists((v) => !v)} className="text-sm font-bold text-info underline">
        {showLists ? 'הסתרת הרשימות הקבועות' : 'אילו אתרים רשמיים תמיד, ואילו אתרי חדשות אף פעם'}
      </button>
      {showLists && (
        <div className="grid gap-3 text-xs sm:grid-cols-2">
          <div className="rounded-lg bg-ok-soft p-3">
            <p className="mb-1 font-bold text-ok">רשמיים תמיד (כולל כל תת-אתר)</p>
            <p dir="ltr" className="leading-relaxed text-ink-2">{OFFICIAL_DOMAINS.join(' · ')}</p>
            <p className="mt-1 text-muted">ובנוסף: האתר או החשבון הרשמי של החברה או האדם שהכתבה עוסקת בהם.</p>
          </div>
          <div className="rounded-lg bg-warn-soft p-3">
            <p className="mb-1 font-bold text-warn">אתרי חדשות: רק רמז למקור, אף פעם לא המקור</p>
            <p dir="ltr" className="leading-relaxed text-ink-2">{NEWS_DOMAINS.join(' · ')}</p>
          </div>
        </div>
      )}

      <div className="border-y border-line-soft py-5">
        <OfficialSources />
      </div>

      <label className="flex items-start gap-2 text-[15px] font-semibold">
        <input type="checkbox" checked={form.screenshots} disabled={!isAdmin} onChange={(e) => setForm({ ...form, screenshots: e.target.checked })} className="mt-1 size-4" />
        <span>
          לשמור צילום של כל עמוד מקור כהוכחה
          <span className="block text-sm font-normal text-muted">בנוסף לעותק של הטקסט. נשמר בתיק התחקיר בעורך, למקרה שהעמוד ישתנה או יימחק. לא עולה כסף.</span>
        </span>
      </label>

      <div className="rounded-lg bg-info-soft px-4 py-3 text-sm text-info">
        העלות: חיפוש באינטרנט עולה סנט, ועוד הקריאה של העמודים. תחקיר מהיר, כולל כתיבת הכתבה, בערך 10–30 סנט; מעמיק עד 1–3 דולר. כשלא נמצא מקור רשמי, הכתב-החוקר מקבל סבב אחד נוסף לחפש אותו, בתוך מגבלת החיפושים.
      </div>
      <div className="flex flex-wrap gap-2">
        {isAdmin && (
          <Button variant="primary" busy={save.isPending} disabled={!dirty} onClick={() => save.mutate(form)}>
            שמירת ההגדרות
          </Button>
        )}
        <LinkButton href="/manual">לתחקיר חדש</LinkButton>
      </div>
      {!isAdmin && <p className="text-sm text-muted">רק מנהל/ת מערכת יכול/ה לשנות את ההגדרות האלה.</p>}
    </div>
  );
}
