// Serving ads to the site and the app, and counting them. A place asks for its rotation: the
// approved campaigns that run now, in that place, for that section and device, each in as many of
// the place's positions as its share, the unsold ones left to our promo, shuffled. Every ad carries
// a signed token; the view (half the ad on the screen for a second, measured by the browser), the
// click and the lead are counted against it. Only numbers are kept: no reader is identified, and
// how often one reader saw an ad is counted in their own browser.
import {
  APP_AD_SLOTS,
  AD_LABEL,
  AD_SLOT_FORMATS,
  AD_SLOTS,
  type AdSettings,
  type AdSlot,
  type PublicAd,
  type PublicAdQuery,
  type PublicAdSlot,
  WEB_AD_SLOTS,
  type WebAdSlot,
  adLeadConsent,
  googleLive,
} from '@b4/shared';
import { adCampaigns, adCreatives, adStats, and, eq, inArray, sql } from '@b4/db';
import type { SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { keyedHash, safeEqualHex } from '../../lib/crypto';
import { israelDay } from '../agent/team';
import type { Services } from '../context';
import { legalVersion } from '../site-settings';
import { creativeFits, getAdSettings } from './campaigns';

type Query = z.output<typeof PublicAdQuery>;
type Counter = 'served' | 'views' | 'clicks' | 'leads';

/** A token is good on the day it was given and the next (a page left open overnight). */
const TOKEN_DAYS = 2;

const sign = (s: Services, payload: string) => keyedHash(s.config.hashPepper, 'ad-token', payload).slice(0, 32);

export function adToken(s: Services, creativeId: string, slot: AdSlot, day = israelDay()): string {
  const payload = `${creativeId}.${slot}.${day}`;
  return `${payload}.${sign(s, payload)}`;
}

/** The ad and the place a token was given for, or null when it is forged or too old. */
export function readAdToken(s: Services, token: string, now = new Date()): { creativeId: string; slot: AdSlot } | null {
  const m = /^([0-9a-f-]{36})\.([a-z_]+)\.(\d{4}-\d{2}-\d{2})\.([0-9a-f]{32})$/.exec(token);
  if (!m) return null;
  const [, creativeId, slot, day, sig] = m as unknown as [string, string, AdSlot, string, string];
  if (!AD_SLOTS.includes(slot)) return null;
  if (!safeEqualHex(sig, sign(s, `${creativeId}.${slot}.${day}`))) return null;
  const valid = Array.from({ length: TOKEN_DAYS }, (_, i) => israelDay(new Date(now.getTime() - i * 86_400_000)));
  return valid.includes(day) ? { creativeId, slot } : null;
}

/** Adds one to a counter of today's row for the ad and the place. */
export async function bump(s: Services, creativeId: string, slot: AdSlot, counter: Counter): Promise<void> {
  const one = (k: Counter) => (k === counter ? 1 : 0);
  const set: Partial<Record<Counter, SQL>> = { [counter]: sql`${adStats[counter]} + 1` };
  await s.db
    .insert(adStats)
    .values({ day: israelDay(), creativeId, slot, served: one('served'), views: one('views'), clicks: one('clicks'), leads: one('leads') })
    .onConflictDoUpdate({ target: [adStats.day, adStats.creativeId, adStats.slot], set });
}

type Candidate = {
  campaignId: string;
  share: number;
  perReaderDaily: number;
  action: string;
  leadForm: { fields: string[]; question: string; thankYou: string };
  creative: typeof adCreatives.$inferSelect;
};

/**
 * A place's rotation: each campaign fills as many positions as its share, the unsold ones stay
 * empty (null: our promo), shuffled, so over time each gets its share of the views and of the
 * first place. More shares than positions (the place was made smaller) share it all, pro rata.
 */
export function rotationOf<T extends { campaignId: string; share: number }>(campaigns: T[], positions: number, random = Math.random): (T | null)[] {
  const filled = campaigns.flatMap((c) => Array.from({ length: Math.min(c.share, positions) }, () => c));
  const out: (T | null)[] = [...filled, ...Array.from({ length: Math.max(0, positions - filled.length) }, () => null)];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Google's unit for a place nobody bought, when Google is on and allowed there; else null. */
async function googleFor(s: Services, settings: AdSettings, slot: AdSlot): Promise<PublicAdSlot['google']> {
  if (!googleLive(settings) || !(WEB_AD_SLOTS as readonly AdSlot[]).includes(slot)) return null;
  const place = slot as WebAdSlot;
  const unit = settings.google.slots.includes(place) ? settings.google.units[place] : '';
  return unit ? { client: settings.google.client, unit, consentVersion: await legalVersion(s) } : null;
}

/**
 * One place's rotation, or none. A switched-off ad system answers none, and the site shows its own
 * promo (or nothing). A place no campaign takes may go to Google, when it is allowed there; Google
 * never shares a rotation with our campaigns (its ads may not change in place).
 */
export async function serveAd(s: Services, slot: AdSlot, q: Query, random = Math.random): Promise<PublicAdSlot> {
  const settings = await getAdSettings(s.db);
  const place = settings.places[slot];
  // The app shows one ad per view.
  const rotateSeconds = (APP_AD_SLOTS as readonly AdSlot[]).includes(slot) ? 0 : place.rotateSeconds;
  const base = { ad: null, rotation: [], rotateSeconds, housePromo: settings.housePromo, appFeedEvery: settings.appFeedEvery, google: null };
  if (!settings.enabled) return base;
  const empty = async (): Promise<PublicAdSlot> => ({ ...base, google: await googleFor(s, settings, slot) });
  const now = new Date().toISOString();
  const rows = await s.db
    .select({
      campaignId: adCampaigns.id,
      share: adCampaigns.share,
      perReaderDaily: adCampaigns.perReaderDaily,
      action: adCampaigns.action,
      leadForm: adCampaigns.leadForm,
      creative: adCreatives,
    })
    .from(adCreatives)
    .innerJoin(adCampaigns, eq(adCampaigns.id, adCreatives.campaignId))
    .where(
      and(
        eq(adCampaigns.status, 'active'),
        eq(adCreatives.active, true),
        inArray(adCreatives.format, [...AD_SLOT_FORMATS[slot]]),
        sql`${slot} = any(ad_campaigns.slots)`,
        sql`(ad_campaigns.starts_at is null or ad_campaigns.starts_at <= ${now}::timestamptz)`,
        sql`(ad_campaigns.ends_at is null or ad_campaigns.ends_at > ${now}::timestamptz)`,
        sql`ad_campaigns.devices in ('all', ${q.device})`,
        // A campaign for some sections appears only in them (the home page has no section).
        q.category ? sql`(cardinality(ad_campaigns.categories) = 0 or ${q.category} = any(ad_campaigns.categories))` : sql`cardinality(ad_campaigns.categories) = 0`,
        q.exclude.length ? sql`ad_campaigns.id not in (${sql.join(q.exclude.map((x) => sql`${x}::uuid`), sql`, `)})` : undefined,
        sql`(ad_campaigns.max_views is null or (select coalesce(sum(st.views), 0) from ad_stats st join ad_creatives cr on cr.id = st.creative_id where cr.campaign_id = ad_campaigns.id) < ad_campaigns.max_views)`,
      ),
    );
  const fitting: Candidate[] = rows.filter((r) => creativeFits(r.creative, slot, q.device));
  const campaigns = [...new Map(fitting.map((r) => [r.campaignId, { campaignId: r.campaignId, share: r.share }])).values()];
  if (!campaigns.length) return empty();
  // Each position of a campaign shows one of its ads, at random (a campaign with two ads rotates both).
  const picks = rotationOf(campaigns, place.positions, random).map((c) => {
    if (!c) return null;
    const mine = fitting.filter((r) => r.campaignId === c.campaignId);
    return mine[Math.floor(random() * mine.length)] ?? mine[0]!;
  });
  // The first is counted as served now; the page reports each one the rotation moves to.
  if (picks[0]) await bump(s, picks[0].creative.id, slot, 'served');
  const rotation = picks.map((p) => (p ? toPublicAd(s, slot, p) : null));
  return { ...base, ad: rotation[0] ?? null, rotation };
}

function toPublicAd(s: Services, slot: AdSlot, r: Candidate): PublicAd {
  const c = r.creative;
  const token = adToken(s, c.id, slot);
  const lead = r.action === 'lead';
  return {
    slot,
    format: c.format as PublicAd['format'],
    token,
    campaignId: r.campaignId,
    perReaderDaily: r.perReaderDaily,
    sponsor: c.sponsor,
    headline: c.headline,
    body: c.body,
    cta: c.cta,
    image: { desktop: c.desktopImage ? s.storage.url(c.desktopImage) : null, mobile: c.mobileImage ? s.storage.url(c.mobileImage) : null, alt: c.alt || `${AD_LABEL}: ${c.sponsor}` },
    action: lead ? 'lead' : 'link',
    href: lead ? null : `${s.config.publicApiUrl}/api/v1/public/ads/go/${token}`,
    lead: lead
      ? {
          fields: r.leadForm.fields as NonNullable<PublicAd['lead']>['fields'],
          question: r.leadForm.question,
          thankYou: r.leadForm.thankYou || 'תודה! הפרטים התקבלו, ויחזרו אליך בהקדם.',
          consent: adLeadConsent(c.sponsor),
        }
      : null,
  };
}

/**
 * A view the browser measured, or a lead ad's form opened (that ad's click: it goes nowhere else).
 * A bad token counts nothing, and says nothing: there is nothing to fix on the reader's side.
 */
export async function recordView(s: Services, token: string, kind: 'view' | 'open' | 'shown' = 'view'): Promise<void> {
  const t = readAdToken(s, token);
  if (!t) return;
  const [c] = await s.db
    .select({ action: adCampaigns.action })
    .from(adCreatives)
    .innerJoin(adCampaigns, eq(adCampaigns.id, adCreatives.campaignId))
    .where(eq(adCreatives.id, t.creativeId))
    .limit(1);
  if (!c) return;
  if (kind === 'view') await bump(s, t.creativeId, t.slot, 'views');
  else if (kind === 'shown') await bump(s, t.creativeId, t.slot, 'served');
  else if (c.action === 'lead') await bump(s, t.creativeId, t.slot, 'clicks');
}

/** Our tag on the advertiser's address, so their own analytics see where the reader came from (their own tags win). */
export function withCampaignTags(url: string, tags: { campaign: string; format: string; slot: string }): string {
  const u = new URL(url);
  const set = (k: string, v: string) => {
    if (!u.searchParams.has(k)) u.searchParams.set(k, v);
  };
  set('utm_source', 'b4news');
  set('utm_medium', tags.format === 'native' ? 'native' : 'display');
  set('utm_campaign', tags.campaign);
  set('utm_content', tags.slot);
  return u.toString();
}

/** A click: counted, then the reader goes on to the advertiser's page. Null: nowhere to go (the site's home instead). */
export async function recordClick(s: Services, token: string): Promise<string | null> {
  const t = readAdToken(s, token);
  if (!t) return null;
  const [row] = await s.db
    .select({ url: adCampaigns.url, name: adCampaigns.name, action: adCampaigns.action, format: adCreatives.format })
    .from(adCreatives)
    .innerJoin(adCampaigns, eq(adCampaigns.id, adCreatives.campaignId))
    .where(eq(adCreatives.id, t.creativeId))
    .limit(1);
  if (!row || row.action !== 'link' || !row.url) return null;
  await bump(s, t.creativeId, t.slot, 'clicks');
  return withCampaignTags(row.url, { campaign: row.name, format: row.format, slot: t.slot });
}
