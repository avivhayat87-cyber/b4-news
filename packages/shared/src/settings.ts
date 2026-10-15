// Settings managed in the CMS: external services ("integrations", with keys
// stored encrypted on the server) and the public site details (links, contact,
// info pages) that the site and the app display.
import { z } from 'zod';
import { DEFAULT_VIDEO_MODEL } from './social';

// ---------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------
export type IntegrationField = {
  key: string;
  label: string;
  /** Secret fields are write-only: the CMS only ever sees whether they are set and their last characters. */
  secret: boolean;
  placeholder?: string;
  help?: string;
  /** Regex the value must match (checked on the server). */
  pattern?: string;
  defaultValue?: string;
};

export type IntegrationDef = { title: string; description: string; docsUrl: string; fields: IntegrationField[] };

export const INTEGRATION_IDS = ['anthropic', 'gemini', 'google_vision', 'smtp', 'meta'] as const;
export type IntegrationId = (typeof INTEGRATION_IDS)[number];

export const INTEGRATIONS: Record<IntegrationId, IntegrationDef> = {
  anthropic: {
    title: 'Claude: כתיבה ועריכה',
    description: 'כותב את הטיוטות מהמקור, מתקן לפי ההערות שלכם, מכין טקסט לרשתות ולומד את הסגנון.',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    fields: [
      { key: 'apiKey', label: 'מפתח API', secret: true, placeholder: 'sk-ant-…', pattern: '^sk-ant-[A-Za-z0-9_\\-]{20,}$', help: 'נוצר ב-console.anthropic.com תחת API Keys' },
      { key: 'model', label: 'מודל לכתיבה', secret: false, defaultValue: 'claude-sonnet-5-5' },
      { key: 'modelFast', label: 'מודל מהיר (רשתות)', secret: false, defaultValue: 'claude-haiku-5-5' },
    ],
  },
  gemini: {
    title: 'Gemini: תמונות וסרטונים',
    description:
      'סוכן התמונות כותב את התיאורים לתמונות ואת ההנחיות לריל ולומד מהבחירות שלכם. Gemini יוצר 3 טיוטות תמונה מהירות לכל כתבה, את התמונה שנבחרה באיכות מלאה, את תמונות הסטורי (Nano Banana של Google), וסרטוני ריל כשמבקשים (Veo של Google).',
    docsUrl: 'https://aistudio.google.com/apikey',
    fields: [
      {
        key: 'apiKey',
        label: 'מפתח API',
        secret: true,
        placeholder: 'AIza…',
        // Google has more than one key format (standard "AIza…" keys and newer auth keys).
        pattern: '^[A-Za-z0-9_.\\-]{30,300}$',
        help: 'נוצר ב-aistudio.google.com תחת API Keys. מפתח ישן צריך הגבלה ל-Gemini API בלבד.',
      },
      {
        key: 'agentModel',
        label: 'מודל לסוכן התמונות',
        secret: false,
        defaultValue: 'gemini-3.8-flash',
        pattern: '^[a-z0-9][a-z0-9.\\-]{2,80}$',
        help: 'כותב את התיאורים לתמונות ואת ההנחיות לריל, ולומד מהבחירות שלכם. אפשר מודל זול יותר (gemini-3.5-flash-lite) או חזק יותר (gemini-4-argon).',
      },
      {
        key: 'previewModel',
        label: 'מודל לטיוטות (זול ומהיר)',
        secret: false,
        defaultValue: 'gemini-3.1-flash-lite-image',
        help: 'יוצר את 3 הטיוטות לבחירה, ברזולוציה נמוכה (1K).',
      },
      { key: 'imageModel', label: 'מודל לתמונה הסופית', secret: false, defaultValue: 'gemini-nano-banana-2.1', help: 'מצייר מחדש באיכות מלאה רק את הטיוטה שנבחרה, וגם את תמונות הסטורי.' },
      {
        key: 'imageSize',
        label: 'רזולוציה לתמונה הסופית (1K / 2K / 4K)',
        secret: false,
        defaultValue: '2K',
        pattern: '^(1K|2K|4K)$',
        help: 'האתר שומר תמונות עד רוחב 2400 פיקסלים, ולכן 2K כבר מספיק. 4K עולה יותר.',
      },
      {
        key: 'videoModel',
        label: 'מודל לסרטוני ריל (Veo)',
        secret: false,
        defaultValue: DEFAULT_VIDEO_MODEL,
        pattern: '^[a-z0-9][a-z0-9.\\-]{2,80}$',
        help: 'ברירת המחדל Veo 3.1 Lite (הזול). לריל מסוים אפשר לבחור מודל ואיכות אחרים במסך הריל. מודלים אחרים של Google: veo-3.1-fast-generate-preview (מהיר, יקר יותר) או veo-3.1-generate-preview (הכי איכותי ויקר). סרטון נוצר רק כשמבקשים ריל לכתבה.',
      },
    ],
  },
  google_vision: {
    title: 'Google Vision: בדיקת תמונה הפוכה',
    description:
      'כשמעלים לתחקיר צילום מסך או תמונה, בודק איפה התמונה כבר הופיעה ברשת: עמודים עם אותה תמונה, עותקים ותמונות דומות. כך הכתב-החוקר תופס תמונה ישנה שמוצגת כחדשה ומוצא את המקור. 1,000 בדיקות בחודש חינם, אחר כך 3.5 דולר לאלף.',
    docsUrl: 'https://console.cloud.google.com/apis/library/vision.googleapis.com',
    fields: [
      {
        key: 'apiKey',
        label: 'מפתח API',
        secret: true,
        placeholder: 'AIza…',
        pattern: '^AIza[0-9A-Za-z_\\-]{30,}$',
        help: 'ב-console.cloud.google.com: מפעילים את Cloud Vision API, ואז APIs & Services > Credentials > Create credentials > API key, ומגבילים את המפתח ל-Cloud Vision API. בשרת בענן לא צריך מפתח.',
      },
    ],
  },  smtp: {
    title: 'דואר יוצא',
    description: 'קודי כניסה לקוראים, אישור הרשמה לניוזלטר והתראות למפתח על אתר חדש.',
    docsUrl: 'https://nodemailer.com/smtp/',
    fields: [
      { key: 'url', label: 'כתובת SMTP', secret: true, placeholder: 'smtps://user:password@smtp.example.com:465', pattern: '^smtps?://.+' },
      { key: 'from', label: 'שולח', secret: false, defaultValue: "B4 NEW'S <no-reply@example.co.il>" },
    ],
  },
  // The app the posts go out through ("B4 NEWS Publisher"). Its secret lets the server turn the
  // personal token pasted for Facebook or Instagram into the page's token that never expires.
  meta: {
    title: 'Meta: פייסבוק ואינסטגרם',
    description:
      'האפליקציה שדרכה המערכת מפרסמת לעמוד הפייסבוק ולאינסטגרם. עם הסוד שלה מספיק להדביק בחשבונות פייסבוק ואינסטגרם (למטה) את הטוקן האישי מ-Graph API Explorer, והמערכת הופכת אותו לטוקן הקבוע של העמוד.',
    docsUrl: 'https://developers.facebook.com/apps/1665664261787346/settings/basic/',
    fields: [
      { key: 'appId', label: 'מזהה האפליקציה (App ID)', secret: false, defaultValue: '1665664261787346', pattern: '^\\d{5,25}$', help: 'המספר שמופיע למעלה במסך האפליקציה ב-developers.facebook.com.' },
      {
        key: 'appSecret',
        label: 'סוד האפליקציה (App Secret)',
        secret: true,
        placeholder: 'a1b2c3d4…',
        pattern: '^[A-Fa-f0-9]{32}$',
        help: 'במסך האפליקציה: App settings > Basic > App secret > Show. מזינים פעם אחת.',
      },
    ],
  },
};

export const IntegrationStatus = z.object({
  id: z.enum(INTEGRATION_IDS),
  connected: z.boolean(),
  /** Where the active key comes from: entered in the CMS, the server environment, or nowhere. */
  source: z.enum(['cms', 'env']).nullable(),
  fields: z.array(z.object({ key: z.string(), configured: z.boolean(), hint: z.string().nullable(), value: z.string().nullable() })),
  updatedAt: z.string().nullable(),
  updatedBy: z.string().nullable(),
});
export type IntegrationStatus = z.infer<typeof IntegrationStatus>;

/** null removes a value (falls back to the server environment, if set there). */
export const UpdateIntegrationInput = z.object({ values: z.record(z.string().trim().max(2000).nullable()) });

export const ConnectionTest = z.object({ ok: z.boolean(), message: z.string() });
export type ConnectionTest = z.infer<typeof ConnectionTest>;

export const SetTokenInput = z.object({ token: z.string().trim().min(10, 'הטוקן קצר מדי').max(4000).nullable() });

// ---------------------------------------------------------------------------
// Public site details
// ---------------------------------------------------------------------------
const OptionalUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === '' || /^https:\/\//i.test(v), 'כתובת שמתחילה ב-https://')
  .default('');

export const SITE_LINK_KEYS = ['facebook', 'instagram', 'telegram', 'whatsapp', 'x', 'tiktok', 'youtube', 'appStore', 'googlePlay'] as const;
export type SiteLinkKey = (typeof SITE_LINK_KEYS)[number];

export const SITE_LINK_LABELS: Record<SiteLinkKey, string> = {
  facebook: 'עמוד פייסבוק',
  instagram: 'אינסטגרם',
  telegram: 'ערוץ טלגרם',
  whatsapp: 'ערוץ וואטסאפ',
  x: 'X (טוויטר)',
  tiktok: 'טיקטוק',
  youtube: 'יוטיוב',
  appStore: 'האפליקציה ב-App Store',
  googlePlay: 'האפליקציה ב-Google Play',
};

export const PAGE_SLUGS = ['about', 'contact', 'advertise', 'accessibility', 'privacy', 'terms', 'comment-rules'] as const;
export type PageSlug = (typeof PAGE_SLUGS)[number];

/**
 * The version of the terms and privacy policy readers accept. Admins publish a new
 * one in the CMS after a material change; everyone is then asked to accept again.
 */
export const LEGAL_VERSION_DEFAULT = '2026-10-12';
export const LegalVersion = z.string().regex(/^\d{4}-\d{2}-\d{2}(\.\d{1,2})?$/, 'גרסה בפורמט YYYY-MM-DD');

/**
 * Placeholders the info pages may contain; the server fills them from the company
 * details below. An empty value is shown as "[להשלמה: …]" so it is noticed.
 */
export const PAGE_TOKENS = {
  '{שם החברה}': 'name',
  '{ח.פ.}': 'regNumber',
  '{כתובת החברה}': 'address',
  '{מייל לפניות}': 'privacyEmail',
  '{רכז נגישות}': 'accessibilityContact',
  '{טלפון נגישות}': 'accessibilityPhone',
  '{מייל נגישות}': 'accessibilityEmail',
  '{תאריך בדיקת נגישות}': 'accessibilityReviewedOn',
} as const satisfies Record<string, keyof CompanyDetails>;

const OptionalEmail = z
  .string()
  .trim()
  .max(254)
  .refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'כתובת מייל לא תקינה')
  .default('');

export const CompanyDetails = z.object({
  name: z.string().trim().max(120).default(''),
  regNumber: z.string().trim().max(40).default(''),
  address: z.string().trim().max(200).default(''),
  /** Privacy and legal requests; falls back to the newsroom email. */
  privacyEmail: OptionalEmail,
  accessibilityContact: z.string().trim().max(120).default(''),
  accessibilityPhone: z.string().trim().max(40).default(''),
  accessibilityEmail: OptionalEmail,
  accessibilityReviewedOn: z.string().trim().max(40).default(''),
});
export type CompanyDetails = z.infer<typeof CompanyDetails>;

export const COMPANY_LABELS: Record<keyof CompanyDetails, string> = {
  name: 'שם החברה המפעילה',
  regNumber: 'מספר ח.פ.',
  address: 'כתובת רשומה',
  privacyEmail: 'מייל לפניות פרטיות ומשפטיות',
  accessibilityContact: 'רכז/ת נגישות',
  accessibilityPhone: 'טלפון לפניות נגישות',
  accessibilityEmail: 'מייל לפניות נגישות',
  accessibilityReviewedOn: 'תאריך בדיקת הנגישות האחרונה',
};

export const SitePage = z.object({
  title: z.string().trim().min(2).max(120),
  /** Paragraphs separated by blank lines; "## " sub-heading, "- " list item. */
  body: z.string().trim().max(30_000),
});
export type SitePage = z.infer<typeof SitePage>;

export const SiteSettings = z.object({
  links: z.object(Object.fromEntries(SITE_LINK_KEYS.map((k) => [k, OptionalUrl])) as Record<SiteLinkKey, typeof OptionalUrl>),
  contact: z.object({
    email: z.string().trim().max(254).refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'כתובת מייל לא תקינה').default(''),
    phone: z.string().trim().max(40).default(''),
    address: z.string().trim().max(200).default(''),
  }),
  pages: z.object(Object.fromEntries(PAGE_SLUGS.map((s) => [s, SitePage])) as Record<PageSlug, typeof SitePage>),
  company: CompanyDetails.default({}),
  /** Set by "publish a new version" in the CMS; a PUT of the whole settings never changes it. */
  legal: z.object({ version: LegalVersion }).default({ version: LEGAL_VERSION_DEFAULT }),
});
export type SiteSettings = z.infer<typeof SiteSettings>;

/** What the site and the app read: links and contact (empty = hidden), page titles, consent. */
export const PublicSite = z.object({
  links: z.record(z.string()),
  contact: z.object({ email: z.string(), phone: z.string(), address: z.string() }),
  pages: z.array(z.object({ slug: z.enum(PAGE_SLUGS), title: z.string() })),
  consent: z.object({
    /** The terms version every reader is asked to accept. */
    version: LegalVersion,
    /** Third-party advertising cookies are in use, so the banner also asks about them. */
    adsCookies: z.boolean(),
  }),
});
export type PublicSite = z.infer<typeof PublicSite>;

export const PublicPage = z.object({ slug: z.enum(PAGE_SLUGS), title: z.string(), bodyHtml: z.string(), updatedAt: z.string().nullable() });
export type PublicPage = z.infer<typeof PublicPage>;
