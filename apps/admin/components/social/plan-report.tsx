'use client';
// The report of distribution plans: every article whose text is final and that waits to be
// published, with what the social editor chose (frame, post, story, a reel) and why. One click
// changes a choice or approves a reel; publishing the article sends the plan out. Below it, what
// went out for the articles published in the last days.
import type { SocialPlanDto, SocialPlanReport } from '@b4/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { admin, errorMessage } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { PLAN_STATE, PLATFORM, REEL_STAGE } from '@/lib/labels';
import { Badge, Button, Card, Empty, ErrorBox, Loading, Thumb, cx, useToast } from '../ui';
import { FormatToggles, ReelChoice, TemplateChips, usePlanUpdate } from './plan-controls';

function PlanRow({ plan, open, onOpen }: { plan: SocialPlanDto; open: boolean; onOpen(): void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const canEdit = useCan('editor');
  const update = usePlanUpdate();
  const write = useMutation({
    mutationFn: () => admin.post(`/drafts/${plan.draftId}/social-plan/regenerate`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['social-plans'] }),
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  const hasPlan = Boolean(plan.headline) && plan.state !== 'writing';
  const locked = !canEdit || update.isPending || !plan.enabled;
  const change = (patch: Parameters<typeof update.mutate>[0]['patch']) => update.mutate({ plan, patch });
  const state = PLAN_STATE[plan.state];

  return (
    <li className={cx('px-5 py-3', open && 'bg-brand-soft/50')}>
      <div className="flex items-start gap-3">
        <button type="button" onClick={onOpen} className="shrink-0" aria-label={`פתיחת התוכנית של "${plan.title}"`}>
          <Thumb src={plan.rendered.story ?? plan.rendered.feed ?? plan.heroUrl} className="h-20 w-[45px]" />
        </button>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <button type="button" onClick={onOpen} className="min-w-0 truncate text-right font-bold hover:underline">
              {plan.title}
            </button>
            {plan.category && <span className="text-xs text-muted">{plan.category}</span>}
            <Badge tone={state.tone}>{state.label}</Badge>
          </div>
          {hasPlan ? (
            <>
              <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                <TemplateChips plan={plan} disabled={locked} onChange={change} />
                <FormatToggles plan={plan} disabled={locked} onChange={change} />
              </div>
              <ReelChoice plan={plan} disabled={locked} onChange={change} />
              {(plan.reasons.template || plan.reasons.formats) && (
                <p className="text-xs text-muted">
                  למה: {[plan.reasons.template, plan.reasons.formats].filter(Boolean).join(' ')}
                </p>
              )}
              {canEdit && (
                <label className="flex w-fit items-center gap-1.5 text-xs font-semibold text-ink-2">
                  <input type="checkbox" checked={!plan.enabled} disabled={update.isPending} onChange={(e) => change({ enabled: !e.target.checked })} className="size-3.5" />
                  לא לפרסם את הכתבה הזו ברשתות
                </label>
              )}
            </>
          ) : plan.state === 'writing' ? null : (
            <div className="flex flex-wrap items-center gap-2">
              {plan.error && <span className="text-sm text-brand">{plan.error}</span>}
              {canEdit && (
                <Button size="sm" variant="dark" busy={write.isPending} onClick={() => write.mutate()}>
                  {plan.state === 'failed' ? 'ניסיון נוסף' : 'הכנת תוכנית'}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function SentRow({ plan, onOpenArticle }: { plan: SocialPlanDto; onOpenArticle(id: number): void }) {
  const byPlatform = new Map<string, string[]>();
  for (const p of plan.posts) byPlatform.set(p.platform, [...(byPlatform.get(p.platform) ?? []), p.status]);
  return (
    <li className="flex flex-wrap items-center gap-2 px-5 py-2.5">
      <button type="button" onClick={() => plan.articleId && onOpenArticle(plan.articleId)} className="min-w-0 max-w-full truncate text-right font-semibold hover:underline">
        {plan.title}
      </button>
      {[...byPlatform].map(([platform, statuses]) => (
        <Badge key={platform} tone={statuses.includes('posted') ? 'ok' : statuses.includes('failed') ? 'danger' : statuses.some((x) => x === 'queued' || x === 'posting') ? 'info' : 'warn'}>
          {PLATFORM[platform as keyof typeof PLATFORM]}
          {statuses.includes('posted') ? ' ✓' : statuses.includes('failed') ? ' · נכשל' : statuses.some((x) => x === 'queued' || x === 'posting') ? ' · בדרך' : ' · ידני'}
        </Badge>
      ))}
      {!plan.enabled && <Badge tone="muted">לא לרשתות</Badge>}
      {plan.reelStage && <Badge tone={REEL_STAGE[plan.reelStage].tone}>ריל: {REEL_STAGE[plan.reelStage].label}</Badge>}
    </li>
  );
}

/** "Approve all": every reel the social editor recommended, in one click (each one is saved and audited on its own). */
function ApproveAllReels({ plans }: { plans: SocialPlanDto[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const canEdit = useCan('editor');
  const approve = useMutation({
    mutationFn: async () => {
      for (const p of plans) await admin.put(`/drafts/${p.draftId}/social-plan`, { version: p.version, formats: [...p.formats, 'reel'] });
    },
    onSuccess: () => toast(plans.length > 1 ? `${plans.length} ריילים אושרו. הם ייבנו אחרי פרסום הכתבות.` : 'הריל אושר. הוא ייבנה אחרי פרסום הכתבה.'),
    onError: (e) => toast(errorMessage(e), 'danger'),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['social-plans'] }),
  });
  if (!plans.length) return null;
  const known = plans.filter((p) => p.reelEstimateUsd !== null);
  const total = known.reduce((sum, p) => sum + (p.reelEstimateUsd ?? 0), 0);
  return canEdit ? (
    <Button size="sm" variant="dark" busy={approve.isPending} onClick={() => approve.mutate()}>
      אישור כל הריילים המומלצים ({plans.length}
      {known.length ? ` · כ-$${total.toFixed(2)}` : ''})
    </Button>
  ) : (
    <Badge tone="warn">{plans.length} ריל מומלץ מחכה לאישור</Badge>
  );
}

export function PlanReport({ openDraftId, onOpen, onOpenArticle }: { openDraftId: string | null; onOpen(draftId: string): void; onOpenArticle(articleId: number): void }) {
  const report = useQuery({
    queryKey: ['social-plans'],
    queryFn: () => admin.get<SocialPlanReport>('/social/plans'),
    refetchInterval: (q) => (q.state.data?.pending.some((p) => p.state === 'writing') ? 2500 : 30_000),
  });
  if (report.isPending) return <Loading />;
  if (report.isError) return <ErrorBox error={report.error} onRetry={() => report.refetch()} />;
  const { pending, recent, autoPost } = report.data;
  const reels = pending.filter((p) => p.reel?.recommended && !p.formats.includes('reel') && p.enabled && p.state !== 'writing');

  return (
    <div className="space-y-6">
      <Card title={`לפני פרסום: ${pending.length} כתבות`} actions={<ApproveAllReels plans={reels} />}>
        <p className={cx('-mt-1 mb-3 text-sm', autoPost ? 'text-muted' : 'font-semibold text-warn')}>
          {autoPost
            ? 'עורך הרשתות הכין לכל כתבה תוכנית. כשהכתבה מתפרסמת, התוכנית עולה לרשתות לבד. משנים כאן בלחיצה.'
            : 'הפרסום האוטומטי כבוי (הגדרות > צוות הסוכנים > עורך הרשתות): התוכניות נשמרות בדף הרשתות ולא עולות לבד.'}
        </p>
        {pending.length === 0 ? (
          <Empty title="אין כתבות שמחכות לפרסום">כשמסמנים טקסט של כתבה כסופי, עורך הרשתות כותב לה תוכנית והיא מופיעה כאן.</Empty>
        ) : (
          <ul className="-mx-5 divide-y divide-line-soft">
            {pending.map((p) => (
              <PlanRow key={p.draftId} plan={p} open={openDraftId === p.draftId} onOpen={() => onOpen(p.draftId)} />
            ))}
          </ul>
        )}
      </Card>
      {recent.length > 0 && (
        <Card title="יצאו לאחרונה">
          <ul className="-mx-5 divide-y divide-line-soft">
            {recent.map((p) => (
              <SentRow key={p.draftId} plan={p} onOpenArticle={onOpenArticle} />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
