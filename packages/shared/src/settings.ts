// Settings managed in the CMS: external services ("integrations", with keys
// stored encrypted on the server) and the public site details (links, contact,
// info pages) that the site and the app display.
import { z } from 'zod';

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

export const INTEGRATION_IDS = ['anthropic', 'gemini', 'smtp'] as const;
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
    title: 'Gemini: תמונות',
    description: 'יוצר את 4 התמונות לכל כתבה ואת תמונות הסטורי (Nano Banana של Google).',
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
      { key: 'imageModel', label: 'מודל תמונות', secret: false, defaultValue: 'gemini-nano-banana-2.1' },
      { key: 'imageSize', label: 'רזולוציה (1K / 2K / 4K)', secret: false, defaultValue: '2K', pattern: '^(1K|2K|4K)$' },
    ],
  },
  smtp: {
    title: 'דואר יוצא',
    description: 'קודי כניסה לקוראים, אישור הרשמה לניוזלטר והתראות למפתח על אתר חדש.',
    docsUrl: 'https://nodemailer.com/smtp/',
    fields: [
      { key: 'url', label: 'כתובת SMTP', secret: true, placeholder: 'smtps://user:password@smtp.example.com:465', pattern: '^smtps?://.+' },
      { key: 'from', label: 'שולח', secret: false, defaultValue: "B4 NEW'S <no-reply@example.co.il>" },
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

export const PAGE_SLUGS = ['about', 'contact', 'advertise', 'accessibility', 'privacy', 'terms'] as const;
export type PageSlug = (typeof PAGE_SLUGS)[number];

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
});
export type SiteSettings = z.infer<typeof SiteSettings>;

/** What the site and the app read: links and contact (empty = hidden), page titles. */
export const PublicSite = z.object({
  links: z.record(z.string()),
  contact: z.object({ email: z.string(), phone: z.string(), address: z.string() }),
  pages: z.array(z.object({ slug: z.enum(PAGE_SLUGS), title: z.string() })),
});
export type PublicSite = z.infer<typeof PublicSite>;

export const PublicPage = z.object({ slug: z.enum(PAGE_SLUGS), title: z.string(), bodyHtml: z.string(), updatedAt: z.string().nullable() });
export type PublicPage = z.infer<typeof PublicPage>;
