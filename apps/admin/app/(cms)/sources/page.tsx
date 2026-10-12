'use client';
import { CATEGORIES, type SourceDto } from '@b4/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Badge, Button, Card, Empty, ErrorBox, Field, Loading, PageHeader, inputClass, useToast } from '@/components/ui';
import { admin, errorMessage } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { SOURCE_STATUS, timeAgo } from '@/lib/labels';

function AddSource() {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [category, setCategory] = useState('');
  const [notes, setNotes] = useState('');
  const add = useMutation({
    mutationFn: () => admin.post<SourceDto>('/sources', { name, baseUrl: baseUrl.trim(), defaultCategory: category || null, notes: notes || undefined }),
    onSuccess: () => {
      toast('הבקשה נשלחה למפתח. האתר יופעל אחרי שהטריגר ייבנה ויאושר.');
      setName('');
      setBaseUrl('');
      setNotes('');
      setCategory('');
      void qc.invalidateQueries({ queryKey: ['sources'] });
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  return (
    <Card title="הוספת אתר">
      <form
        className="grid gap-4 md:grid-cols-2"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <Field label="שם האתר" htmlFor="s-name">
          <input id="s-name" required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </Field>
        <Field label="קישור" htmlFor="s-url">
          <input id="s-url" type="url" dir="ltr" required placeholder="https://" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className={inputClass} />
        </Field>
        <Field label="קטגוריה עיקרית (לא חובה)" htmlFor="s-cat">
          <select id="s-cat" value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass}>
            <option value="">לפי תוכן הכתבה</option>
            {CATEGORIES.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="הערה למפתח (לא חובה)" htmlFor="s-notes">
          <input id="s-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="למשל: רק מדור הנדל״ן" className={inputClass} />
        </Field>
        <div className="md:col-span-2">
          <Button type="submit" variant="primary" busy={add.isPending}>
            שליחת בקשה למפתח
          </Button>
        </div>
      </form>
    </Card>
  );
}

export default function SourcesPage() {
  const canRequest = useCan('editor', 'developer');
  const sources = useQuery({ queryKey: ['sources'], queryFn: () => admin.get<SourceDto[]>('/sources') });

  return (
    <>
      <PageHeader title="הגדרות אתרים" subtitle="מוסיפים שם וקישור; המפתח בונה את הטריגר, בודק ומאשר, ומאז האתר נכלל בכל איתור." />
      <ol className="mb-6 grid gap-3 text-sm md:grid-cols-4">
        {['1. עורך/ת שולח/ת שם וקישור', '2. המפתח מגדיר/ה טריגר', '3. בדיקה על האתר האמיתי', '4. אישור: האתר פעיל באיתור'].map((s) => (
          <li key={s} className="rounded-lg bg-white px-4 py-3 font-semibold ring-1 ring-line">
            {s}
          </li>
        ))}
      </ol>
      {canRequest && <AddSource />}
      <div className="mt-6">
        {sources.isPending ? (
          <Loading />
        ) : sources.isError ? (
          <ErrorBox error={sources.error} onRetry={() => sources.refetch()} />
        ) : sources.data.length === 0 ? (
          <Empty title="עוד אין אתרים" />
        ) : (
          <div className="overflow-hidden rounded-xl bg-white ring-1 ring-line">
            <table className="w-full text-right">
              <thead className="bg-stone text-sm text-ink-2">
                <tr>
                  <th className="px-4 py-3">אתר</th>
                  <th className="px-4 py-3">מצב</th>
                  <th className="px-4 py-3">שיטה</th>
                  <th className="px-4 py-3">איתור מוצלח אחרון</th>
                  <th className="px-4 py-3">ביקש/ה</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {sources.data.map((s) => (
                  <tr key={s.id} className="hover:bg-canvas">
                    <td className="px-4 py-3">
                      <Link href={`/sources/${s.id}`} className="font-bold hover:text-brand hover:underline">
                        {s.name}
                      </Link>
                      <p className="max-w-md truncate text-xs text-muted" dir="ltr">
                        {s.baseUrl}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={SOURCE_STATUS[s.status].tone}>{SOURCE_STATUS[s.status].label}</Badge>
                      {s.consecutiveFailures > 0 && <span className="mr-2 text-xs text-brand">{s.consecutiveFailures} כשלונות</span>}
                    </td>
                    <td className="px-4 py-3 text-sm uppercase text-muted">{s.method ?? '—'}</td>
                    <td className="px-4 py-3 text-sm">{timeAgo(s.lastSuccessAt)}</td>
                    <td className="px-4 py-3 text-sm">{s.requestedBy ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
