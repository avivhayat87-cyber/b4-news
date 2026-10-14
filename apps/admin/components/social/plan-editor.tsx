'use client';
// One article's distribution plan: what the social editor chose and why, the designs as they will
// go out, the texts, and the reel. Shown in the editor's social tab and next to the report on the
// social page. Once the article is published, the plan lives on the social page.
import { REEL_DURATIONS, SHARE_LIMITS, type MediaDto, type SocialPlanDto } from '@b4/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { admin, errorMessage } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { PLAN_STATE, PLATFORM, REEL_STAGE, SHARE_FORMAT, SHARE_TEMPLATE, SOCIAL_POST_STATUS as POST_STATUS } from '@/lib/labels';
import { UploadButton } from '../image-upload';
import { Badge, Button, ErrorBox, Field, Loading, Spinner, cx, inputClass } from '../ui';
import { FormatToggles, type PlanPatch, ReelChoice, usePlanUpdate } from './plan-controls';
import { Preview, TemplatePicker } from './share-editor';

type Texts = { kicker: string; headline: string; hook: string; caption: string; hashtags: string };
const textsOf = (p: SocialPlanDto): Texts => ({ kicker: p.kicker, headline: p.headline, hook: p.hook, caption: p.caption, hashtags: p.hashtags.map((h) => `#${h}`).join(' ') });
const parseTags = (text: string) =>
  text
    .split(/[\s,]+/)
    .map((t) => t.replace(/^#+/, '').trim())
    .filter(Boolean)
    .slice(0, SHARE_LIMITS.hashtags);

function Reason({ children }: { children: string }) {
  return children ? <p className="mt-1 text-xs text-muted">עורך הרשתות: {children}</p> : null;
}

export function PlanEditor({ draftId }: { draftId: string }) {
  const qc = useQueryClient();
  const canEdit = useCan('editor');
  const key = ['social-plan', draftId];
  const query = useQuery({
    queryKey: key,
    queryFn: () => admin.get<SocialPlanDto>(`/drafts/${draftId}/social-plan`),
    refetchInterval: (q) => (q.state.data?.state === 'writing' ? 2000 : false),
  });
  const update = usePlanUpdate();
  const [texts, setTexts] = useState<Texts | null>(null);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState('');
  const [idea, setIdea] = useState<string | null>(null);

  // A new version (the AI's, or a quick change in the report) shows at once, unless the editor is in the middle of changing the texts.
  const p = query.data;
  useEffect(() => {
    if (p && !editing) setTexts(textsOf(p));
  }, [p, editing]);

  const regenerate = useMutation({
    mutationFn: () => admin.post(`/drafts/${draftId}/social-plan/regenerate`, { instruction: note.trim() || undefined }),
    onSuccess: () => {
      setNote('');
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ['social-plans'] });
    },
  });

  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorBox error={query.error} onRetry={() => query.refetch()} />;
  const plan = query.data;
  const change = (patch: PlanPatch) => update.mutate({ plan, patch });
  const busy = plan.state === 'writing' || regenerate.isPending;
  const locked = !canEdit || busy || update.isPending;

  if (plan.state === 'published') {
    return (
      <div className="space-y-3">
        <Badge tone={PLAN_STATE.published.tone}>{PLAN_STATE.published.label}</Badge>
        <p className="text-[15px] text-ink-2">הכתבה עלתה לאתר והתוכנית יצאה לדרך. מכאן ממשיכים בדף &quot;רשתות חברתיות&quot;: עריכה, פרסום חוזר והריל.</p>
        {plan.reelStage && <Badge tone={REEL_STAGE[plan.reelStage].tone}>ריל: {REEL_STAGE[plan.reelStage].label}</Badge>}
        {plan.posts.length > 0 && (
          <ul className="space-y-1 text-sm">
            {plan.posts.map((x) => (
              <li key={`${x.accountId}-${x.format}`} className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{PLATFORM[x.platform]}</span>
                <span className="text-muted">{x.format === 'message' ? 'הודעה' : SHARE_FORMAT[x.format].name}</span>
                <Badge tone={POST_STATUS[x.status]?.tone}>{POST_STATUS[x.status]?.label ?? x.status}</Badge>
              </li>
            ))}
          </ul>
        )}
        {plan.articleId && (
          <Link href={`/social?article=${plan.articleId}`} className="inline-block font-semibold text-brand hover:underline">
            לכתבה בדף הרשתות ←
          </Link>
        )}
      </div>
    );
  }

  if (plan.state === 'none' || plan.state === 'failed' || (plan.state === 'writing' && !plan.headline)) {
    return (
      <div className="space-y-3 rounded-xl bg-stone p-5">
        <p className="font-display text-lg font-extrabold">תוכנית הפצה ברשתות</p>
        <p className="text-[15px] text-ink-2">עורך הרשתות בוחר מסגרת עיצוב, מחליט אם להעלות פוסט, סטורי וריל, וכותב את הטקסטים. כשהכתבה מתפרסמת, התוכנית עולה לרשתות לבד.</p>
        {plan.error && <p className="text-sm font-semibold text-brand">{plan.error}</p>}
        {busy ? (
          <p className="flex items-center gap-2 text-sm font-semibold text-info" role="status">
            <Spinner small /> עורך הרשתות כותב את התוכנית…
          </p>
        ) : (
          canEdit && (
            <Button variant="primary" onClick={() => regenerate.mutate()}>
              {plan.state === 'failed' ? 'ניסיון נוסף' : 'הכנת תוכנית הפצה'}
            </Button>
          )
        )}
      </div>
    );
  }

  const t = texts ?? textsOf(plan);
  const setText = (patch: Partial<Texts>) => {
    setEditing(true);
    setTexts({ ...t, ...patch });
  };
  const tooLong = t.kicker.length > SHARE_LIMITS.kicker || t.headline.length > SHARE_LIMITS.headline || t.hook.length > SHARE_LIMITS.hook || t.caption.length > SHARE_LIMITS.caption;
  const stills = plan.formats.filter((f) => f !== 'reel');

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={PLAN_STATE[plan.state].tone}>{PLAN_STATE[plan.state].label}</Badge>
        {busy && (
          <span className="flex items-center gap-1 text-sm font-semibold text-info" role="status">
            <Spinner small /> עורך הרשתות כותב…
          </span>
        )}
        <label className="mr-auto flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={plan.enabled} disabled={locked} onChange={(e) => change({ enabled: e.target.checked })} className="size-4" />
          לפרסם ברשתות עם הכתבה
        </label>
      </div>
      {plan.state === 'stale' && (
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm font-semibold text-warn">הטקסט של הכתבה נפתח לעריכה אחרי שהתוכנית נכתבה. כשתסמנו אותו שוב כסופי, הטקסטים ייכתבו מחדש (הבחירות שלכם נשמרות).</p>
      )}
      {plan.error && <p className="text-sm font-semibold text-brand">{plan.error}</p>}

      <section>
        <p className="mb-2 text-sm font-bold text-ink-2">מסגרת עיצוב</p>
        <TemplatePicker value={plan.template} onChange={(template) => change({ template })} disabled={locked} />
        {plan.aiChoice && plan.aiChoice.template !== plan.template ? (
          <p className="mt-1 text-xs text-muted">עורך הרשתות בחר &quot;{SHARE_TEMPLATE[plan.aiChoice.template].name}&quot;. הבחירה שלכם נשמרת, והוא לומד ממנה.</p>
        ) : (
          <Reason>{plan.reasons.template}</Reason>
        )}
      </section>

      <section>
        <p className="mb-2 text-sm font-bold text-ink-2">מה עולה</p>
        <FormatToggles plan={plan} disabled={locked} onChange={change} />
        <Reason>{plan.reasons.formats}</Reason>
      </section>

      {stills.length > 0 && (
        <div className={cx('grid items-start gap-3', stills.length === 2 ? 'grid-cols-[1.35fr_1fr]' : 'max-w-xs grid-cols-[minmax(0,1fr)]')}>
          {stills.includes('feed') && <Preview src={plan.rendered.feed} ratio="aspect-[4/5]" label="פוסט 4:5" busy={busy || update.isPending} />}
          {stills.includes('story') && <Preview src={plan.rendered.story} ratio="aspect-[9/16]" label="סטורי 9:16" busy={busy || update.isPending} />}
        </div>
      )}

      <section className="rounded-lg p-3 ring-1 ring-line">
        <p className="mb-2 text-sm font-bold text-ink-2">ריל</p>
        <ReelChoice plan={plan} disabled={locked} onChange={change} detailed />
        {(plan.formats.includes('reel') || plan.reel?.recommended) && canEdit && (
          <div className="mt-3 space-y-2">
            <Field label="מה רואים בריל" htmlFor="pl-idea" hint="סוכן התמונות כותב מזה את ההנחיות לתמונה ולסרטון">
              <textarea id="pl-idea" rows={2} maxLength={600} value={idea ?? plan.reel?.idea ?? ''} disabled={locked} onChange={(e) => setIdea(e.target.value)} className={inputClass} />
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-bold text-ink-2">אורך:</span>
              {REEL_DURATIONS.map((d) => (
                <button key={d} type="button" disabled={locked} onClick={() => change({ reelSeconds: d })} className={cx('rounded-full px-3 py-1 text-xs font-bold ring-1', plan.reel?.durationSeconds === d ? 'bg-ink text-white ring-ink' : 'ring-line')}>
                  {d} שניות
                </button>
              ))}
              {idea !== null && idea !== (plan.reel?.idea ?? '') && (
                <Button size="sm" variant="dark" className="mr-auto" disabled={locked} onClick={() => change({ reelIdea: idea })}>
                  שמירת הרעיון
                </Button>
              )}
            </div>
            <p className="text-xs text-muted">אחרי הפרסום הריל נבנה לבד: תמונה, ואז סרטון. הסרטון מחכה לאישור שלכם בדף הרשתות, ורק אז עולה.</p>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="grid grid-cols-[1fr_2fr] gap-3">
          <Field label="תווית" htmlFor="pl-kicker">
            <input id="pl-kicker" value={t.kicker} disabled={locked} onChange={(e) => setText({ kicker: e.target.value })} className={inputClass} />
          </Field>
          <Field label="האשטגים" htmlFor="pl-tags" hint="עד 5, מופרדים ברווח">
            <input id="pl-tags" value={t.hashtags} disabled={locked} onChange={(e) => setText({ hashtags: e.target.value })} className={inputClass} dir="auto" />
          </Field>
        </div>
        <Field label="כותרת על התמונה" htmlFor="pl-headline" error={t.headline.length > SHARE_LIMITS.headline ? `עד ${SHARE_LIMITS.headline} תווים` : null}>
          <textarea id="pl-headline" rows={2} value={t.headline} disabled={locked} onChange={(e) => setText({ headline: e.target.value })} className={cx(inputClass, 'font-bold')} />
        </Field>
        <Field label="משפט פתיחה" htmlFor="pl-hook" error={t.hook.length > SHARE_LIMITS.hook ? `עד ${SHARE_LIMITS.hook} תווים` : null}>
          <textarea id="pl-hook" rows={2} value={t.hook} disabled={locked} onChange={(e) => setText({ hook: e.target.value })} className={inputClass} />
        </Field>
        <Field label="טקסט הפוסט" htmlFor="pl-caption" error={t.caption.length > SHARE_LIMITS.caption ? `עד ${SHARE_LIMITS.caption} תווים` : null}>
          <textarea id="pl-caption" rows={3} value={t.caption} disabled={locked} onChange={(e) => setText({ caption: e.target.value })} className={inputClass} />
        </Field>
        {editing && canEdit && (
          <div className="flex gap-2">
            <Button
              variant="dark"
              busy={update.isPending}
              disabled={tooLong || !t.headline.trim()}
              onClick={() => update.mutate({ plan, patch: { kicker: t.kicker, headline: t.headline, hook: t.hook, caption: t.caption, hashtags: parseTags(t.hashtags) } }, { onSuccess: () => setEditing(false) })}
            >
              שמירת הטקסטים
            </Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              ביטול
            </Button>
          </div>
        )}
      </section>

      {canEdit && (
        <section className="flex flex-wrap items-center gap-2 rounded-lg bg-stone px-3 py-2.5 text-sm">
          <span className="font-bold text-ink-2">תמונת רקע:</span>
          <span className="text-ink-2">{plan.image ? 'תמונה שהועלתה' : 'התמונה הראשית של הכתבה'}</span>
          <span className="mr-auto flex gap-1.5">
            <UploadButton variant="ghost" label="החלפה" onUploaded={(m: MediaDto) => change({ imageMediaId: m.id })} />
            {plan.image && (
              <Button size="sm" variant="ghost" disabled={locked} onClick={() => change({ imageMediaId: null })}>
                חזרה לתמונת הכתבה
              </Button>
            )}
          </span>
        </section>
      )}

      {canEdit && (
        <section className="rounded-lg p-3 ring-1 ring-line">
          <Field label="כתיבה מחדש עם AI" htmlFor="pl-note" hint="עורך הרשתות כותב מחדש את הטקסטים. מסגרת, פורמטים וריל שבחרתם נשמרים.">
            <textarea id="pl-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder='למשל: "כותרת עם המספר בהתחלה", "שאלה אישית יותר בסוף"' className={inputClass} />
          </Field>
          <Button size="sm" className="mt-2" busy={regenerate.isPending} disabled={busy} onClick={() => regenerate.mutate()}>
            {note.trim() ? 'כתיבה לפי ההערה' : 'כתיבה מחדש'}
          </Button>
          {regenerate.isError && <p className="mt-1 text-sm text-brand">{errorMessage(regenerate.error)}</p>}
        </section>
      )}
    </div>
  );
}
