// Public site details edited in the CMS: social and app links, contact details,
// and the info pages linked from the footer. Defaults keep every link working
// before anyone fills them in (empty links are simply not shown).
import { PAGE_SLUGS, type PageSlug, type PublicPage, type PublicSite, SITE_LINK_KEYS, SiteSettings, docToHtml, textToDoc } from '@b4/shared';
import type { Services } from './context';

const KEY = 'site';

const DEFAULT_PAGES: Record<PageSlug, { title: string; body: string }> = {
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
  accessibility: {
    title: 'הצהרת נגישות',
    body: [
      'אנחנו רואים חשיבות רבה בהנגשת האתר והאפליקציה לאנשים עם מוגבלות, ופועלים להתאים אותם לדרישות תקן ישראלי 5568 ולהנחיות WCAG 2.1 ברמה AA.',
      '## מה עשינו',
      '- מבנה כותרות תקין וניווט מלא במקלדת',
      '- טקסט חלופי לתמונות',
      '- ניגודיות צבעים מספקת וגופנים קריאים',
      '- תמיכה בקוראי מסך ובהגדלת טקסט',
      '## נתקלתם בבעיה?',
      'אם מצאתם רכיב שאינו נגיש, נשמח שתכתבו לנו (פרטי הקשר בתחתית העמוד) ונטפל בהקדם.',
    ].join('\n\n'),
  },
  privacy: {
    title: 'מדיניות פרטיות',
    body: [
      'מדיניות זו מסבירה איזה מידע אנחנו אוספים בשימוש באתר ובאפליקציה ולמה.',
      '## מידע שאנחנו אוספים',
      '- כתובת מייל ושם תצוגה, אם נרשמתם כדי להגיב או לניוזלטר',
      '- נתוני שימוש בסיסיים ומידע טכני (סוג דפדפן ומכשיר)',
      '- מזהה מכשיר להתראות, אם אישרתם התראות באפליקציה',
      '## איך אנחנו משתמשים במידע',
      'כדי להפעיל את השירות, לשלוח את מה שביקשתם (קודי כניסה, ניוזלטר, התראות) ולשפר את האתר. אנחנו לא מוכרים מידע אישי לצד שלישי.',
      '## הזכויות שלכם',
      'אפשר לבקש לעיין במידע עליכם, לתקן אותו או למחוק אותו, ולהסיר את עצמכם מהניוזלטר בכל עת.',
    ].join('\n\n'),
  },
  terms: {
    title: 'תנאי שימוש',
    body: [
      "השימוש באתר ובאפליקציה של B4 NEW'S כפוף לתנאים אלה.",
      '## התוכן',
      'התוכן מיועד למידע כללי בלבד ואינו ייעוץ השקעות, ייעוץ משפטי או ייעוץ מס. לפני החלטה כלכלית התייעצו עם בעל מקצוע מוסמך.',
      '## תגובות גולשים',
      'אנחנו רשאים להסתיר או למחוק תגובות פוגעניות, ספאם או תגובות שמפרסמות פרטים אישיים, ולחסום משתמשים שמפרים את הכללים.',
      '## קניין רוחני',
      'התכנים באתר מוגנים בזכויות יוצרים. מותר לשתף קישורים; העתקת תוכן מלא דורשת אישור בכתב.',
    ].join('\n\n'),
  },
};

export const DEFAULT_SITE: SiteSettings = {
  links: Object.fromEntries(SITE_LINK_KEYS.map((k) => [k, ''])) as SiteSettings['links'],
  contact: { email: '', phone: '', address: '' },
  pages: DEFAULT_PAGES,
};

export async function getSite(s: Services): Promise<SiteSettings> {
  const stored = await s.settings.getSetting<unknown>(KEY);
  if (!stored) return DEFAULT_SITE;
  const merged = { ...DEFAULT_SITE, ...(stored as object) };
  const parsed = SiteSettings.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_SITE;
}

export async function saveSite(s: Services, staffId: string, value: SiteSettings): Promise<void> {
  await s.settings.setSetting(KEY, value, staffId);
}

export async function publicSite(s: Services): Promise<PublicSite> {
  const site = await getSite(s);
  return {
    links: Object.fromEntries(Object.entries(site.links).filter(([, v]) => v)),
    contact: site.contact,
    pages: PAGE_SLUGS.map((slug) => ({ slug, title: site.pages[slug].title })),
  };
}

export async function publicPage(s: Services, slug: PageSlug): Promise<PublicPage> {
  const site = await getSite(s);
  const info = await s.settings.settingInfo(KEY);
  const page = site.pages[slug];
  return { slug, title: page.title, bodyHtml: docToHtml(textToDoc(page.body)), updatedAt: info?.updatedAt.toISOString() ?? null };
}
