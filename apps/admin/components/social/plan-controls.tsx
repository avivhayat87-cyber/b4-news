'use client';
// The quick controls of a distribution plan, shared by the report on the social page and the
// editor's social tab: the frame, what goes out, and the reel (recommended by the AI, approved
// here with one click). Every change saves at once.
import { DESIGN_FORMATS, SHARE_TEMPLATES, type ShareFormat, type SocialPlanDto, type UpdateSocialPlanInput } from '@b4/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { admin, errorMessage } from '@/lib/api';
import { SHARE_FORMAT, SHARE_TEMPLATE } from '@/lib/labels';
import { Badge, Button, cx, useToast } from '../ui';

export type PlanPatch = Omit<UpdateSocialPlanInput, 'version'>;

/** Saves a change to a plan, and refreshes the report and the plan wherever they are shown. */
export function usePlanUpdate() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: ({ plan, patch }: { plan: SocialPlanDto; patch: PlanPatch }) => admin.put<SocialPlanDto>(`/drafts/${plan.draftId}/social-plan`, { version: plan.version, ...patch }),
    onSuccess: (next) => {
      qc.setQueryData(['social-plan', next.draftId], next);
      void qc.invalidateQueries({ queryKey: ['social-plans'] });
    },
    onError: (e) => {
      toast(errorMessage(e), 'danger');
      void qc.invalidateQueries({ queryKey: ['social-plans'] });
    },
  });
}

/** The four frames as a compact row (the report); the editor uses the large picker. */
export function TemplateChips({ plan, disabled, onChange }: { plan: SocialPlanDto; disabled?: boolean; onChange(patch: PlanPatch): void }) {
  return (
    <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="מסגרת עיצוב">
      {SHARE_TEMPLATES.map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={plan.template === t}
          disabled={disabled}
          title={SHARE_TEMPLATE[t].use}
          onClick={() => plan.template !== t && onChange({ template: t })}
          className={cx('rounded-full px-2.5 py-1 text-xs font-bold ring-1', plan.template === t ? 'bg-ink text-white ring-ink' : 'text-ink-2 ring-line hover:ring-ink')}
        >
          {SHARE_TEMPLATE[t].name}
          {plan.aiChoice?.template === t && plan.template !== t ? ' (AI)' : ''}
        </button>
      ))}
    </div>
  );
}

/** Post and story; the last thing that goes out can't be unchecked (turn the plan off instead). */
export function FormatToggles({ plan, disabled, onChange }: { plan: SocialPlanDto; disabled?: boolean; onChange(patch: PlanPatch): void }) {
  const toggle = (f: ShareFormat) => {
    const next = plan.formats.includes(f) ? plan.formats.filter((x) => x !== f) : [...plan.formats, f];
    if (next.length) onChange({ formats: next });
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {DESIGN_FORMATS.map((f) => (
        <label key={f} className={cx('flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ring-1', plan.formats.includes(f) ? 'bg-brand-soft text-brand-deep ring-brand' : 'text-ink-2 ring-line')}>
          <input type="checkbox" checked={plan.formats.includes(f)} disabled={disabled} onChange={() => toggle(f)} className="size-3.5" />
          {SHARE_FORMAT[f].name}
        </label>
      ))}
    </div>
  );
}

const price = (usd: number | null) => (usd === null ? '' : ` · כ-$${usd.toFixed(2)}`);

/** The AI's reel suggestion and the one-click approval (a video costs money, so a person decides). */
export function ReelChoice({ plan, disabled, onChange, detailed }: { plan: SocialPlanDto; disabled?: boolean; onChange(patch: PlanPatch): void; detailed?: boolean }) {
  const approved = plan.formats.includes('reel');
  const reel = plan.reel;
  const withoutReel = () => {
    const next = plan.formats.filter((f) => f !== 'reel');
    onChange({ formats: next.length ? next : ['feed'] });
  };
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        {approved ? (
          <>
            <Badge tone="ok">ריל מאושר{price(plan.reelEstimateUsd)}</Badge>
            <Button size="sm" variant="ghost" disabled={disabled} onClick={withoutReel}>
              ביטול הריל
            </Button>
          </>
        ) : reel?.recommended ? (
          <>
            <Badge tone="warn">מומלץ ריל</Badge>
            <Button size="sm" variant="dark" disabled={disabled} onClick={() => onChange({ formats: [...plan.formats, 'reel'] })}>
              אישור ריל{price(plan.reelEstimateUsd)}
            </Button>
          </>
        ) : (
          <>
            <Badge tone="muted">בלי ריל</Badge>
            <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onChange({ formats: [...plan.formats, 'reel'] })}>
              בכל זאת ריל
            </Button>
          </>
        )}
      </div>
      {reel?.idea && <p className="text-xs leading-relaxed text-ink-2">{reel.idea}</p>}
      {detailed && reel?.reason && <p className="text-xs text-muted">למה: {reel.reason}</p>}
    </div>
  );
}
