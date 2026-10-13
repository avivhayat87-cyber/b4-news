'use client';
// Connecting the Claude app: a personal access token and the config block to
// paste into the app's settings. The app starts a small local server
// (b4-news-mcp.mjs) that reaches only the agent's tools, as this person.
import type { ApiTokenDto, McpConfigDto as McpConfig } from '@b4/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { admin, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/labels';
import { Badge, Button, Card, Field, Loading, inputClass, useToast } from '../ui';

export function ConnectClaude() {
  const qc = useQueryClient();
  const toast = useToast();
  const tokens = useQuery({ queryKey: ['agent', 'tokens'], queryFn: () => admin.get<ApiTokenDto[]>('/agent/tokens') });
  const config = useQuery({ queryKey: ['agent', 'mcp-config'], queryFn: () => admin.get<McpConfig>('/agent/mcp-config') });
  const [name, setName] = useState('Claude במחשב שלי');
  const [secret, setSecret] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => admin.post<{ token: ApiTokenDto; secret: string }>('/agent/tokens', { name }),
    onSuccess: (r) => {
      setSecret(r.secret);
      void qc.invalidateQueries({ queryKey: ['agent', 'tokens'] });
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => admin.post(`/agent/tokens/${id}/revoke`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['agent', 'tokens'] }),
    onError: (e) => toast(errorMessage(e), 'danger'),
  });

  const snippet = config.data
    ? JSON.stringify({ mcpServers: { 'b4-news': { command: config.data.command, args: config.data.args, env: { ...config.data.env, B4_TOKEN: secret ?? '<המפתח שנוצר למעלה>' } } } }, null, 2)
    : '';
  const copy = (text: string, what: string) => navigator.clipboard.writeText(text).then(() => toast(`${what} הועתק`), () => toast('ההעתקה נכשלה', 'danger'));

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card title="1. מפתח גישה אישי">
        <p className="mb-4 text-[15px] text-ink-2">אפליקציית Claude עובדת במערכת בשמכם ובהרשאות שלכם, ורק דרך הפעולות של הסוכן. כל פעולה שמשנה משהו מחכה לאישור שלכם באפליקציה.</p>
        <div className="flex items-end gap-2">
          <Field label="שם למפתח" htmlFor="tok-name">
            <input id="tok-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </Field>
          <Button variant="primary" busy={create.isPending} disabled={name.trim().length < 2} onClick={() => create.mutate()}>
            יצירת מפתח
          </Button>
        </div>
        {secret && (
          <div className="mt-4 rounded-lg bg-warn-soft p-3 text-sm text-warn">
            <b>המפתח מוצג פעם אחת בלבד.</b> הוא כבר בתוך ההגדרה בצד שמאל; העתיקו אותה עכשיו.
            <code className="mt-2 block break-all rounded bg-white p-2 font-mono text-xs text-ink" dir="ltr">
              {secret}
            </code>
          </div>
        )}
        <div className="mt-5">
          {tokens.isPending ? (
            <Loading />
          ) : (
            <ul className="space-y-1.5">
              {tokens.data?.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-sm ring-1 ring-line">
                  <span className="font-semibold">{t.name}</span>
                  <span className="text-xs text-muted">נוצר {formatDateTime(t.createdAt)}</span>
                  {t.lastUsedAt && <span className="text-xs text-muted">· שימוש אחרון {formatDateTime(t.lastUsedAt)}</span>}
                  {t.revokedAt ? (
                    <Badge tone="muted" className="mr-auto">
                      בוטל
                    </Badge>
                  ) : (
                    <Button size="sm" variant="ghost" className="mr-auto" onClick={() => confirm('לבטל את המפתח? האפליקציה שמשתמשת בו תתנתק.') && revoke.mutate(t.id)}>
                      ביטול
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card title="2. חיבור באפליקציית Claude במחשב">
        <ol className="mb-4 list-decimal space-y-1.5 pr-5 text-[15px] text-ink-2">
          <li>פותחים את אפליקציית Claude במחשב ← Settings ← Developer ← Edit Config.</li>
          <li>מדביקים את ההגדרה למטה בקובץ (אם כבר יש בו mcpServers, מוסיפים את &quot;b4-news&quot; בתוכו) ושומרים.</li>
          <li>סוגרים ופותחים את האפליקציה. בצ&apos;אט יופיע החיבור &quot;b4-news&quot; עם הפעולות של המערכת.</li>
          <li>כותבים בעברית, למשל: &quot;מה מחכה לאישור?&quot; או &quot;תתחיל איתור מחו״ל&quot;.</li>
        </ol>
        {config.isPending ? (
          <Loading />
        ) : (
          <>
            <pre className="max-h-72 overflow-auto rounded-lg bg-night p-3 font-mono text-xs leading-relaxed text-white" dir="ltr">
              {snippet}
            </pre>
            <Button size="sm" className="mt-2" onClick={() => copy(snippet, 'ההגדרה')}>
              העתקת ההגדרה
            </Button>
          </>
        )}
        <p className="mt-4 text-sm text-muted">
          השרת המקומי צריך לרוץ (אותו שרת של מערכת הניהול). חיבור מ-claude.ai בדפדפן יתאפשר אחרי שהמערכת תעלה לאוויר בכתובת ציבורית מאובטחת.
        </p>
      </Card>
    </div>
  );
}
