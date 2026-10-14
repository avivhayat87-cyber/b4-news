// Consent to the terms, content-removal requests ("notice and takedown") and the
// investment notice shown on capital-market articles.
import { z } from 'zod';
import { Email } from './auth';
import { LegalVersion } from './settings';

export const MIN_READER_AGE = 18;

/** The one checkbox shown wherever a reader signs up (comments, newsletter, the app). */
export const TERMS_CHECKBOX_LABEL = `אני בן/בת ${MIN_READER_AGE} ומעלה ומסכים/ה לתנאי השימוש ולמדיניות הפרטיות`;

const mustAccept = z.literal(true, { errorMap: () => ({ message: 'צריך לאשר את תנאי השימוש ומדיניות הפרטיות' }) });

/** A visitor's answer to the consent banner (site) or the welcome screen (app). */
export const VisitorConsentInput = z.object({
  /** Random id kept in the browser or on the device; not linked to a person. */
  visitorId: z.string().uuid(),
  version: LegalVersion,
  /** Third-party advertising cookies (only asked when they are in use). */
  ads: z.boolean().default(false),
  channel: z.enum(['web', 'app']),
});
export type VisitorConsentInput = z.infer<typeof VisitorConsentInput>;

export const AcceptTermsInput = z.object({ version: LegalVersion, accept: mustAccept });

export const NewsletterSignupInput = z.object({ email: Email, acceptTerms: mustAccept });

// ---------------------------------------------------------------------------
// "העיתון שלי": the personal newsletter (topics, time, how)
// ---------------------------------------------------------------------------
export const DIGEST_FREQUENCIES = ['daily', 'weekly'] as const;

export const DigestPrefs = z.object({
  /** Category slugs in the reader's order (empty: everything). */
  sections: z.array(z.string().max(40)).max(20).default([]),
  /** The hour it arrives, Israel time (0-23). */
  hour: z.number().int().min(0).max(23).default(7),
  /** Weekly issues go out on Sunday. */
  frequency: z.enum(DIGEST_FREQUENCIES).default('daily'),
  email: z.boolean().default(true),
  /** A notification on the phone (signed in to the app). */
  push: z.boolean().default(false),
});
export type DigestPrefs = z.infer<typeof DigestPrefs>;

export const UnsubscribeInput = z.object({
  id: z.string().uuid(),
  token: z.string().regex(/^[0-9a-f]{64}$/, 'הקישור לא תקין'),
});

// ---------------------------------------------------------------------------
// Notice and takedown
// ---------------------------------------------------------------------------
export const TAKEDOWN_KINDS = ['defamation', 'privacy', 'copyright', 'hate', 'other'] as const;
export type TakedownKind = (typeof TAKEDOWN_KINDS)[number];
export const TAKEDOWN_KIND_LABELS: Record<TakedownKind, string> = {
  defamation: 'לשון הרע או פגיעה בשם הטוב',
  privacy: 'פגיעה בפרטיות או פרטים אישיים',
  copyright: 'הפרת זכויות יוצרים',
  hate: 'הסתה, איומים או ביטויי שנאה',
  other: 'אחר',
};

export const TAKEDOWN_STATUSES = ['new', 'in_review', 'removed', 'rejected'] as const;
export type TakedownStatus = (typeof TAKEDOWN_STATUSES)[number];
export const TAKEDOWN_STATUS_LABELS: Record<TakedownStatus, string> = {
  new: 'חדשה',
  in_review: 'בבדיקה',
  removed: 'התוכן הוסר',
  rejected: 'נדחתה',
};

/** How long the newsroom has to answer a request (shown in the CMS queue). */
export const TAKEDOWN_RESPONSE_HOURS = 48;

export const TakedownInput = z.object({
  kind: z.enum(TAKEDOWN_KINDS),
  url: z
    .string()
    .trim()
    .max(1000)
    .refine((v) => /^https?:\/\/\S+$/i.test(v), 'הדביקו קישור מלא לכתבה (שמתחיל ב-https://)'),
  /** Which comment, when the request is about one (from the comment's report link). */
  commentId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(2, 'נא למלא שם').max(120),
  email: Email,
  details: z.string().trim().min(20, 'נא לפרט מה הבעיה (לפחות 20 תווים)').max(5000),
  declaration: z.literal(true, { errorMap: () => ({ message: 'צריך לאשר שהפרטים נכונים' }) }),
  /** Honeypot: people never fill it. */
  website: z.string().max(0).optional(),
});
export type TakedownInput = z.infer<typeof TakedownInput>;

export const TakedownDto = z.object({
  id: z.string().uuid(),
  kind: z.enum(TAKEDOWN_KINDS),
  status: z.enum(TAKEDOWN_STATUSES),
  url: z.string(),
  comment: z.object({ id: z.string().uuid(), body: z.string(), status: z.string(), author: z.string() }).nullable(),
  name: z.string(),
  email: z.string(),
  details: z.string(),
  decisionNote: z.string().nullable(),
  decidedBy: z.string().nullable(),
  decidedAt: z.string().nullable(),
  dueAt: z.string(),
  createdAt: z.string(),
});
export type TakedownDto = z.infer<typeof TakedownDto>;

export const DecideTakedownInput = z.object({
  status: z.enum(['in_review', 'removed', 'rejected']),
  note: z.string().trim().max(2000).optional(),
  /** Also hide the reported comment (when the request is about one). */
  hideComment: z.boolean().default(false),
});

// ---------------------------------------------------------------------------
// Investment notice
// ---------------------------------------------------------------------------
/** Sections whose articles carry the investment notice. */
export const INVESTMENT_NOTICE_CATEGORIES = ['capital-market', 'the-consultants'] as const;

export const INVESTMENT_NOTICE =
  'המידע בכתבה הוא מידע כללי בלבד, ואינו ייעוץ השקעות, שיווק השקעות או המלצה לקנות או למכור ניירות ערך או נכסים פיננסיים. הוא אינו מתחשב בנתונים ובצרכים של אף אדם. לפני החלטת השקעה התייעצו עם בעל רישיון.';

export function needsInvestmentNotice(categorySlug: string): boolean {
  return (INVESTMENT_NOTICE_CATEGORIES as readonly string[]).includes(categorySlug);
}
