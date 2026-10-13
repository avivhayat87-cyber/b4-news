'use client';
// Settings > site details: the links and contact details the site and the app
// show, the company details the legal pages quote, the terms version readers
// accept, and the info pages in the footer. Empty links are hidden on the site.
import { COMPANY_LABELS, PAGE_SLUGS, PAGE_TOKENS, SITE_LINK_KEYS, SITE_LINK_LABELS, type CompanyDetails, type PageSlug, type SiteSettings } from '@b4/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { SITE_URL, admin, errorMessage } from '@/lib/api';
import { Button, Card, ErrorBox, Field, Loading, cx, inputClass, useToast } from '../ui';

const LEGAL_NOTE = 'נוסח ברירת המחדל נכתב לפי מה שהמערכת אוספת בפועל. לפני העלייה לאוויר, עורך/ת דין צריך/ה לעבור עליו.';
const PAGE_NOTES: Partial<Record<PageSlug, string>> = {
  privacy: LEGAL_NOTE,
  terms: LEGAL_NOTE,
  'comment-rules': 'הכללים הם חלק מתנאי השימוש, ויש אליהם קישור ליד תיבת התגובה.',
  accessibility: 'פרטי רכז/ת הנגישות ותאריך הבדיקה נלקחים מ"פרטי החברה" למעלה.',
};

const COMPANY_FIELDS = Object.keys(COMPANY_LABELS) as (keyof CompanyDetails)[];
const TOKENS = Object.keys(PAGE_TOKENS);

export function SiteDetails({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const site = useQuery({ queryKey: ['site'], queryFn: () => admin.get<SiteSettings>('/site') });
  const defaults = useQuery({ queryKey: ['site-defaults'], queryFn: () => admin.get<Pick<SiteSettings, 'pages'>>('/site/defaults'), staleTime: Infinity });
  const [form, setForm] = useState<SiteSettings | null>(null);
  const [page, setPage] = useState<PageSlug>('about');
  const [confirmVersion, setConfirmVersion] = useState(false);
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
  const newVersion = useMutation({
    mutationFn: () => admin.post<SiteSettings>('/site/legal-version'),
    onSuccess: (saved) => {
      qc.setQueryData(['site'], saved);
      setForm((f) => (f ? { ...f, legal: saved.legal } : saved));
      setConfirmVersion(false);
      toast(`פורסמה גרסה ${saved.legal.version}. כל הקוראים יתבקשו לאשר אותה.`);
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });

  if (site.isPending || !form) return <Loading />;
  if (site.isError) return <ErrorBox error={site.error} onRetry={() => site.refetch()} />;
  const dirty = JSON.stringify(form) !== JSON.stringify(site.data);
  const setLink = (k: string, v: string) => setForm({ ...form, links: { ...form.links, [k]: v } });
  const setContact = (k: keyof SiteSettings['contact'], v: string) => setForm({ ...form, contact: { ...form.contact, [k]: v } });
  const setCompany = (k: keyof CompanyDetails, v: string) => setForm({ ...form, company: { ...form.company, [k]: v } });
  const setPageField = (k: 'title' | 'body', v: string) => setForm({ ...form, pages: { ...form.pages, [page]: { ...form.pages[page], [k]: v } } });
  const defaultPage = defaults.data?.pages[page];
  const isDefault = defaultPage && defaultPage.title === form.pages[page].title && defaultPage.body === form.pages[page].body;
  const missingCompany = COMPANY_FIELDS.filter((k) => !form.company[k] && k !== 'privacyEmail' && k !== 'accessibilityEmail');

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

      <Card title="פרטי החברה (לתנאי השימוש, למדיניות הפרטיות ולהצהרת הנגישות)">
        <p className="mb-4 text-sm text-ink-2">
          הפרטים נכנסים אוטומטית לעמודי המידע במקום הסימונים {TOKENS.slice(0, 3).join(', ')} ודומיהם. שדה ריק יופיע באתר כ&quot;[להשלמה: …]&quot;. מייל ריק מוחלף במייל המערכת.
        </p>
        {missingCompany.length > 0 && (
          <p className="mb-4 rounded-lg bg-warn-soft px-3 py-2 text-sm font-semibold text-warn">חסר עדיין: {missingCompany.map((k) => COMPANY_LABELS[k]).join(', ')}</p>
        )}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {COMPANY_FIELDS.map((k) => (
            <Field key={k} label={COMPANY_LABELS[k]} htmlFor={`co-${k}`}>
              <input
                id={`co-${k}`}
                dir={k.toLowerCase().includes('email') || k.toLowerCase().includes('phone') || k === 'regNumber' ? 'ltr' : undefined}
                type={k.toLowerCase().includes('email') ? 'email' : 'text'}
                placeholder={k === 'accessibilityReviewedOn' ? 'למשל: 12 באוקטובר 2026' : undefined}
                value={form.company[k]}
                onChange={(e) => setCompany(k, e.target.value)}
                className={inputClass}
              />
            </Field>
          ))}
        </div>
      </Card>

      <Card title="אישור התנאים על ידי הקוראים">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl space-y-2 text-[15px] text-ink-2">
            <p>
              הגרסה הנוכחית: <b className="font-mono text-ink">{form.legal.version}</b>. כל קורא מאשר אותה בפס ההסכמה באתר, במסך הפתיחה באפליקציה, ובהרשמה לתגובות או לניוזלטר. כל אישור נשמר עם התאריך והגרסה.
            </p>
            <p>אחרי שינוי מהותי בתנאים או במדיניות הפרטיות: שמרו את הנוסח החדש, ואז פרסמו גרסה חדשה. כל הקוראים יתבקשו לאשר שוב, ומגיבים לא יוכלו להגיב עד שיאשרו.</p>
          </div>
          {canEdit &&
            (confirmVersion ? (
              <div className="flex flex-col gap-2 rounded-lg bg-warn-soft p-3 text-sm text-warn" role="alert">
                <p className="font-bold">לבקש מכל הקוראים לאשר את התנאים מחדש?</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="primary" busy={newVersion.isPending} onClick={() => newVersion.mutate()} disabled={dirty}>
                    כן, לפרסם גרסה חדשה
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmVersion(false)}>
                    ביטול
                  </Button>
                </div>
                {dirty && <p>שמרו קודם את השינויים בעמודים.</p>}
              </div>
            ) : (
              <Button variant="dark" onClick={() => setConfirmVersion(true)}>
                פרסום גרסה חדשה של התנאים
              </Button>
            ))}
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
          <Field
            label="תוכן"
            htmlFor="p-body"
            hint={`פסקאות מופרדות בשורה ריקה. "## " בתחילת שורה = כותרת ביניים, "- " = פריט ברשימה. סימונים שמתמלאים מפרטי החברה: ${TOKENS.join(' ')}`}
          >
            <textarea id="p-body" rows={14} value={form.pages[page].body} onChange={(e) => setPageField('body', e.target.value)} className={cx(inputClass, 'leading-relaxed')} />
          </Field>
          {defaultPage && !isDefault && (
            <Button size="sm" variant="ghost" onClick={() => setForm({ ...form, pages: { ...form.pages, [page]: defaultPage } })}>
              שחזור נוסח ברירת המחדל לעמוד הזה
            </Button>
          )}
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
