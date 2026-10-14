'use client';
// One skill: the version in use, its history, and (for an admin) a new wording or an older version
// brought back. Every version is kept; the newest active one is what the agent reads.
import type { SkillDto } from '@b4/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { admin, errorMessage } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { SKILL, formatDateTime } from '@/lib/labels';
import { Badge, Button, ErrorBox, Loading, cx, inputClass, useToast } from '../ui';

const authorOf = (createdBy: string | null) => createdBy ?? 'ברירת המחדל של המערכת';

export function SkillEditor({ skillKey }: { skillKey: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const isAdmin = useCan();
  const key = ['skill', skillKey];
  const query = useQuery({ queryKey: key, queryFn: () => admin.get<SkillDto>(`/skills/${skillKey}`) });
  const [draft, setDraft] = useState<string | null>(null);
  const [shown, setShown] = useState<number | null>(null);
  const [history, setHistory] = useState(false);

  const done = (next: SkillDto, message: string) => {
    qc.setQueryData(key, next);
    void qc.invalidateQueries({ queryKey: ['agents'] });
    setDraft(null);
    toast(message);
  };
  const save = useMutation({
    mutationFn: (body: string) => admin.put<SkillDto>(`/skills/${skillKey}`, { body }),
    onSuccess: (next) => done(next, 'נשמר כגרסה חדשה. הסוכן משתמש בה מעכשיו.'),
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  const restore = useMutation({
    mutationFn: (version: number) => admin.post<SkillDto>(`/skills/${skillKey}/versions/${version}/restore`),
    onSuccess: (next) => done(next, 'הגרסה הוחזרה, כגרסה חדשה. הסוכן משתמש בה מעכשיו.'),
    onError: (e) => toast(errorMessage(e), 'danger'),
  });

  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorBox error={query.error} onRetry={() => query.refetch()} />;
  const skill = query.data;
  const current = skill.versions.find((v) => v.isActive) ?? skill.versions[0];
  const english = skill.kind === 'template';
  const label = SKILL[skillKey] ?? { name: skillKey, use: '' };

  return (
    <div className="space-y-3">
      <div>
        <p className="font-display text-lg font-extrabold">{label.name}</p>
        {label.use && <p className="text-sm text-muted">{label.use}</p>}
        {current && (
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
            <Badge tone="ok">גרסה {current.version} בשימוש</Badge>
            <span>
              {authorOf(current.createdBy)} · {formatDateTime(current.createdAt)}
            </span>
          </p>
        )}
      </div>

      {draft === null ? (
        <pre dir={english ? 'ltr' : 'rtl'} className={cx('max-h-96 overflow-y-auto whitespace-pre-wrap rounded-lg bg-stone p-3 text-sm leading-relaxed', english ? 'text-left font-mono' : 'font-sans')}>
          {current?.body}
        </pre>
      ) : (
        <div className="space-y-2">
          <textarea
            dir={english ? 'ltr' : 'rtl'}
            rows={16}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className={cx(inputClass, 'leading-relaxed', english && 'text-left font-mono text-sm')}
            aria-label={`עריכת ${label.name}`}
          />
          {skill.placeholders.length > 0 && <p className="text-xs text-muted">חובה להשאיר בטקסט: {skill.placeholders.join(', ')}. שם המערכת מכניסה את החלק שלה.</p>}
          <div className="flex gap-2">
            <Button variant="primary" busy={save.isPending} disabled={draft.trim() === current?.body.trim()} onClick={() => save.mutate(draft)}>
              שמירה כגרסה חדשה
            </Button>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              ביטול
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {isAdmin && draft === null && (
          <Button size="sm" variant="dark" onClick={() => setDraft(current?.body ?? '')}>
            עריכה
          </Button>
        )}
        {skill.versions.length > 1 && (
          <Button size="sm" variant="ghost" onClick={() => setHistory(!history)}>
            {history ? 'הסתרת הגרסאות' : `כל הגרסאות (${skill.versions.length})`}
          </Button>
        )}
        {!isAdmin && <span className="self-center text-xs text-muted">רק מנהל/ת מערכת יכול/ה לשנות סקיל.</span>}
      </div>

      {history && (
        <ul className="space-y-2">
          {skill.versions.map((v) => (
            <li key={v.version} className="rounded-lg p-3 text-sm ring-1 ring-line">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold">גרסה {v.version}</span>
                {v.isActive && <Badge tone="ok">בשימוש</Badge>}
                <span className="text-xs text-muted">
                  {authorOf(v.createdBy)} · {formatDateTime(v.createdAt)}
                </span>
                <span className="mr-auto flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setShown(shown === v.version ? null : v.version)}>
                    {shown === v.version ? 'הסתרה' : 'הצגה'}
                  </Button>
                  {isAdmin && !v.isActive && (
                    <Button size="sm" variant="ghost" busy={restore.isPending && restore.variables === v.version} onClick={() => restore.mutate(v.version)}>
                      החזרת הגרסה הזו
                    </Button>
                  )}
                </span>
              </div>
              {shown === v.version && (
                <pre dir="auto" className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap rounded bg-stone p-2 text-xs leading-relaxed">
                  {v.body}
                </pre>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
