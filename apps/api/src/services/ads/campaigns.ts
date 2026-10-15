// The ads the CMS manages (admins only): the switches, the advertisers, their campaigns and ads,
// the numbers, and the archive. A campaign runs only after an admin approves it; when it ends (its
// date, its view cap, or by hand) it moves to the archive with its numbers and its leads, and stays
// there until an admin deletes it. Serving and counting are serve.ts; leads are leads.ts.
import {
  AD_SLOT_FORMATS,
  type AdDayDto,
  type AdDevice,
  type AdFormat,
  type AdSettings,
  AdSettings as SettingsSchema,
  type AdSlot,
  type AdStatus,
  type AdTotals,
  type AdsOverviewDto,
  type AdvertiserDto,
  type AdvertiserInput,
  type CampaignDto,
  type CampaignInput,
  type CreativeDto,
  type CreativeInput,
} from '@b4/shared';
import { type Db, adCampaigns, adCreatives, adLeads, adStats, advertisers, and, appSettings, desc, eq, gte, inArray, sql, users } from '@b4/db';
import { AppError, errors } from '../../errors';
import { keyedHash } from '../../lib/crypto';
import { israelDay } from '../agent/team';
import type { Services } from '../context';

const SETTINGS_KEY = 'ads.settings';
/** Ended campaigns shown in the archive (the newest). */
const ARCHIVE_LIMIT = 200;

type Staff = { id: string };
type AdvertiserRow = typeof advertisers.$inferSelect;
type CampaignRow = typeof adCampaigns.$inferSelect;
type CreativeRow = typeof adCreatives.$inferSelect;

// ---------------------------------------------------------------------------
// The switches over all ads
// ---------------------------------------------------------------------------

export async function getAdSettings(db: Db): Promise<AdSettings> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, SETTINGS_KEY)).limit(1);
  const parsed = SettingsSchema.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : SettingsSchema.parse({});
}

export async function saveAdSettings(db: Db, staffId: string, input: AdSettings): Promise<AdSettings> {
  const value = SettingsSchema.parse(input);
  await db
    .insert(appSettings)
    .values({ key: SETTINGS_KEY, value, updatedBy: staffId })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy: staffId, updatedAt: new Date() } });
  return value;
}

// ---------------------------------------------------------------------------
// Advertisers
// ---------------------------------------------------------------------------

/** The key of an advertiser's private report page: its id, signed with the link's version (a new version cancels the old link). */
export function partnerKey(s: Services, advertiserId: string, version: number): string {
  return `${advertiserId}.${keyedHash(s.config.hashPepper, 'ad-partner', advertiserId, String(version)).slice(0, 40)}`;
}

function toAdvertiserDto(s: Services, r: AdvertiserRow, campaigns: number): AdvertiserDto {
  return {
    id: r.id,
    name: r.name,
    contactName: r.contactName,
    email: r.email,
    phone: r.phone,
    website: r.website,
    notes: r.notes,
    notifyLeads: r.notifyLeads,
    reportUrl: `${s.config.publicSiteUrl}/partner/${partnerKey(s, r.id, r.linkVersion)}`,
    campaigns,
    createdAt: r.createdAt.toISOString(),
  };
}

async function advertiserDtos(s: Services): Promise<AdvertiserDto[]> {
  const rows = await s.db.select().from(advertisers).orderBy(advertisers.name);
  const counts = await s.db.select({ id: adCampaigns.advertiserId, n: sql<number>`count(*)::int` }).from(adCampaigns).groupBy(adCampaigns.advertiserId);
  const byId = new Map(counts.map((c) => [c.id, c.n]));
  return rows.map((r) => toAdvertiserDto(s, r, byId.get(r.id) ?? 0));
}

async function loadAdvertiser(s: Services, id: string): Promise<AdvertiserRow> {
  const [row] = await s.db.select().from(advertisers).where(eq(advertisers.id, id)).limit(1);
  if (!row) throw errors.notFound('המפרסם');
  return row;
}

export async function createAdvertiser(s: Services, input: AdvertiserInput): Promise<AdvertiserDto> {
  const [row] = await s.db.insert(advertisers).values(input).returning();
  return toAdvertiserDto(s, row!, 0);
}

export async function updateAdvertiser(s: Services, id: string, input: AdvertiserInput): Promise<AdvertiserDto> {
  await loadAdvertiser(s, id);
  await s.db.update(advertisers).set({ ...input, updatedAt: new Date() }).where(eq(advertisers.id, id));
  return (await advertiserDtos(s)).find((a) => a.id === id)!;
}

/** Only an advertiser without campaigns: their numbers and leads are never lost by accident. */
export async function deleteAdvertiser(s: Services, id: string): Promise<void> {
  await loadAdvertiser(s, id);
  const [used] = await s.db.select({ id: adCampaigns.id }).from(adCampaigns).where(eq(adCampaigns.advertiserId, id)).limit(1);
  if (used) throw new AppError(409, 'advertiser_in_use', 'למפרסם יש קמפיינים. מוחקים קודם את הקמפיינים שלו (מהארכיון).');
  await s.db.delete(advertisers).where(eq(advertisers.id, id));
}

/** A new report link; the old one stops working at once. */
export async function renewAdvertiserLink(s: Services, id: string): Promise<AdvertiserDto> {
  await loadAdvertiser(s, id);
  await s.db.update(advertisers).set({ linkVersion: sql`${advertisers.linkVersion} + 1`, updatedAt: new Date() }).where(eq(advertisers.id, id));
  return (await advertiserDtos(s)).find((a) => a.id === id)!;
}

// ---------------------------------------------------------------------------
// The numbers
// ---------------------------------------------------------------------------

const noTotals = (): AdTotals => ({ served: 0, views: 0, clicks: 0, leads: 0 });

async function totalsByCreative(db: Db, ids: string[]): Promise<Map<string, AdTotals>> {
  if (!ids.length) return new Map();
  const rows = await db
    .select({
      id: adStats.creativeId,
      served: sql<number>`coalesce(sum(${adStats.served}), 0)::int`,
      views: sql<number>`coalesce(sum(${adStats.views}), 0)::int`,
      clicks: sql<number>`coalesce(sum(${adStats.clicks}), 0)::int`,
      leads: sql<number>`coalesce(sum(${adStats.leads}), 0)::int`,
    })
    .from(adStats)
    .where(inArray(adStats.creativeId, ids))
    .groupBy(adStats.creativeId);
  return new Map(rows.map((r) => [r.id, { served: r.served, views: r.views, clicks: r.clicks, leads: r.leads }]));
}

/** A campaign's days (Israel time), oldest first, from `since` (YYYY-MM-DD) on. */
export async function campaignDays(db: Db, campaignId: string, since: string): Promise<AdDayDto[]> {
  return db
    .select({
      day: adStats.day,
      served: sql<number>`sum(${adStats.served})::int`,
      views: sql<number>`sum(${adStats.views})::int`,
      clicks: sql<number>`sum(${adStats.clicks})::int`,
      leads: sql<number>`sum(${adStats.leads})::int`,
    })
    .from(adStats)
    .innerJoin(adCreatives, eq(adCreatives.id, adStats.creativeId))
    .where(and(eq(adCreatives.campaignId, campaignId), gte(adStats.day, since)))
    .groupBy(adStats.day)
    .orderBy(adStats.day);
}

/** The last `days` days, as the CMS and the advertiser's page show them. */
export function sinceDays(days: number, now = new Date()): string {
  return israelDay(new Date(now.getTime() - (days - 1) * 86_400_000));
}

// ---------------------------------------------------------------------------
// Campaigns and their ads
// ---------------------------------------------------------------------------

function toCreativeDto(s: Services, c: CreativeRow, totals: AdTotals | undefined): CreativeDto {
  return {
    id: c.id,
    campaignId: c.campaignId,
    format: c.format as AdFormat,
    headline: c.headline,
    body: c.body,
    cta: c.cta,
    sponsor: c.sponsor,
    desktopImage: c.desktopImage,
    mobileImage: c.mobileImage,
    desktopUrl: c.desktopImage ? s.storage.url(c.desktopImage) : null,
    mobileUrl: c.mobileImage ? s.storage.url(c.mobileImage) : null,
    alt: c.alt,
    active: c.active,
    review: c.review,
    totals: totals ?? noTotals(),
  };
}

/** Campaigns as the CMS shows them: with their advertiser, their ads, their numbers and their new leads. */
async function campaignDtos(s: Services, rows: { c: CampaignRow; advertiser: string; approvedBy: string | null }[]): Promise<CampaignDto[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.c.id);
  const creatives = await s.db.select().from(adCreatives).where(inArray(adCreatives.campaignId, ids)).orderBy(adCreatives.createdAt);
  const totals = await totalsByCreative(s.db, creatives.map((c) => c.id));
  const fresh = await s.db
    .select({ id: adLeads.campaignId, n: sql<number>`count(*)::int` })
    .from(adLeads)
    .where(and(inArray(adLeads.campaignId, ids), eq(adLeads.status, 'new')))
    .groupBy(adLeads.campaignId);
  const freshBy = new Map(fresh.map((f) => [f.id, f.n]));
  return rows.map(({ c, advertiser, approvedBy }) => {
    const mine = creatives.filter((x) => x.campaignId === c.id).map((x) => toCreativeDto(s, x, totals.get(x.id)));
    const sum = mine.reduce((t, x) => ({ served: t.served + x.totals.served, views: t.views + x.totals.views, clicks: t.clicks + x.totals.clicks, leads: t.leads + x.totals.leads }), noTotals());
    return {
      id: c.id,
      advertiserId: c.advertiserId,
      advertiserName: advertiser,
      name: c.name,
      status: c.status as AdStatus,
      slots: c.slots as AdSlot[],
      categories: c.categories as CampaignDto['categories'],
      devices: c.devices as AdDevice,
      startsAt: c.startsAt?.toISOString() ?? null,
      endsAt: c.endsAt?.toISOString() ?? null,
      weight: c.weight,
      maxViews: c.maxViews,
      perReaderDaily: c.perReaderDaily,
      action: c.action as CampaignDto['action'],
      url: c.url,
      leadForm: { fields: c.leadForm.fields as CampaignDto['leadForm']['fields'], question: c.leadForm.question, thankYou: c.leadForm.thankYou || 'תודה! הפרטים התקבלו, ויחזרו אליך בהקדם.' },
      notes: c.notes,
      reportNote: c.reportNote,
      approvedBy,
      approvedAt: c.approvedAt?.toISOString() ?? null,
      endedAt: c.endedAt?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
      creatives: mine,
      totals: sum,
      newLeads: freshBy.get(c.id) ?? 0,
    };
  });
}

function campaignQuery(db: Db) {
  return db
    .select({ c: adCampaigns, advertiser: advertisers.name, approvedBy: users.fullName })
    .from(adCampaigns)
    .innerJoin(advertisers, eq(advertisers.id, adCampaigns.advertiserId))
    .leftJoin(users, eq(users.id, adCampaigns.approvedBy));
}

export async function campaignDetail(s: Services, id: string): Promise<CampaignDto> {
  const rows = await campaignQuery(s.db).where(eq(adCampaigns.id, id)).limit(1);
  if (!rows.length) throw errors.notFound('הקמפיין');
  return (await campaignDtos(s, rows))[0]!;
}

async function loadCampaign(s: Services, id: string): Promise<CampaignRow> {
  const [row] = await s.db.select().from(adCampaigns).where(eq(adCampaigns.id, id)).limit(1);
  if (!row) throw errors.notFound('הקמפיין');
  return row;
}

/**
 * Running campaigns whose date passed or whose views reached their cap move to the archive. Done
 * when the CMS looks (serving already skips them), so no clock job is needed.
 */
export async function closeEnded(db: Db, now = new Date()): Promise<number> {
  const closed = await db
    .update(adCampaigns)
    .set({ status: 'ended', endedAt: now })
    .where(
      and(
        inArray(adCampaigns.status, ['active', 'paused']),
        sql`(ad_campaigns.ends_at <= ${now.toISOString()}::timestamptz or (ad_campaigns.max_views is not null and (select coalesce(sum(st.views), 0) from ad_stats st join ad_creatives cr on cr.id = st.creative_id where cr.campaign_id = ad_campaigns.id) >= ad_campaigns.max_views))`,
      ),
    )
    .returning({ id: adCampaigns.id });
  return closed.length;
}

export async function adsOverview(s: Services): Promise<AdsOverviewDto> {
  await closeEnded(s.db);
  const [settings, advertiserList, open, archived, waiting] = await Promise.all([
    getAdSettings(s.db),
    advertiserDtos(s),
    campaignQuery(s.db).where(inArray(adCampaigns.status, ['draft', 'active', 'paused'])).orderBy(desc(adCampaigns.createdAt)),
    campaignQuery(s.db).where(eq(adCampaigns.status, 'ended')).orderBy(desc(adCampaigns.endedAt)).limit(ARCHIVE_LIMIT),
    s.db.select({ kind: adLeads.kind, n: sql<number>`count(*)::int` }).from(adLeads).where(eq(adLeads.status, 'new')).groupBy(adLeads.kind),
  ]);
  const [campaigns, archive] = await Promise.all([campaignDtos(s, open), campaignDtos(s, archived)]);
  return {
    settings,
    advertisers: advertiserList,
    campaigns,
    archive,
    newLeads: waiting.find((w) => w.kind === 'lead')?.n ?? 0,
    newInquiries: waiting.find((w) => w.kind === 'inquiry')?.n ?? 0,
  };
}

const toTime = (iso: string | null) => (iso ? new Date(iso) : null);

function campaignValues(input: CampaignInput) {
  return {
    advertiserId: input.advertiserId,
    name: input.name,
    slots: [...new Set(input.slots)],
    categories: [...new Set(input.categories)],
    devices: input.devices,
    startsAt: toTime(input.startsAt),
    endsAt: toTime(input.endsAt),
    weight: input.weight,
    maxViews: input.maxViews,
    perReaderDaily: input.perReaderDaily,
    action: input.action,
    url: input.url,
    leadForm: { fields: [...new Set(input.leadForm.fields)], question: input.leadForm.question, thankYou: input.leadForm.thankYou },
    notes: input.notes,
  };
}

/** A new campaign is a draft: nothing appears until an admin approves it. */
export async function createCampaign(s: Services, staff: Staff, input: CampaignInput): Promise<CampaignDto> {
  await loadAdvertiser(s, input.advertiserId);
  const [row] = await s.db.insert(adCampaigns).values({ ...campaignValues(input), status: 'draft', createdBy: staff.id }).returning({ id: adCampaigns.id });
  return campaignDetail(s, row!.id);
}

export async function updateCampaign(s: Services, id: string, input: CampaignInput): Promise<CampaignDto> {
  await loadCampaign(s, id);
  await loadAdvertiser(s, input.advertiserId);
  await s.db.update(adCampaigns).set({ ...campaignValues(input), updatedAt: new Date() }).where(eq(adCampaigns.id, id));
  return campaignDetail(s, id);
}

/** Whether an ad can appear in a place, on large screens or on phones. */
export function creativeFits(c: Pick<CreativeRow, 'format' | 'headline' | 'desktopImage' | 'mobileImage'>, slot: AdSlot, device: 'desktop' | 'mobile'): boolean {
  if (!AD_SLOT_FORMATS[slot].includes(c.format as AdFormat)) return false;
  if (c.format === 'native') return c.headline.trim() !== '';
  if (c.format === 'billboard') return Boolean(device === 'mobile' ? c.mobileImage : c.desktopImage);
  return Boolean(c.desktopImage ?? c.mobileImage);
}

/**
 * Approving runs it (recorded with who approved); a campaign that can't show anything, or whose
 * date or cap already passed, can't be approved. Ending moves it to the archive.
 */
export async function setCampaignStatus(s: Services, staff: Staff, id: string, status: AdStatus): Promise<CampaignDto> {
  const c = await loadCampaign(s, id);
  if (status === c.status) return campaignDetail(s, id);
  if (status === 'active') {
    const creatives = await s.db.select().from(adCreatives).where(and(eq(adCreatives.campaignId, id), eq(adCreatives.active, true)));
    const usable = creatives.some((x) => (c.slots as AdSlot[]).some((slot) => creativeFits(x, slot, 'desktop') || creativeFits(x, slot, 'mobile')));
    if (!usable) throw new AppError(409, 'no_creative', 'אין בקמפיין מודעה פעילה שמתאימה למקומות שנבחרו. מוסיפים מודעה (עם תמונה, או כותרת למודעה בסגנון כתבה) ואז מאשרים.');
    if (c.endsAt && c.endsAt <= new Date()) throw new AppError(409, 'campaign_over', 'תאריך הסיום של הקמפיין כבר עבר. מעדכנים את התאריך ואז מאשרים.');
    if (c.action === 'link' && !c.url) throw new AppError(409, 'no_url', 'חסרה הכתובת שהמודעה מובילה אליה.');
  }
  await s.db
    .update(adCampaigns)
    .set({
      status,
      ...(status === 'active' ? { approvedBy: staff.id, approvedAt: new Date(), endedAt: null } : {}),
      ...(status === 'ended' ? { endedAt: new Date() } : {}),
      ...(status === 'draft' || status === 'paused' ? { endedAt: null } : {}),
      updatedAt: new Date(),
    })
    .where(eq(adCampaigns.id, id));
  return campaignDetail(s, id);
}

/** The summary on the advertiser's page (the ads agent proposes one; an admin edits and saves it). */
export async function saveReportNote(s: Services, id: string, note: string): Promise<void> {
  await loadCampaign(s, id);
  await s.db.update(adCampaigns).set({ reportNote: note, updatedAt: new Date() }).where(eq(adCampaigns.id, id));
}

const imagesOf = (rows: Pick<CreativeRow, 'desktopImage' | 'mobileImage'>[]) => [...new Set(rows.flatMap((r) => [r.desktopImage, r.mobileImage]).filter((k): k is string => Boolean(k)))];

/** Deletes a campaign with its ads, their pictures, its numbers and its leads (an admin's explicit act). */
export async function deleteCampaign(s: Services, id: string): Promise<{ leads: number }> {
  await loadCampaign(s, id);
  const creatives = await s.db.select({ desktopImage: adCreatives.desktopImage, mobileImage: adCreatives.mobileImage }).from(adCreatives).where(eq(adCreatives.campaignId, id));
  const [leads] = await s.db.select({ n: sql<number>`count(*)::int` }).from(adLeads).where(eq(adLeads.campaignId, id));
  await s.db.delete(adCampaigns).where(eq(adCampaigns.id, id));
  await s.storage.remove(imagesOf(creatives)).catch((err) => s.log.warn({ err: err instanceof Error ? err.message : err }, 'ad images not removed'));
  return { leads: leads?.n ?? 0 };
}

async function checkCreative(s: Services, campaign: CampaignRow, input: CreativeInput): Promise<void> {
  if (!(campaign.slots as AdSlot[]).some((slot) => AD_SLOT_FORMATS[slot].includes(input.format))) {
    throw new AppError(400, 'format_mismatch', 'הסוג הזה של מודעה לא מתאים לאף אחד מהמקומות שנבחרו בקמפיין.');
  }
  if (input.format === 'native' && !input.headline) throw new AppError(400, 'headline_required', 'למודעה בסגנון כתבה צריך כותרת.');
  if (input.format !== 'native' && !input.desktopImage) throw new AppError(400, 'image_required', 'צריך להעלות את תמונת הבאנר.');
}

async function sponsorFor(s: Services, campaign: CampaignRow, input: CreativeInput): Promise<string> {
  return input.sponsor || (await loadAdvertiser(s, campaign.advertiserId)).name;
}

export async function addCreative(s: Services, campaignId: string, input: CreativeInput): Promise<CampaignDto> {
  const campaign = await loadCampaign(s, campaignId);
  await checkCreative(s, campaign, input);
  await s.db.insert(adCreatives).values({ ...input, sponsor: await sponsorFor(s, campaign, input), campaignId });
  return campaignDetail(s, campaignId);
}

async function loadCreative(s: Services, id: string): Promise<CreativeRow> {
  const [row] = await s.db.select().from(adCreatives).where(eq(adCreatives.id, id)).limit(1);
  if (!row) throw errors.notFound('המודעה');
  return row;
}

/** A changed ad is checked again (its old check no longer says anything about it). */
export async function updateCreative(s: Services, id: string, input: CreativeInput): Promise<CampaignDto> {
  const old = await loadCreative(s, id);
  const campaign = await loadCampaign(s, old.campaignId);
  await checkCreative(s, campaign, input);
  const changed = old.headline !== input.headline || old.body !== input.body || old.cta !== input.cta || old.desktopImage !== input.desktopImage || old.mobileImage !== input.mobileImage;
  await s.db
    .update(adCreatives)
    .set({ ...input, sponsor: await sponsorFor(s, campaign, input), ...(changed ? { review: null } : {}), updatedAt: new Date() })
    .where(eq(adCreatives.id, id));
  const dropped = imagesOf([old]).filter((k) => k !== input.desktopImage && k !== input.mobileImage);
  if (dropped.length) await s.storage.remove(dropped).catch(() => undefined);
  return campaignDetail(s, campaign.id);
}

/** Only an ad that never ran: one with numbers is turned off instead, so the campaign's numbers stay whole. */
export async function deleteCreative(s: Services, id: string): Promise<CampaignDto> {
  const old = await loadCreative(s, id);
  const [ran] = await s.db.select({ day: adStats.day }).from(adStats).where(eq(adStats.creativeId, id)).limit(1);
  if (ran) throw new AppError(409, 'creative_has_stats', 'המודעה כבר הוצגה, ויש לה נתונים. מכבים אותה במקום למחוק, כדי שהמספרים של הקמפיין יישמרו.');
  await s.db.delete(adCreatives).where(eq(adCreatives.id, id));
  await s.storage.remove(imagesOf([old])).catch(() => undefined);
  return campaignDetail(s, old.campaignId);
}
