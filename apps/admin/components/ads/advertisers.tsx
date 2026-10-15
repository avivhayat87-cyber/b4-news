'use client';
// The advertisers: their contacts, whether each lead is emailed to them, and their private report
// page (numbers and leads, without signing in). A new link cancels the old one at once.
import { type AdvertiserDto, type AdvertiserInput } from '@b4/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { admin, errorMessage } from '@/lib/api';
import { Badge, Button, Empty, Field, inputClass, useToast } from '../ui';

const EMPTY: AdvertiserInput = { name: '', contactName: '', email: '', phone: '', website: '', notes: '', notifyLeads: true };

function AdvertiserForm({ initial, onDone }: { initial: AdvertiserDto | null; onDone(): void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState<AdvertiserInput>(initial ? { name: initial.name, contactName: initial.contactName, email: initial.email, phone: initial.phone, website: initial.website, notes: initial.notes, notifyLeads: initial.notifyLeads } : EMPTY);
  const save = useMutation({
    mutationFn: () => (initial ? admin.put(`/ads/advertisers/${initial.id}`, f) : admin.post('/ads/advertisers', f)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ads'] });
      toast('המפרסם נשמר.');
      onDone();
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  const input = (k: Exclude<keyof AdvertiserInput, 'notifyLeads' | 'notes'>, label: string, ltr = false) => (
    <Field label={label} htmlFor={`adv-${k}`}>
      <input id={`adv-${k}`} dir={ltr ? 'ltr' : undefined} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} className={inputClass} />
    </Field>
  );
  return (
    <form
      className="grid gap-3 rounded-xl bg-stone p-4 sm:grid-cols-2"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      {input('name', 'שם העסק')}
      {input('contactName', 'איש קשר')}
      {input('email', 'מייל (לשם נשלחים הלידים)', true)}
      {input('phone', 'טלפון', true)}
      {input('website', 'אתר', true)}
      <label className="flex items-center gap-2 self-end pb-2 text-sm font-semibold">
        <input type="checkbox" checked={f.notifyLeads} onChange={(e) => setF({ ...f, notifyLeads: e.target.checked })} />
        לשלוח לו מייל על כל ליד חדש
      </label>
      <div className="sm:col-span-2">
        <Field label="הערות פנימיות" htmlFor="adv-notes">
          <textarea id="adv-notes" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className={inputClass} />
        </Field>
      </div>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" variant="primary" busy={save.isPending} disabled={f.name.trim().length < 2}>
          שמירה
        </Button>
        <Button variant="ghost" onClick={onDone}>
          ביטול
        </Button>
      </div>
    </form>
  );
}

function AdvertiserRow({ a }: { a: AdvertiserDto }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['ads'] });
  const onError = (e: unknown) => toast(errorMessage(e), 'danger');
  const renew = useMutation({ mutationFn: () => admin.post(`/ads/advertisers/${a.id}/new-link`), onSuccess: () => (refresh(), toast('נוצר קישור חדש. הקישור הקודם כבר לא עובד.')), onError });
  const remove = useMutation({ mutationFn: () => admin.del(`/ads/advertisers/${a.id}`), onSuccess: refresh, onError });
  if (editing) return <AdvertiserForm initial={a} onDone={() => setEditing(false)} />;
  return (
    <li className="space-y-2 rounded-xl bg-white p-4 ring-1 ring-line">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-display text-lg font-extrabold">{a.name}</span>
        <Badge tone="muted">{a.campaigns} קמפיינים</Badge>
        {!a.email && <Badge tone="warn">אין מייל ללידים</Badge>}
      </div>
      <p className="text-sm text-ink-2">{[a.contactName, a.phone, a.email].filter(Boolean).join(' · ') || 'בלי פרטי קשר'}</p>
      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-stone px-3 py-2 text-sm">
        <span className="font-bold">עמוד הדוח של המפרסם:</span>
        <a href={a.reportUrl} target="_blank" rel="noopener noreferrer" className="text-info underline">
          פתיחה
        </a>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            void navigator.clipboard.writeText(a.reportUrl);
            toast('הקישור הועתק. שלחו אותו למפרסם: הוא רואה בו את המספרים ואת הלידים שלו.');
          }}
        >
          העתקת קישור
        </Button>
        <Button size="sm" variant="ghost" busy={renew.isPending} onClick={() => confirm('ליצור קישור חדש? הקישור הקודם יפסיק לעבוד מיד.') && renew.mutate()}>
          קישור חדש
        </Button>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => setEditing(true)}>
          עריכה
        </Button>
        {a.campaigns === 0 && (
          <Button size="sm" variant="ghost" busy={remove.isPending} onClick={() => confirm(`למחוק את "${a.name}"?`) && remove.mutate()}>
            מחיקה
          </Button>
        )}
      </div>
    </li>
  );
}

export function Advertisers({ advertisers }: { advertisers: AdvertiserDto[] }) {
  const [adding, setAdding] = useState(false);
  return (
    <section className="space-y-4">
      {adding ? (
        <AdvertiserForm initial={null} onDone={() => setAdding(false)} />
      ) : (
        <Button variant="primary" onClick={() => setAdding(true)}>
          מפרסם חדש
        </Button>
      )}
      {advertisers.length ? (
        <ul className="space-y-3">
          {advertisers.map((a) => (
            <AdvertiserRow key={a.id} a={a} />
          ))}
        </ul>
      ) : (
        !adding && <Empty title="עוד אין מפרסמים">מוסיפים מפרסם, ואז יוצרים לו קמפיין.</Empty>
      )}
    </section>
  );
}
