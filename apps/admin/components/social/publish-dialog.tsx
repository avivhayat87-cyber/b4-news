'use client';
// "Publish to the networks": formats (post / story) and accounts for one or more
// articles. Accounts without a token get the post prepared for manual posting.
import type { ShareFormat, ShareTargetDto } from '@b4/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { admin, errorMessage } from '@/lib/api';
import { PLATFORM, SHARE_FORMAT as FORMAT_LABEL } from '@/lib/labels';
import { Badge, Button, Loading, cx, useToast } from '../ui';

export function PublishDialog({ articleIds, missingKits, onClose, onStarted }: { articleIds: number[]; missingKits: number; onClose(): void; onStarted(): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const toast = useToast();
  const targets = useQuery({ queryKey: ['social-targets'], queryFn: () => admin.get<ShareTargetDto[]>('/social/targets') });
  const [formats, setFormats] = useState<ShareFormat[]>(['feed', 'story']);
  const [accounts, setAccounts] = useState<string[] | null>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);
  useEffect(() => {
    if (targets.data && accounts === null) setAccounts(targets.data.map((t) => t.id));
  }, [targets.data, accounts]);

  const publish = useMutation({
    mutationFn: () => admin.post('/social/publish', { articleIds, formats, accountIds: accounts ?? [] }),
    onSuccess: () => {
      toast(articleIds.length > 1 ? `${articleIds.length} כתבות נשלחו לפרסום ברשתות` : 'הכתבה נשלחה לפרסום ברשתות');
      onStarted();
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });

  const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
  const chosen = targets.data?.filter((t) => accounts?.includes(t.id)) ?? [];
  const manual = chosen.flatMap((t) => formats.filter((f) => !t.autoFormats.includes(f)).map((f) => `${PLATFORM[t.platform]} (${FORMAT_LABEL[f].name})`));

  return (
    <dialog ref={ref} onClose={onClose} className="m-auto w-[min(560px,calc(100vw-2rem))] rounded-2xl p-0 shadow-2xl backdrop:bg-ink/50" aria-labelledby="publish-title">
      <div className="space-y-5 p-6">
        <div>
          <h2 id="publish-title" className="text-xl font-extrabold">
            פרסום ברשתות החברתיות
          </h2>
          <p className="mt-1 text-[15px] text-muted">{articleIds.length > 1 ? `${articleIds.length} כתבות נבחרו.` : 'כתבה אחת.'} הקישור בכל פוסט מוביל לעמוד הכתבה באתר.</p>
        </div>

        {missingKits > 0 && (
          <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm font-semibold text-warn">
            ל-{missingKits} מהכתבות עוד אין פוסט. סגרו, לחצו &quot;הכנה עם AI&quot; וחזרו לכאן.
          </p>
        )}

        <fieldset>
          <legend className="mb-2 text-sm font-bold text-ink-2">מה לפרסם</legend>
          <div className="grid grid-cols-3 gap-2">
            {(['feed', 'story', 'reel'] as const).map((f) => (
              <label key={f} className={cx('flex cursor-pointer items-center gap-3 rounded-xl p-3 ring-1', formats.includes(f) ? 'bg-brand-soft ring-brand' : 'ring-line')}>
                <input type="checkbox" checked={formats.includes(f)} onChange={() => setFormats(toggle(formats, f))} />
                <span>
                  <span className="block font-bold">{FORMAT_LABEL[f].name}</span>
                  <span className="text-xs text-muted">{FORMAT_LABEL[f].size}</span>
                </span>
              </label>
            ))}
          </div>
          {formats.includes('reel') && <p className="mt-2 text-xs text-muted">ריל מתפרסם רק לכתבות שהסרטון שלהן אושר (בעורך של הכתבה, שלב &quot;אישור לפרסום&quot; בריל).</p>}
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-sm font-bold text-ink-2">לאן</legend>
          {targets.isPending ? (
            <Loading />
          ) : !targets.data?.length ? (
            <p className="text-sm text-muted">אין חשבונות רשתות פעילים. מנהל/ת יכול/ה להוסיף ב&quot;הגדרות&quot; ← &quot;חיבורים&quot;.</p>
          ) : (
            <ul className="space-y-1.5">
              {targets.data.map((t) => (
                <li key={t.id}>
                  <label className="flex cursor-pointer flex-wrap items-center gap-2 rounded-lg px-3 py-2 ring-1 ring-line hover:bg-stone">
                    <input type="checkbox" checked={accounts?.includes(t.id) ?? false} onChange={() => setAccounts(toggle(accounts ?? [], t.id))} />
                    <span className="font-semibold">{PLATFORM[t.platform]}</span>
                    <span className="text-sm text-muted">{t.displayName}</span>
                    <span className="mr-auto">
                      {t.autoFormats.length ? (
                        <Badge tone="ok">אוטומטי: {t.autoFormats.map((f) => FORMAT_LABEL[f].name).join(' + ')}</Badge>
                      ) : (
                        <Badge tone="warn">{t.connected ? 'פרסום ידני בפלטפורמה הזו' : 'לא מחובר: יוכן לפרסום ידני'}</Badge>
                      )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>

        {manual.length > 0 && (
          <p className="text-sm text-muted">
            יוכנו לפרסום ידני (תמונה להורדה וטקסט להעתקה): {manual.join(', ')}.
          </p>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-line-soft pt-4">
          <Button variant="ghost" onClick={() => ref.current?.close()}>
            ביטול
          </Button>
          <Button variant="primary" busy={publish.isPending} disabled={!formats.length || !chosen.length || missingKits > 0} onClick={() => publish.mutate()}>
            {articleIds.length > 1 ? `פרסום ${articleIds.length} כתבות` : 'פרסום'}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
