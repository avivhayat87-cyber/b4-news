// Contracts for advertising: our own ad server (/admin/ads/* in the CMS, /public/ads/* for the
// site and the app). The places an ad may appear are fixed here in code, few and calm: no pop-ups,
// nothing floating, nothing over the content. Every ad carries the "פרסומת" label, which no
// setting turns off. An ad either links out or opens a short lead form that asks the reader's
// explicit consent to be contacted by the advertiser.
import { z } from 'zod';
import { CATEGORY_SLUGS } from './categories';

const id = z.string().uuid();
const iso = z.string();

/** The label on every ad (consumer protection: an ad must look like one, from the first glance). */
export const AD_LABEL = 'פרסומת';

/**
 * Where ads appear. Site: a billboard under the top of the home page and at the top of each
 * section, the side column (home and sections), beside an article and after it. App: in the home
 * feed every few stories, and after an article.
 */
export const AD_SLOTS = ['home_top', 'category_top', 'sidebar', 'article_side', 'article_end', 'app_feed', 'app_article'] as const;
export type AdSlot = (typeof AD_SLOTS)[number];

/** Each place's name, as the CMS, the site's spot preview and the advertiser's page say it. */
export const AD_SLOT_NAMES: Record<AdSlot, string> = {
  home_top: 'באנר בדף הבית',
  category_top: 'באנר בראש מדור',
  sidebar: 'טור הצד',
  article_side: 'ליד כתבה',
  article_end: 'בסוף כתבה',
  app_feed: 'פיד האפליקציה',
  app_article: 'כתבה באפליקציה',
};

/**
 * billboard: the wide strip at the top of a page, a classic leaderboard (the name stays, the size
 * shrank from 970x250 at the owner's request on 2026-10-15: a big banner pushed the news down);
 * rectangle: the classic 300x250; native: a card with a picture, a headline and a line.
 */
export const AD_FORMATS = ['billboard', 'rectangle', 'native'] as const;
export type AdFormat = (typeof AD_FORMATS)[number];

/** Which formats fit each place. */
export const AD_SLOT_FORMATS: Record<AdSlot, readonly AdFormat[]> = {
  home_top: ['billboard'],
  category_top: ['billboard'],
  sidebar: ['rectangle', 'native'],
  article_side: ['rectangle', 'native'],
  article_end: ['native', 'rectangle'],
  app_feed: ['native', 'rectangle'],
  app_article: ['native', 'rectangle'],
};

export const APP_AD_SLOTS: readonly AdSlot[] = ['app_feed', 'app_article'];

/** The site's places: the only ones Google may fill (the app's would need AdMob, a later step). */
export const WEB_AD_SLOTS = ['home_top', 'category_top', 'sidebar', 'article_side', 'article_end'] as const satisfies readonly AdSlot[];
export type WebAdSlot = (typeof WEB_AD_SLOTS)[number];

/**
 * The sizes a format is shown at, in CSS pixels (images are kept at twice that, for sharp
 * screens). A billboard has its own picture for phones; the others use one picture everywhere.
 */
export const AD_SIZES: Record<AdFormat, { desktop: { width: number; height: number }; mobile: { width: number; height: number } }> = {
  billboard: { desktop: { width: 970, height: 90 }, mobile: { width: 320, height: 50 } },
  rectangle: { desktop: { width: 300, height: 250 }, mobile: { width: 300, height: 250 } },
  native: { desktop: { width: 600, height: 338 }, mobile: { width: 600, height: 338 } },
};

/** "970×90" set apart, so a right-to-left line never shows it as "90×970". */
export const adSize = (width: number, height: number) => `⁦${width}×${height}⁩`;

export const AD_DEVICES = ['all', 'desktop', 'mobile'] as const;
export type AdDevice = (typeof AD_DEVICES)[number];

/** draft: not shown yet (waits for an admin); ended: in the archive, with its numbers. */
export const AD_STATUSES = ['draft', 'active', 'paused', 'ended'] as const;
export type AdStatus = (typeof AD_STATUSES)[number];

/** link: a click goes to the advertiser's page; lead: a click opens a short form on our site. */
export const AD_ACTIONS = ['link', 'lead'] as const;
export type AdAction = (typeof AD_ACTIONS)[number];

export const AD_LEAD_FIELDS = ['name', 'phone', 'email', 'city', 'note'] as const;
export type AdLeadField = (typeof AD_LEAD_FIELDS)[number];

/** The form's labels, in the site, the app and the CMS. */
export const AD_LEAD_FIELD_LABELS: Record<AdLeadField, string> = {
  name: 'שם מלא',
  phone: 'טלפון',
  email: 'אימייל',
  city: 'עיר',
  note: 'הערה (לא חובה)',
};

/** What the reader agrees to, kept with the lead word for word (the privacy law asks for proof of consent). */
export function adLeadConsent(sponsor: string): string {
  return `אני מסכים/ה ש${sponsor} ייצרו איתי קשר בנושא הזה, ושהפרטים שמילאתי יועברו אליהם לשם כך בלבד.`;
}

/** The consent on the "advertise with us" form. */
export const AD_INQUIRY_CONSENT = "אני מסכים/ה שצוות B4 NEW'S ייצור איתי קשר בנושא פרסום.";

/** What a business asking to advertise is interested in (the form's choices). */
export const AD_INQUIRY_INTERESTS = ['banner', 'lead_ads', 'section', 'app', 'unsure'] as const;
export type AdInquiryInterest = (typeof AD_INQUIRY_INTERESTS)[number];
export const AD_INQUIRY_INTEREST_LABELS: Record<AdInquiryInterest, string> = {
  banner: 'באנר באתר',
  lead_ads: 'מודעה עם טופס פניות',
  section: 'פרסום במדור מסוים',
  app: 'פרסום באפליקציה',
  unsure: 'עוד לא יודע/ת, אשמח להמלצה',
};

const text = (max: number) => z.string().trim().max(max);
const optionalUrl = z.union([z.literal(''), z.string().trim().url('הכתובת לא תקינה').max(1000).refine((v) => /^https?:\/\//i.test(v), 'הכתובת צריכה להתחיל ב-https://')]);
/** A picture we stored for an ad (never an outside address). */
export const AdImageKey = z.string().regex(/^\d{4}\/\d{2}\/[0-9a-f-]{36}\/ad-[a-z]+-[0-9a-f]{6}\.webp$/, 'תמונה לא תקינה');

// ---------------------------------------------------------------------------
// The CMS (admins only: leads are personal data)
// ---------------------------------------------------------------------------

const adUnit = z.union([z.literal(''), z.string().trim().regex(/^\d{6,12}$/, 'מספר יחידת המודעה הוא ספרות בלבד (מתוך data-ad-slot)')]).default('');

/**
 * Google AdSense, filling the places we allow it, only where no campaign of ours runs, and only
 * for readers who agreed to advertising cookies. Never Google's automatic placement ("Auto ads").
 */
export const AdsenseSettings = z
  .object({
    enabled: z.boolean().default(false),
    /** The publisher id, "ca-pub-" and 16 digits ("pub-…" is completed). Public: it is in every page's code anyway. */
    client: z
      .preprocess(
        (v) => (typeof v === 'string' && /^pub-\d+$/.test(v.trim()) ? `ca-${v.trim()}` : v),
        z.union([z.literal(''), z.string().trim().regex(/^ca-pub-\d{16}$/, 'מספר המפרסם נראה כך: ca-pub- ואחריו 16 ספרות')]),
      )
      .default(''),
    /** The places Google may fill. */
    slots: z.array(z.enum(WEB_AD_SLOTS)).default(['sidebar', 'article_side', 'article_end']),
    /** Each place's ad unit ("data-ad-slot" in AdSense); a place without one is never filled. */
    units: z
      .object({ home_top: adUnit, category_top: adUnit, sidebar: adUnit, article_side: adUnit, article_end: adUnit })
      .default({}),
  })
  .refine((g) => !g.enabled || g.client !== '', { message: 'כדי להפעיל את Google צריך את מספר המפרסם מ-AdSense', path: ['client'] });
export type AdsenseSettings = z.infer<typeof AdsenseSettings>;

// ---------------------------------------------------------------------------
// Rotation: a place is shared by a few advertisers, as news sites sell it
// ---------------------------------------------------------------------------

/** The most positions a place's rotation may have. */
export const MAX_AD_POSITIONS = 8;

/** How long an ad stays before the next in its place: 0 is one per page view. Calm: never faster than 15 seconds. */
export const AD_ROTATE_SECONDS = [0, 15, 20, 30, 60] as const;

/**
 * A place's rotation: how many positions it has (each campaign buys some of them, so a place of 4
 * sells quarters; an unsold position shows our own promo), and how often the ad in it changes
 * while the page is open. The app's places show one ad per view, whatever is set.
 */
const PlaceSettings = (rotateSeconds: number) =>
  z
    .object({
      positions: z.number().int().min(1).max(MAX_AD_POSITIONS).default(4),
      rotateSeconds: z
        .number()
        .int()
        .refine((v) => (AD_ROTATE_SECONDS as readonly number[]).includes(v), 'זמן החלפה לא מוכר')
        .default(rotateSeconds),
    })
    .default({});
export type AdPlaceSettings = { positions: number; rotateSeconds: number };

/** The switches over all ads. */
export const AdSettings = z.object({
  /** Off: no ad appears anywhere (the places stay empty or show our own promo). */
  enabled: z.boolean().default(true),
  /** An empty rectangle shows "advertise with B4" instead of nothing. */
  housePromo: z.boolean().default(true),
  /** In the app's feed: one ad after this many stories. */
  appFeedEvery: z.number().int().min(4).max(30).default(8),
  /** Each place's rotation (positions to sell, seconds per ad). */
  places: z
    .object({
      home_top: PlaceSettings(30),
      category_top: PlaceSettings(30),
      sidebar: PlaceSettings(30),
      article_side: PlaceSettings(30),
      article_end: PlaceSettings(30),
      app_feed: PlaceSettings(0),
      app_article: PlaceSettings(0),
    })
    .default({}),
  google: AdsenseSettings.default({}),
});
export type AdSettings = z.infer<typeof AdSettings>;

/** Whether Google may show ads at all (switched on, with a publisher id, and ads on). */
export const googleLive = (s: AdSettings) => s.enabled && s.google.enabled && s.google.client !== '';

export const AdvertiserInput = z.object({
  name: text(120).min(2, 'שם המפרסם קצר מדי'),
  contactName: text(120).default(''),
  email: z.union([z.literal(''), z.string().trim().email('כתובת מייל לא תקינה').max(254)]).default(''),
  phone: text(40).default(''),
  website: optionalUrl.default(''),
  notes: text(2000).default(''),
  /** Email each new lead to the advertiser. */
  notifyLeads: z.boolean().default(true),
});
export type AdvertiserInput = z.infer<typeof AdvertiserInput>;

export const AdvertiserDto = AdvertiserInput.extend({
  id,
  /** The advertiser's private page (numbers and leads), without signing in. */
  reportUrl: z.string(),
  campaigns: z.number().int(),
  createdAt: iso,
});
export type AdvertiserDto = z.infer<typeof AdvertiserDto>;

export const AdLeadForm = z.object({
  fields: z.array(z.enum(AD_LEAD_FIELDS)).min(1).max(AD_LEAD_FIELDS.length).default(['name', 'phone']),
  /** The heading over the form ("רוצים הצעה? השאירו פרטים"). */
  question: text(200).default(''),
  thankYou: text(300).default('תודה! הפרטים התקבלו, ויחזרו אליך בהקדם.'),
});
export type AdLeadForm = z.infer<typeof AdLeadForm>;

export const CampaignInput = z
  .object({
    advertiserId: id,
    name: text(120).min(2, 'שם הקמפיין קצר מדי'),
    slots: z.array(z.enum(AD_SLOTS)).min(1, 'בחרו לפחות מקום אחד'),
    /** Empty: every section. */
    categories: z.array(z.enum(CATEGORY_SLUGS)).default([]),
    devices: z.enum(AD_DEVICES).default('all'),
    startsAt: iso.datetime({ offset: true }).nullable().default(null),
    endsAt: iso.datetime({ offset: true }).nullable().default(null),
    /**
     * How many of each place's rotation positions it buys (1 of 4 is a quarter of the views; as
     * many as the place has is the whole place). Two campaigns can't hold more than a place has.
     */
    share: z.number().int().min(1).max(MAX_AD_POSITIONS).default(1),
    /** The campaign ends after this many views (null: no cap). */
    maxViews: z.number().int().min(100).max(100_000_000).nullable().default(null),
    /** How many times a day the same reader sees it, at most. */
    perReaderDaily: z.number().int().min(1).max(20).default(3),
    action: z.enum(AD_ACTIONS).default('link'),
    url: optionalUrl.default(''),
    leadForm: AdLeadForm.default({}),
    notes: text(2000).default(''),
  })
  .refine((c) => c.action !== 'link' || c.url !== '', { message: 'מודעה עם קישור צריכה כתובת', path: ['url'] })
  .refine((c) => !c.startsAt || !c.endsAt || c.startsAt < c.endsAt, { message: 'תאריך הסיום לפני תאריך ההתחלה', path: ['endsAt'] });
export type CampaignInput = z.infer<typeof CampaignInput>;

export const CreativeInput = z.object({
  format: z.enum(AD_FORMATS),
  /** A native ad's headline (banners carry their words in the picture). */
  headline: text(90).default(''),
  body: text(200).default(''),
  cta: text(30).default(''),
  /** The name shown as "בחסות" (default: the advertiser's). */
  sponsor: text(60).default(''),
  desktopImage: AdImageKey.nullable().default(null),
  mobileImage: AdImageKey.nullable().default(null),
  /** What the picture says, for screen readers (a banner's words). */
  alt: text(200).default(''),
  active: z.boolean().default(true),
});
export type CreativeInput = z.infer<typeof CreativeInput>;

/** What the ads agent found when it checked an ad. */
export const AdReviewDto = z.object({
  verdict: z.enum(['ok', 'fix', 'block']),
  issues: z.array(z.object({ what: z.string(), why: z.string(), fix: z.string() })),
  checkedAt: iso,
});
export type AdReviewDto = z.infer<typeof AdReviewDto>;

export const AdTotals = z.object({ served: z.number().int(), views: z.number().int(), clicks: z.number().int(), leads: z.number().int() });
export type AdTotals = z.infer<typeof AdTotals>;

export const CreativeDto = CreativeInput.extend({
  id,
  campaignId: id,
  desktopUrl: z.string().nullable(),
  mobileUrl: z.string().nullable(),
  review: AdReviewDto.nullable(),
  totals: AdTotals,
});
export type CreativeDto = z.infer<typeof CreativeDto>;

export const CampaignDto = z.object({
  id,
  advertiserId: id,
  advertiserName: z.string(),
  name: z.string(),
  status: z.enum(AD_STATUSES),
  slots: z.array(z.enum(AD_SLOTS)),
  categories: z.array(z.enum(CATEGORY_SLUGS)),
  devices: z.enum(AD_DEVICES),
  startsAt: iso.nullable(),
  endsAt: iso.nullable(),
  share: z.number().int(),
  maxViews: z.number().int().nullable(),
  perReaderDaily: z.number().int(),
  action: z.enum(AD_ACTIONS),
  url: z.string(),
  leadForm: AdLeadForm,
  notes: z.string(),
  /** The ads agent's summary for the advertiser's page. */
  reportNote: z.string(),
  approvedBy: z.string().nullable(),
  approvedAt: iso.nullable(),
  endedAt: iso.nullable(),
  createdAt: iso,
  creatives: z.array(CreativeDto),
  totals: AdTotals,
  newLeads: z.number().int(),
});
export type CampaignDto = z.infer<typeof CampaignDto>;

export const AdsOverviewDto = z.object({
  settings: AdSettings,
  advertisers: z.array(AdvertiserDto),
  /** Drafts, running and paused. */
  campaigns: z.array(CampaignDto),
  /** Ended campaigns, newest first, with their numbers (deleted only by hand). */
  archive: z.array(CampaignDto),
  newLeads: z.number().int(),
  newInquiries: z.number().int(),
});
export type AdsOverviewDto = z.infer<typeof AdsOverviewDto>;

export const SetCampaignStatusInput = z.object({ status: z.enum(AD_STATUSES) });

// ---------------------------------------------------------------------------
// The occupancy board: what is free and what is taken, per place and day
// ---------------------------------------------------------------------------

/** Which pages a place is on: the home page, and the sections (their pages and their articles). */
export const AD_SLOT_PAGES: Record<AdSlot, { home: boolean; sections: boolean }> = {
  home_top: { home: true, sections: false },
  category_top: { home: false, sections: true },
  sidebar: { home: true, sections: true },
  article_side: { home: false, sections: true },
  article_end: { home: false, sections: true },
  app_feed: { home: true, sections: true },
  app_article: { home: false, sections: true },
};

/**
 * A campaign as the board counts it: its places, sections and devices, its days in Israel time
 * (YYYY-MM-DD; to null: until ended by hand) and its share. Running and paused campaigns hold their
 * positions; a draft is shown as waiting, and takes them only when approved.
 */
export const AdBooking = z.object({
  campaignId: id,
  name: z.string(),
  advertiserName: z.string(),
  status: z.enum(['draft', 'active', 'paused']),
  share: z.number().int(),
  slots: z.array(z.enum(AD_SLOTS)),
  categories: z.array(z.enum(CATEGORY_SLUGS)),
  devices: z.enum(AD_DEVICES),
  from: z.string(),
  to: z.string().nullable(),
});
export type AdBooking = z.infer<typeof AdBooking>;

export const AdAvailabilityDto = z.object({
  /** Today in Israel. */
  today: z.string(),
  places: z.array(z.object({ slot: z.enum(AD_SLOTS), positions: z.number().int(), rotateSeconds: z.number().int() })),
  bookings: z.array(AdBooking),
});
export type AdAvailabilityDto = z.infer<typeof AdAvailabilityDto>;

/** The day a moment falls on in Israel, as YYYY-MM-DD. */
export const israelDayOf = (at: Date | string): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));

/** A day plus n days (YYYY-MM-DD). */
export const addDays = (day: string, n: number): string => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** A campaign's days: from its start (or its approval, or today), to the day its end falls in (null: open). */
export function bookingDays(c: { startsAt: string | null; endsAt: string | null; approvedAt?: string | null }, today: string): { from: string; to: string | null } {
  const from = c.startsAt ? israelDayOf(c.startsAt) : c.approvedAt ? israelDayOf(c.approvedAt) : today;
  // An end at midnight closes the day before it.
  return { from, to: c.endsAt ? israelDayOf(new Date(Date.parse(c.endsAt) - 1)) : null };
}

type Context = { page: string; device: 'desktop' | 'mobile' };
type Target = { categories: readonly string[]; devices: AdDevice };

/** The pages and devices a place appears on, for everything or for one campaign's sections and devices. */
function contextsOf(slot: AdSlot, target?: Target): Context[] {
  const where = AD_SLOT_PAGES[slot];
  const sections = CATEGORY_SLUGS as readonly string[];
  let pages = [...(where.home ? ['home'] : []), ...(where.sections ? sections : [])];
  if (target?.categories.length) pages = pages.filter((p) => target.categories.includes(p));
  const devices: Context['device'][] = (APP_AD_SLOTS as readonly AdSlot[]).includes(slot) ? ['mobile'] : ['desktop', 'mobile'];
  return pages.flatMap((page) => devices.filter((d) => !target || target.devices === 'all' || target.devices === d).map((device) => ({ page, device })));
}

const runsOn = (b: Pick<AdBooking, 'from' | 'to'>, day: string) => b.from <= day && (b.to === null || day <= b.to);

/** Whether a campaign shows on a page and device: a campaign for sections never shows on the home page. */
const covers = (b: Target, c: Context) => (c.page === 'home' ? b.categories.length === 0 : b.categories.length === 0 || b.categories.includes(c.page)) && (b.devices === 'all' || b.devices === c.device);

/**
 * How full a place is on a day: the most positions taken on any page and device it appears on
 * (only those of `target` when given), by running and paused campaigns (booked) and by drafts
 * (waiting), and the campaigns there. A share never counts for more than the place has.
 */
export function occupancy(bookings: readonly AdBooking[], slot: AdSlot, day: string, positions: number, opts: { target?: Target; except?: string } = {}) {
  const here = bookings.filter((b) => b.campaignId !== opts.except && b.slots.includes(slot) && runsOn(b, day));
  let booked = 0;
  let waiting = 0;
  const seen = new Set<string>();
  for (const c of contextsOf(slot, opts.target)) {
    const on = here.filter((b) => covers(b, c));
    for (const b of on) seen.add(b.campaignId);
    const sum = (list: AdBooking[]) => list.reduce((n, b) => n + Math.min(b.share, positions), 0);
    booked = Math.max(booked, sum(on.filter((b) => b.status !== 'draft')));
    waiting = Math.max(waiting, sum(on.filter((b) => b.status === 'draft')));
  }
  return { booked, waiting, free: Math.max(0, positions - booked), campaigns: here.filter((b) => seen.has(b.campaignId)) };
}

/** How far ahead an open-ended campaign is checked. */
export const AD_BOOKING_HORIZON_DAYS = 180;

type Plan = Pick<AdBooking, 'share' | 'categories' | 'devices' | 'from' | 'to'> & { campaignId?: string };

/**
 * A campaign in one place: the least free there over its days (other running and paused campaigns
 * hold the rest), and the days its share doesn't fit. Checked from today (or its start) to its
 * end, or half a year ahead for an open-ended one.
 */
export function placeFit(bookings: readonly AdBooking[], c: Plan, slot: AdSlot, positions: number, today: string): { free: number; need: number; fullDays: string[] } {
  const start = c.from > today ? c.from : today;
  const end = c.to ?? addDays(start, AD_BOOKING_HORIZON_DAYS - 1);
  const need = Math.min(c.share, positions);
  const fullDays: string[] = [];
  let free = positions;
  for (let day = start; day <= end; day = addDays(day, 1)) {
    const f = occupancy(bookings, slot, day, positions, { target: c, except: c.campaignId }).free;
    free = Math.min(free, f);
    if (f < need) fullDays.push(day);
  }
  return { free, need, fullDays };
}

/** Where a campaign doesn't fit: each of its places with the days its share is more than what is free, and the least free there. */
export function bookingConflicts(
  bookings: readonly AdBooking[],
  c: Plan & Pick<AdBooking, 'slots'>,
  positions: (slot: AdSlot) => number,
  today: string,
): { slot: AdSlot; days: string[]; free: number }[] {
  return c.slots.flatMap((slot) => {
    const fit = placeFit(bookings, c, slot, positions(slot), today);
    return fit.fullDays.length ? [{ slot, days: fit.fullDays, free: fit.free }] : [];
  });
}

/** Days as people read them: "20.10–22.10", runs of days joined, a few at most. */
export function dayRanges(days: readonly string[], max = 3): string {
  const short = (d: string) => `${Number(d.slice(8))}.${Number(d.slice(5, 7))}`;
  const runs: [string, string][] = [];
  for (const d of days) {
    const last = runs[runs.length - 1];
    if (last && addDays(last[1], 1) === d) last[1] = d;
    else runs.push([d, d]);
  }
  const text = runs.slice(0, max).map(([a, b]) => (a === b ? short(a) : `${short(a)}–${short(b)}`));
  return runs.length > max ? `${text.join(', ')} ועוד` : text.join(', ');
}

export const AdDayDto = z.object({ day: z.string(), served: z.number().int(), views: z.number().int(), clicks: z.number().int(), leads: z.number().int() });
export type AdDayDto = z.infer<typeof AdDayDto>;

export const AdLeadDto = z.object({
  id,
  /** lead: from an ad's form; inquiry: from "advertise with us". */
  kind: z.enum(['lead', 'inquiry']),
  campaignId: id.nullable(),
  campaignName: z.string().nullable(),
  advertiserName: z.string().nullable(),
  fields: z.record(z.string()),
  consentText: z.string(),
  status: z.enum(['new', 'handled']),
  createdAt: iso,
});
export type AdLeadDto = z.infer<typeof AdLeadDto>;

export const AdLeadsQuery = z.object({ kind: z.enum(['lead', 'inquiry']).optional(), campaignId: id.optional() });
export const SetLeadStatusInput = z.object({ status: z.enum(['new', 'handled']) });

/** A picture uploaded or drawn for an ad. */
export const AdImageDto = z.object({ key: AdImageKey, url: z.string(), width: z.number().int(), height: z.number().int() });
export type AdImageDto = z.infer<typeof AdImageDto>;

// ---------------------------------------------------------------------------
// The ads agent ("סוכן הפרסום"): proposes, a person approves
// ---------------------------------------------------------------------------

export const AD_GOALS = ['leads', 'traffic', 'awareness'] as const;
export type AdGoal = (typeof AD_GOALS)[number];

export const AdBriefInput = z.object({
  advertiserId: id.nullable().default(null),
  business: text(120).min(2, 'כתבו את שם העסק'),
  website: optionalUrl.default(''),
  /** What the business offers and what is special in this campaign. */
  offer: text(1500).min(10, 'ספרו בכמה מילים מה העסק מציע'),
  goal: z.enum(AD_GOALS).default('leads'),
  audience: text(500).default(''),
  notes: text(1000).default(''),
});
export type AdBriefInput = z.infer<typeof AdBriefInput>;

export const AdBriefDto = z.object({
  summary: z.string(),
  headlines: z.array(z.string()),
  bodies: z.array(z.string()),
  ctas: z.array(z.string()),
  slots: z.array(z.enum(AD_SLOTS)),
  categories: z.array(z.enum(CATEGORY_SLUGS)),
  action: z.enum(AD_ACTIONS),
  leadFields: z.array(z.enum(AD_LEAD_FIELDS)),
  leadQuestion: z.string(),
  /** A Hebrew description of a picture for the ad, for the image model (drawn only on request). */
  imageIdea: z.string(),
  /** What a person must check before it runs (claims that need proof, a license, a disclaimer). */
  warnings: z.array(z.string()),
});
export type AdBriefDto = z.infer<typeof AdBriefDto>;

export const AD_TASK_KINDS = ['brief', 'review', 'report', 'draw'] as const;
export type AdTaskKind = (typeof AD_TASK_KINDS)[number];

/** A piece of the ads agent's work (a background job): the CMS asks for it until it is done. */
export const AdTaskDto = z.object({
  id,
  kind: z.enum(AD_TASK_KINDS),
  status: z.enum(['queued', 'running', 'done', 'failed']),
  brief: AdBriefDto.nullable(),
  review: AdReviewDto.nullable(),
  report: z.string().nullable(),
  image: AdImageDto.nullable(),
  lastError: z.string().nullable(),
  costUsd: z.number(),
  createdAt: iso,
});
export type AdTaskDto = z.infer<typeof AdTaskDto>;

/** A picture drawn by the image model from a description (costs one image). */
export const AdDrawInput = z.object({ idea: text(800).min(5, 'תארו את התמונה') });

export const BANNER_THEMES = ['dark', 'light', 'brand', 'custom'] as const;
export type BannerTheme = (typeof BANNER_THEMES)[number];

/** A banner set in the brand fonts from words (and a picture), in every size its format needs. */
export const AdComposeInput = z.object({
  format: z.enum(['billboard', 'rectangle']),
  headline: text(70).min(2, 'כתבו כותרת'),
  body: text(120).default(''),
  cta: text(24).default('לפרטים'),
  sponsor: text(60).min(1),
  theme: z.enum(BANNER_THEMES).default('dark'),
  /** The background with the custom theme, as #RRGGBB. */
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#0F3D5E'),
  photo: AdImageKey.nullable().default(null),
});
export type AdComposeInput = z.infer<typeof AdComposeInput>;

export const AdComposeDto = z.object({ desktop: AdImageDto, mobile: AdImageDto });
export type AdComposeDto = z.infer<typeof AdComposeDto>;

// ---------------------------------------------------------------------------
// The site and the app
// ---------------------------------------------------------------------------

export const PublicAdQuery = z.object({
  device: z.enum(['desktop', 'mobile']).default('desktop'),
  category: z.enum(CATEGORY_SLUGS).optional(),
  /** Campaigns this reader already saw enough today, or that are already on the page (comma-separated ids). */
  exclude: z
    .string()
    .max(800)
    .optional()
    .transform((v) => (v ? v.split(',').filter((x) => /^[0-9a-f-]{36}$/.test(x)).slice(0, 20) : [])),
});

export const PublicAd = z.object({
  slot: z.enum(AD_SLOTS),
  format: z.enum(AD_FORMATS),
  /** Signed: what the view, the click and the lead are counted for. */
  token: z.string(),
  campaignId: id,
  /** How many times a day this reader may see it (the browser keeps the count). */
  perReaderDaily: z.number().int(),
  sponsor: z.string(),
  headline: z.string(),
  body: z.string(),
  cta: z.string(),
  image: z.object({ desktop: z.string().nullable(), mobile: z.string().nullable(), alt: z.string() }),
  action: z.enum(AD_ACTIONS),
  /** A link ad: our counting address, which sends the reader on to the advertiser. */
  href: z.string().nullable(),
  lead: z.object({ fields: z.array(z.enum(AD_LEAD_FIELDS)), question: z.string(), thankYou: z.string(), consent: z.string() }).nullable(),
});
export type PublicAd = z.infer<typeof PublicAd>;

/**
 * One place's answer: an ad, or nothing (the site then shows its own promo, or leaves it empty).
 * google: no campaign here and Google may fill the place: the unit to ask Google for, shown only to
 * a reader who agreed to advertising cookies in this terms version (others get our promo).
 */
export const PublicAdSlot = z.object({
  /** What to show first (rotation[0]; the app shows only this). */
  ad: PublicAd.nullable(),
  /**
   * The place's rotation, in the order to show it: one entry per position, an unsold one null
   * (our promo there). Shuffled every time, so each campaign gets its share of first places too.
   */
  rotation: z.array(PublicAd.nullable()),
  /** Seconds before the next entry while the page is open (0: one per page view). */
  rotateSeconds: z.number().int(),
  housePromo: z.boolean(),
  appFeedEvery: z.number().int(),
  google: z.object({ client: z.string(), unit: z.string(), consentVersion: z.string() }).nullable(),
});
export type PublicAdSlot = z.infer<typeof PublicAdSlot>;

/**
 * view: the ad was seen; open: a lead ad's form was opened (its click); shown: the rotation moved
 * to it (the first entry is counted when the place is served).
 */
export const AdViewInput = z.object({ token: z.string().max(300), kind: z.enum(['view', 'open', 'shown']).default('view') });

const leadValue = z.string().trim().max(300);
export const AdLeadInput = z.object({
  token: z.string().max(300),
  fields: z.object({ name: leadValue.optional(), phone: leadValue.optional(), email: leadValue.optional(), city: leadValue.optional(), note: z.string().trim().max(1000).optional() }),
  consent: z.literal(true, { errorMap: () => ({ message: 'צריך לאשר שיחזרו אליך' }) }),
  /** Left empty by people; bots fill it. */
  website: z.string().max(0).optional(),
});
export type AdLeadInput = z.infer<typeof AdLeadInput>;

/** "Advertise with us": a name and a phone are enough; the email and the rest are optional. */
export const AdInquiryInput = z.object({
  name: text(120).min(2, 'כתבו שם'),
  company: text(120).default(''),
  phone: z.string().trim().regex(/^[0-9+\-\s()]{7,20}$/, 'מספר הטלפון לא תקין'),
  email: z.union([z.literal(''), z.string().trim().email('כתובת מייל לא תקינה').max(254)]).default(''),
  interests: z.array(z.enum(AD_INQUIRY_INTERESTS)).max(AD_INQUIRY_INTERESTS.length).default([]),
  /** The section the reader came from (a section's "advertise here" banner), if any. */
  section: z.enum(CATEGORY_SLUGS).optional(),
  message: text(2000).default(''),
  consent: z.literal(true, { errorMap: () => ({ message: 'צריך לאשר שניצור איתך קשר' }) }),
  website: z.string().max(0).optional(),
});
export type AdInquiryInput = z.infer<typeof AdInquiryInput>;

/** The advertiser's private page: their campaigns' numbers and their leads. */
export const PartnerReportDto = z.object({
  advertiser: z.string(),
  generatedAt: iso,
  campaigns: z.array(
    z.object({
      id,
      name: z.string(),
      status: z.enum(AD_STATUSES),
      startsAt: iso.nullable(),
      endsAt: iso.nullable(),
      endedAt: iso.nullable(),
      slots: z.array(z.enum(AD_SLOTS)),
      totals: AdTotals,
      days: z.array(AdDayDto),
      reportNote: z.string(),
    }),
  ),
  leads: z.array(z.object({ id, campaignName: z.string(), fields: z.record(z.string()), createdAt: iso })),
});
export type PartnerReportDto = z.infer<typeof PartnerReportDto>;
