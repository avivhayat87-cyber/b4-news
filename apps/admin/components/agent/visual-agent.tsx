'use client';
// The visual agent (Google): the newsroom's settings for image descriptions and reel prompts,
// the rules it learned from the editors' choices (versions, manual edit, restore), and the
// cases it learns from.
import type { VisualAgentOverview, VisualAgentSettings } from '@b4/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { admin, errorMessage } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { VISUAL_CASE, VISUAL_CASE_STATUS, formatDateTime } from '@/lib/labels';
import { Badge, Button, Card, ErrorBox, Field, Loading, inputClass, useToast } from '../ui';

export function VisualAgent() {
  const qc = useQueryClient();
  const toast = useToast();
  const canEdit = useCan('editor');
  const isAdmin = useCan();
  const settings = useQuery({ queryKey: ['agent', 'visual-settings'], queryFn: () => admin.get<VisualAgentSettings>('/agent/visual-settings') });
  const overview = useQuery({
    queryKey: ['agent', 'visual'],
    queryFn: () => admin.get<VisualAgentOverview>('/agent/visual'),
    refetchInterval: (q) => (q.state.data?.learning ? 2500 : false),
  });
  const [form, setForm] = useState<VisualAgentSettings | null>(null);
  const [rules, setRules] = useState<string | null>(null);
  useEffect(() => {
    if (settings.data && !form) setForm(settings.data);
  }, [settings.data, form]);

  const refresh = () => void qc.invalidateQueries({ queryKey: ['agent', 'visual'] });
  const onError = (e: unknown) => toast(errorMessage(e), 'danger');
  const save = useMutation({
    mutationFn: (v: VisualAgentSettings) => admin.put<VisualAgentSettings>('/agent/visual-settings', v),
    onSuccess: (v) => {
      setForm(v);
      qc.setQueryData(['agent', 'visual-settings'], v);
      toast('ההגדרות נשמרו. הן חלות על כל תיאור והנחיה שהסוכן כותב מעכשיו.');
    },
    onError,
  });
  const learn = useMutation({ mutationFn: () => admin.post('/agent/visual/learn'), onSuccess: refresh, onError });
  const activate = useMutation({ mutationFn: (id: number) => admin.post(`/agent/visual/profiles/${id}/activate`), onSuccess: refresh, onError });
  const saveRules = useMutation({
    mutationFn: (r: string) => admin.put('/agent/visual/rules', { rules: r }),
    onSuccess: () => {
      setRules(null);
      toast('הכללים נשמרו כגרסה חדשה.');
      refresh();
    },
    onError,
  });

  if (overview.isError) return <ErrorBox error={overview.error} onRetry={() => overview.refetch()} />;
  if (!form || !overview.data) return <Loading />;
  const d = overview.data;
  const active = d.profiles.find((p) => p.isActive);
  const dirty = JSON.stringify(form) !== JSON.stringify(settings.data);

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_1.1fr]">
      <Card title="הגדרות סוכן התמונות" actions={<Badge tone={d.live ? 'ok' : 'warn'}>{d.live ? `Gemini: ${d.model}` : 'מצב הדגמה'}</Badge>}>
        <p className="mb-4 text-sm text-muted">
          הסוכן של Google כותב בעברית את התיאור לתמונה של כל כתבה ואת שתי ההנחיות לריל (תמונה וסרטון). אתם רואים ומתקנים כל תיאור לפני שמשהו נוצר, והוא לומד מהבחירות שלכם.
        </p>
        <div className="space-y-5">
          <Field label="סגנון לתמונות כתבה" htmlFor="va-article" hint="למשל: צילום עיתונאי ריאליסטי, אור טבעי, מקומות אמיתיים בישראל">
            <input id="va-article" value={form.articleStyle} maxLength={500} disabled={!canEdit} onChange={(e) => setForm({ ...form, articleStyle: e.target.value })} className={inputClass} />
          </Field>
          <Field label="סגנון לריל" htmlFor="va-reel" hint="למשל: תנועת מצלמה איטית, אווירה רצינית, צבעים חמים">
            <input id="va-reel" value={form.reelStyle} maxLength={500} disabled={!canEdit} onChange={(e) => setForm({ ...form, reelStyle: e.target.value })} className={inputClass} />
          </Field>
          <Field label="הנחיות קבועות" htmlFor="va-instructions" hint="כל מה שהסוכן צריך לזכור בכל תיאור">
            <textarea id="va-instructions" rows={4} value={form.instructions} maxLength={3000} disabled={!canEdit} onChange={(e) => setForm({ ...form, instructions: e.target.value })} className={inputClass} />
          </Field>
          <Field label="מה אסור" htmlFor="va-avoid" hint="למשל: גרפים וחיצים, קופות חיסכון, לחיצות ידיים">
            <input id="va-avoid" value={form.avoid} maxLength={1000} disabled={!canEdit} onChange={(e) => setForm({ ...form, avoid: e.target.value })} className={inputClass} />
          </Field>
          <label className="flex items-center gap-2 text-[15px] font-semibold">
            <input type="checkbox" checked={form.autoLearn} disabled={!canEdit} onChange={(e) => setForm({ ...form, autoLearn: e.target.checked })} className="size-4" />
            ללמוד לבד כל {d.learnEvery} מקרים חדשים
          </label>
          <div className="rounded-lg bg-info-soft px-4 py-3 text-sm text-info">
            <b>כללים קבועים (לא ניתן לכבות):</b> בלי טקסט, לוגו או סימני מים בתמונה, בלי אנשים אמיתיים שאפשר לזהות, ותמונת המקור משמשת רק להשראה, אף פעם לא להעתקה.
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

      <div className="space-y-6">
        <Card
          title="מה הסוכן למד"
          actions={
            <div className="flex gap-2">
              {isAdmin && rules === null && (
                <Button size="sm" variant="ghost" onClick={() => setRules(active?.rules ?? '')}>
                  עריכה ידנית
                </Button>
              )}
              {canEdit && (
                <Button size="sm" variant="primary" busy={learn.isPending || d.learning} disabled={d.pending === 0} onClick={() => learn.mutate()}>
                  ללמוד עכשיו מ-{d.pending} מקרים
                </Button>
              )}
            </div>
          }
        >
          <p className="mb-4 text-sm text-muted">
            בכל פרסום הסוכן רושם איך נוצרה התמונה הראשית: מה הוא הציע, מה שיניתם, איזו תמונה בחרתם ואילו דילגתם. גם כל ריל שאישרתם נרשם. כל {d.learnEvery} מקרים Gemini קורא את כולם בקריאה אחת, מסתכל על התמונות, ומעדכן את הכללים שלו.
          </p>
          <div className="mb-4 flex gap-6 text-sm">
            <span>
              <b className="font-display text-2xl font-extrabold">{d.pending}</b> ממתינים ללמידה
            </span>
            <span>
              <b className="font-display text-2xl font-extrabold">{d.learned}</b> נלמדו
            </span>
          </div>
          {d.lastError && (
            <p className="mb-4 rounded-lg bg-brand-soft px-3 py-2.5 text-sm text-brand-deep" role="alert">
              הלמידה האחרונה נכשלה: {d.lastError}
            </p>
          )}
          {rules !== null ? (
            <div className="space-y-2">
              <textarea rows={12} value={rules} onChange={(e) => setRules(e.target.value)} className={inputClass} />
              <div className="flex gap-2">
                <Button variant="dark" busy={saveRules.isPending} disabled={!rules.trim()} onClick={() => saveRules.mutate(rules)}>
                  שמירה כגרסה חדשה
                </Button>
                <Button variant="ghost" onClick={() => setRules(null)}>
                  ביטול
                </Button>
              </div>
            </div>
          ) : active ? (
            <pre className="whitespace-pre-wrap font-sans text-[15px] leading-relaxed">{active.rules}</pre>
          ) : (
            <p className="text-muted">עוד אין כללים נלמדים. הם ייווצרו אחרי כמה כתבות ורילים שתפרסמו.</p>
          )}
          {d.profiles.length > 0 && (
            <div className="mt-5 border-t border-line-soft pt-4">
              <p className="mb-2 text-sm font-bold text-ink-2">גרסאות</p>
              <ul className="space-y-3">
                {d.profiles.map((p) => (
                  <li key={p.id} className="rounded-lg p-3 ring-1 ring-line">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-bold">{formatDateTime(p.createdAt)}</span>
                      <span className="text-muted">{p.feedbackCount ? `נלמד מ-${p.feedbackCount} מקרים` : `נכתב ידנית${p.approvedBy ? ` · ${p.approvedBy}` : ''}`}</span>
                      {p.isActive ? (
                        <Badge tone="ok">פעילה</Badge>
                      ) : (
                        isAdmin && (
                          <Button size="sm" variant="ghost" busy={activate.isPending && activate.variables === p.id} onClick={() => activate.mutate(p.id)}>
                            שחזור
                          </Button>
                        )
                      )}
                    </div>
                    {p.summary && <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-ink-2">{p.summary}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <Card title="מקרים אחרונים">
          {d.recent.length === 0 ? (
            <p className="text-muted">עוד אין מקרים. הם נרשמים כשמפרסמים כתבה עם תמונת AI וכשמאשרים ריל.</p>
          ) : (
            <ul className="divide-y divide-line-soft">
              {d.recent.map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-2.5">
                  <Badge tone="info">{VISUAL_CASE[r.kind]}</Badge>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{r.title}</p>
                    <p className="text-xs text-muted">{formatDateTime(r.createdAt)}</p>
                  </div>
                  <Badge tone={VISUAL_CASE_STATUS[r.status].tone}>{VISUAL_CASE_STATUS[r.status].label}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
