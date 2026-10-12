'use client';
// Settings > site details: the links and contact details the site and the app
// show, and the info pages in the footer. Empty links are hidden on the site.
import { PAGE_SLUGS, SITE_LINK_KEYS, SITE_LINK_LABELS, type PageSlug, type SiteSettings } from '@b4/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { SITE_URL, admin, errorMessage } from '@/lib/api';
import { Button, Card, ErrorBox, Field, Loading, cx, inputClass, useToast } from '../ui';

const PAGE_NOTES: Partial<Record<PageSlug, string>> = {
  privacy: 'טקסט ברירת מחדל כללי. מומלץ שעורך/ת דין יעבור/תעבור עליו לפני העלייה לאוויר.',
  terms: 'טקסט ברירת מחדל כללי. מומלץ שעורך/ת דין יעבור/תעבור עליו לפני העלייה לאוויר.',
  accessibility: 'לפי התקנות בישראל צריך לציין גם רכז/ת נגישות ודרך ליצור קשר. הוסיפו את הפרטים.',
};

export function SiteDetails({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const site = useQuery({ queryKey: ['site'], queryFn: () => admin.get<SiteSettings>('/site') });
  const [form, setForm] = useState<SiteSettings | null>(null);
  const [page, setPage] = useState<PageSlug>('about');
  useEffect(() => {
    if (site.data && !form) setForm(site.data);
  }, [site.data, form]);

  const save = useMutation({
    mutationFn: (value: SiteSettings) => admin.put<SiteSettings>('/site', value),
    onSuccess: (saved) => {
      qc.setQueryData(['site'], saved);
      setForm(saved);
      toast('נשמר. האתר מתעדכן תוך כמה שניות.');
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });

  if (site.isPending || !form) return <Loading />;
  if (site.isError) return <ErrorBox error={site.error} onRetry={() => site.refetch()} />;
  const dirty = JSON.stringify(form) !== JSON.stringify(site.data);
  const setLink = (k: string, v: string) => setForm({ ...form, links: { ...form.links, [k]: v } });
  const setContact = (k: keyof SiteSettings['contact'], v: string) => setForm({ ...form, contact: { ...form.contact, [k]: v } });
  const setPageField = (k: 'title' | 'body', v: string) => setForm({ ...form, pages: { ...form.pages, [page]: { ...form.pages[page], [k]: v } } });

  return (
    <fieldset disabled={!canEdit} className="space-y-6">
      <Card title="קישורים לרשתות ולאפליקציה">
        <p className="mb-4 text-sm text-ink-2">הקישורים מופיעים בתחתית האתר, בכפתורי &quot;עקבו אחרינו&quot; ובפס האפליקציה. קישור ריק לא מוצג.</p>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {SITE_LINK_KEYS.map((k) => (
            <Field key={k} label={SITE_LINK_LABELS[k]} htmlFor={`link-${k}`}>
              <input id={`link-${k}`} type="url" dir="ltr" placeholder="https://" value={form.links[k]} onChange={(e) => setLink(k, e.target.value)} className={inputClass} />
            </Field>
          ))}
        </div>
      </Card>

      <Card title="פרטי התקשרות">
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="מייל המערכת" htmlFor="c-email">
            <input id="c-email" type="email" dir="ltr" value={form.contact.email} onChange={(e) => setContact('email', e.target.value)} className={inputClass} />
          </Field>
          <Field label="טלפון" htmlFor="c-phone">
            <input id="c-phone" dir="ltr" value={form.contact.phone} onChange={(e) => setContact('phone', e.target.value)} className={inputClass} />
          </Field>
          <Field label="כתובת" htmlFor="c-address">
            <input id="c-address" value={form.contact.address} onChange={(e) => setContact('address', e.target.value)} className={inputClass} />
          </Field>
        </div>
      </Card>

      <Card
        title="עמודי מידע"
        actions={
          <a href={`${SITE_URL}/${page}`} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-brand hover:underline">
            לצפייה באתר ↗
          </a>
        }
      >
        <div className="mb-4 flex flex-wrap gap-1" role="tablist">
          {PAGE_SLUGS.map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={page === p}
              onClick={() => setPage(p)}
              className={cx('rounded-full px-3 py-1.5 text-sm font-bold', page === p ? 'bg-ink text-white' : 'bg-stone text-ink-2 hover:bg-line')}
            >
              {form.pages[p].title}
            </button>
          ))}
        </div>
        {PAGE_NOTES[page] ? <p className="mb-3 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">{PAGE_NOTES[page]}</p> : null}
        <div className="space-y-3">
          <Field label="כותרת" htmlFor="p-title">
            <input id="p-title" value={form.pages[page].title} maxLength={120} onChange={(e) => setPageField('title', e.target.value)} className={inputClass} />
          </Field>
          <Field label="תוכן" htmlFor="p-body" hint='פסקאות מופרדות בשורה ריקה. "## " בתחילת שורה = כותרת ביניים, "- " = פריט ברשימה.'>
            <textarea id="p-body" rows={14} value={form.pages[page].body} onChange={(e) => setPageField('body', e.target.value)} className={cx(inputClass, 'leading-relaxed')} />
          </Field>
        </div>
      </Card>

      {canEdit ? (
        <div className="sticky bottom-0 flex items-center gap-3 border-t border-line bg-canvas/95 py-4 backdrop-blur">
          <Button variant="primary" busy={save.isPending} disabled={!dirty} onClick={() => save.mutate(form)}>
            שמירת פרטי האתר
          </Button>
          {dirty ? <span className="text-sm text-muted">יש שינויים שלא נשמרו</span> : null}
        </div>
      ) : (
        <p className="text-sm text-muted">רק מנהל/ת יכול/ה לשנות את פרטי האתר.</p>
      )}
    </fieldset>
  );
}
