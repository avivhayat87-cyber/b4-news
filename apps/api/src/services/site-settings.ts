// Public site details edited in the CMS: social and app links, contact details,
// company details, the info pages linked from the footer, and the terms version
// readers accept. Defaults keep every link working before anyone fills them in
// (empty links are simply not shown).
import {
  COMPANY_LABELS,
  type CompanyDetails,
  PAGE_SLUGS,
  PAGE_TOKENS,
  type PageSlug,
  type PublicPage,
  type PublicSite,
  SITE_LINK_KEYS,
  SiteSettings,
  docToHtml,
  textToDoc,
} from '@b4/shared';
import type { Services } from './context';
import { ACCESSIBILITY_PAGE, COMMENT_RULES_PAGE, PRIVACY_PAGE, TERMS_PAGE } from './legal-pages';

const KEY = 'site';

export const DEFAULT_PAGES: Record<PageSlug, { title: string; body: string }> = {
  about: {
    title: 'אודות B4 NEW\'S',
    body: [
      "B4 NEW'S הוא אתר חדשות כלכלה ישראלי. אנחנו מסבירים מה קורה בכלכלה הישראלית והעולמית, בשוק ההון, בנדל״ן, בהייטק, בביטוח, בצרכנות ובתיירות, בשפה ברורה ובלי ז׳רגון מיותר.",
      '## מה אנחנו עושים',
      'צוות המערכת עוקב אחרי מקורות מידע רבים, בוחר את הסיפורים החשובים וכותב אותם מחדש בסגנון שלנו. אנחנו נעזרים בכלי בינה מלאכותית לכתיבת טיוטות ולהכנת איורים, וכל כתבה עוברת עריכה ובדיקה של עורך אנושי לפני שהיא מתפרסמת.',
      '## השקיפות שלנו',
      '- כתבה שמבוססת על דיווח של גוף אחר מציינת את המקור בתחתית העמוד.',
      '- איורים שנוצרו בכלי בינה מלאכותית מסומנים ככאלה.',
      '- טעינו? כתבו לנו ונתקן בהקדם.',
    ].join('\n\n'),
  },
  contact: {
    title: 'צור קשר',
    body: [
      'נשמח לשמוע מכם: הצעות לכתבות, תיקונים, שאלות ופניות עיתונאיות.',
      'את פרטי ההתקשרות של המערכת תמצאו בתחתית העמוד. אנחנו עונים בימים א׳ עד ה׳.',
      '## תיקונים',
      'מצאתם טעות בכתבה? צרפו קישור לכתבה ותיאור קצר של הטעות, ונבדוק בהקדם.',
      '## תוכן פוגעני',
      'לבקשה להסיר תגובה או תוכן שפוגעים בכם, מלאו את הטופס בעמוד ״דיווח על תוכן״. כך הבקשה נרשמת ומטופלת מהר יותר.',
    ].join('\n\n'),
  },
  advertise: {
    title: 'פרסמו אצלנו',
    body: [
      "B4 NEW'S מגיע לקהל של משקיעים, בעלי עסקים, אנשי הייטק וצרכנים שמתעניינים בכלכלה.",
      '## אפשרויות פרסום',
      '- באנרים באתר ובאפליקציה',
      '- תוכן שיווקי מסומן',
      '- חסות על מדורים, ניוזלטר ופודקאסטים',
      'לפרטים ולהצעת מחיר, כתבו לנו בכתובת שמופיעה בתחתית העמוד.',
    ].join('\n\n'),
  },
  accessibility: ACCESSIBILITY_PAGE,
  privacy: PRIVACY_PAGE,
  terms: TERMS_PAGE,
  'comment-rules': COMMENT_RULES_PAGE,
};

export const DEFAULT_SITE: SiteSettings = SiteSettings.parse({
  links: Object.fromEntries(SITE_LINK_KEYS.map((k) => [k, ''])),
  contact: { email: '', phone: '', address: '' },
  pages: DEFAULT_PAGES,
});

export async function getSite(s: Services): Promise<SiteSettings> {
  const stored = (await s.settings.getSetting<Partial<SiteSettings>>(KEY)) ?? {};
  // Pages merge one by one, so a page added in a later version gets its default text.
  const merged = { ...DEFAULT_SITE, ...stored, pages: { ...DEFAULT_SITE.pages, ...(stored.pages ?? {}) } };
  const parsed = SiteSettings.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_SITE;
}

/** Saves what the CMS sent, except the terms version, which only `publishLegalVersion` changes. */
export async function saveSite(s: Services, staffId: string, value: SiteSettings): Promise<void> {
  const current = await getSite(s);
  await s.settings.setSetting(KEY, { ...value, legal: current.legal }, staffId);
}

export async function legalVersion(s: Services): Promise<string> {
  return (await getSite(s)).legal.version;
}

/** Today's date as the new version ("2026-10-12", then "2026-10-12.2" for a second one that day). */
export async function publishLegalVersion(s: Services, staffId: string, now = new Date()): Promise<string> {
  const site = await getSite(s);
  const today = now.toISOString().slice(0, 10);
  const [day, n] = site.legal.version.split('.');
  const version = day === today ? `${today}.${Number(n ?? 1) + 1}` : today;
  await s.settings.setSetting(KEY, { ...site, legal: { version } }, staffId);
  return version;
}

export async function publicSite(s: Services): Promise<PublicSite> {
  const site = await getSite(s);
  return {
    links: Object.fromEntries(Object.entries(site.links).filter(([, v]) => v)),
    contact: site.contact,
    pages: PAGE_SLUGS.map((slug) => ({ slug, title: site.pages[slug].title })),
    // No third-party ad cookies yet, so the banner only asks about the terms.
    consent: { version: site.legal.version, adsCookies: false },
  };
}

/** Fills {שם החברה} and the other tokens; a missing value stays visible as "[להשלמה: …]". */
export function fillTokens(body: string, company: CompanyDetails, fallbackEmail: string): string {
  let out = body;
  for (const [token, field] of Object.entries(PAGE_TOKENS) as [string, keyof CompanyDetails][]) {
    const value = company[field] || (field === 'privacyEmail' || field === 'accessibilityEmail' ? fallbackEmail : '');
    out = out.split(token).join(value || `[להשלמה: ${COMPANY_LABELS[field]}]`);
  }
  return out;
}

export async function publicPage(s: Services, slug: PageSlug): Promise<PublicPage> {
  const site = await getSite(s);
  const info = await s.settings.settingInfo(KEY);
  const page = site.pages[slug];
  const body = fillTokens(page.body, site.company, site.contact.email);
  return { slug, title: page.title, bodyHtml: docToHtml(textToDoc(body)), updatedAt: info?.updatedAt.toISOString() ?? null };
}
