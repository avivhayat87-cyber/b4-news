'use client';
// What an article still needs before it is published, as steps the editor clicks: each missing
// step opens the place that fixes it. In fixing mode (articles held back at publishing, or "לתקן"
// in the preview) the editor walks through them article after article, and the page moves to the
// next missing step by itself as soon as one is filled.
import { MISSING_KEYS, type DraftDetail, type MagazineDetail, type MissingKey, type SavedEdits } from '@b4/shared';
import { useQuery } from '@tanstack/react-query';
import { admin } from '@/lib/api';
import { MISSING_STEP } from '@/lib/labels';
import { Button, LinkButton, cx } from '../ui';

export type EditorTab = 'research' | 'original' | 'ai' | 'images' | 'meta' | 'review' | 'social';

/** Where each step is fixed: a tab beside the canvas, or (null) the canvas and its footer. */
export const MISSING_TAB: Record<MissingKey, EditorTab | null> = { title: null, body: null, category: 'meta', image: 'images', text: null, review: 'review' };

/** The class that marks the control the editor should use now. */
export const FOCUS_RING = 'ring-4 ring-brand/70 ring-offset-2 rounded-lg';

type StepState = 'done' | 'missing' | 'later';

/** The steps: the text ones only when missing (they rarely are); the legal review only after the text is approved. */
export function ReadinessBar({ draft, focus, onGo }: { draft: DraftDetail; focus: MissingKey | null; onGo(key: MissingKey): void }) {
  if (draft.status === 'published' || draft.status === 'skipped') return null;
  const missing = new Map(draft.missing.map((m) => [m.key, m.message]));
  const state = (k: MissingKey): StepState => (missing.has(k) ? 'missing' : k === 'review' && missing.has('text') ? 'later' : 'done');
  const steps = MISSING_KEYS.filter((k) => missing.has(k) || (k !== 'title' && k !== 'body'));
  return (
    <nav aria-label="מה חסר לפרסום" className="flex flex-wrap items-center gap-1.5 border-b border-line bg-canvas px-5 py-2 text-sm">
      <span className={cx('font-bold', missing.size ? 'text-ink-2' : 'text-ok')}>{missing.size ? 'לפני פרסום:' : '✓ הכתבה מוכנה לפרסום'}</span>
      {steps.map((k) => {
        const st = state(k);
        return (
          <button
            key={k}
            type="button"
            onClick={() => onGo(k)}
            disabled={st !== 'missing'}
            title={missing.get(k) ?? (st === 'later' ? 'נבדקת אחרי שהטקסט מאושר' : undefined)}
            className={cx(
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ring-1',
              st === 'done' && 'bg-ok-soft text-ok ring-ok/20',
              st === 'later' && 'bg-white text-muted ring-line',
              st === 'missing' && (focus === k ? 'bg-brand text-white ring-brand' : 'bg-white text-brand-deep ring-brand/40 hover:bg-brand-soft'),
            )}
          >
            <span aria-hidden>{st === 'done' ? '✓' : st === 'later' ? '…' : '!'}</span>
            {MISSING_STEP[k].label}
            <span className="sr-only">{st === 'done' ? ' הושלם' : st === 'later' ? ' אחר כך' : ` חסר: ${missing.get(k) ?? ''}`}</span>
          </button>
        );
      })}
    </nav>
  );
}

/**
 * The articles to fix one after the other. "stuck": those held back when their magazine was
 * published (oldest first); a magazine's id: its articles that aren't ready yet. The current one
 * stays in the list until the editor moves on.
 */
export function useFixQueue(mode: string | null, currentId: string) {
  const stuck = useQuery({ queryKey: ['saved'], queryFn: () => admin.get<SavedEdits>('/saved'), enabled: mode === 'stuck' });
  const magazine = useQuery({ queryKey: ['magazine', mode], queryFn: () => admin.get<MagazineDetail>(`/magazines/${mode}`), enabled: !!mode && mode !== 'stuck' });
  if (!mode) return null;
  const list =
    mode === 'stuck'
      ? (stuck.data?.stuck ?? []).map((d) => d.id)
      : (magazine.data?.drafts ?? []).filter((d) => d.id === currentId || (d.missing.length > 0 && d.status !== 'skipped' && d.status !== 'published')).map((d) => d.id);
  const ids = list.includes(currentId) ? list : [currentId, ...list];
  const at = ids.indexOf(currentId);
  const nextId = ids.slice(at + 1).concat(ids.slice(0, at))[0] ?? null;
  return { mode, index: at, total: ids.length, nextId, backHref: mode === 'stuck' ? '/saved' : `/magazines/${mode}/preview` };
}

/** The fixing mode's bar: which article of how many, the step to do now, and what to do when it is ready. */
export function FixBanner({
  draft,
  queue,
  onNext,
  onPublish,
  publishing,
}: {
  draft: DraftDetail;
  queue: NonNullable<ReturnType<typeof useFixQueue>>;
  onNext(): void;
  onPublish(): void;
  publishing: boolean;
}) {
  const now = draft.missing[0];
  const where = queue.mode === 'stuck' ? 'מתקנים כתבות שנתקעו בפרסום' : 'משלימים את מה שחסר לפני הפרסום';
  return (
    <div className={cx('flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm', now ? 'bg-brand-soft text-brand-deep' : 'bg-ok-soft text-ok')} role="status" aria-live="polite">
      <span className="font-bold">
        {where} · כתבה {queue.index + 1} מתוך {queue.total}
      </span>
      {now ? (
        <span>
          {/* The legal review runs by itself for a few seconds after the text is approved: nothing to do but wait. */}
          {now.message === 'הבדיקה המשפטית עוד רצה' ? (
            <>
              עכשיו: <strong>הבדיקה המשפטית רצה</strong>, כמה שניות. העמוד עובר לבד לשלב הבא.
            </>
          ) : (
            <>
              עכשיו: <strong>{MISSING_STEP[now.key].fix}</strong> ({now.message}). כשזה מסודר, העמוד עובר לבד לשלב הבא.
            </>
          )}
        </span>
      ) : (
        <span className="font-bold">✓ הכתבה מוכנה.</span>
      )}
      <span className="mr-auto flex items-center gap-2">
        {!now && queue.mode === 'stuck' && draft.status !== 'published' && (
          <Button size="sm" variant="primary" busy={publishing} onClick={onPublish}>
            פרסום הכתבה{queue.nextId ? ' והמשך לבאה' : ''}
          </Button>
        )}
        {queue.nextId ? (
          <Button size="sm" variant={now ? 'ghost' : queue.mode === 'stuck' ? 'secondary' : 'primary'} onClick={onNext}>
            {now ? 'דילוג לכתבה הבאה' : 'לכתבה הבאה'}
          </Button>
        ) : (
          <LinkButton href={queue.backHref} variant={now ? 'ghost' : 'secondary'} className="h-8 px-3 text-sm">
            {queue.mode === 'stuck' ? 'לרשימת הכתבות שנתקעו' : 'חזרה לתצוגה המקדימה'}
          </LinkButton>
        )}
      </span>
    </div>
  );
}
