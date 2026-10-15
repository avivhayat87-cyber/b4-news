// Leads: a reader's details from an ad's form, given with explicit consent to be contacted by the
// advertiser, and businesses asking to advertise with us (the "advertise" page). The details are
// encrypted at rest and kept, with the consent word for word, until an admin deletes them (the
// owner's decision: no automatic deletion). The advertiser sees their own on their private page.
import { randomUUID } from 'node:crypto';
import {
  AD_INQUIRY_CONSENT,
  AD_INQUIRY_INTEREST_LABELS,
  AD_LEAD_FIELD_LABELS,
  AD_LEAD_FIELDS,
  type AdInquiryInput,
  type AdLeadDto,
  type AdLeadField,
  type AdLeadInput,
  type AdStatus,
  type AdSlot,
  CATEGORIES,
  type PartnerReportDto,
  adLeadConsent,
} from '@b4/shared';
import { type Db, adCampaigns, adCreatives, adLeads, advertisers, and, desc, eq, inArray, sql, users } from '@b4/db';
import { AppError, errors } from '../../errors';
import { keyedHash, safeEqualHex } from '../../lib/crypto';
import { SecretBox } from '../../lib/secret-box';
import type { Services } from '../context';
import { getSite } from '../site-settings';
import { campaignDays, partnerKey, sinceDays } from './campaigns';
import { bump, readAdToken } from './serve';

/** How far back the advertiser's page draws the days. */
const REPORT_DAYS = 60;
const LEAD_LIMIT = 2000;
const THANK_YOU = 'תודה! הפרטים התקבלו, ויחזרו אליך בהקדם.';

type Fields = Partial<Record<AdLeadField | 'company' | 'message' | 'interests' | 'section', string>>;

const box = (s: Services) => new SecretBox(s.config.secretsKey);
const seal = (s: Services, id: string, fields: Fields) => box(s).seal(`ad-lead:${id}`, JSON.stringify(fields));

function open(s: Services, id: string, sealed: string): Record<string, string> {
  try {
    return JSON.parse(box(s).open(`ad-lead:${id}`, sealed)) as Record<string, string>;
  } catch {
    // Encrypted with another key (a copy of the live data in the workshop): nothing to show.
    return {};
  }
}

const badLead = (message: string) => new AppError(400, 'bad_lead', message);

/** The fields the campaign asks for, checked: each one filled (the note is optional), a phone that looks like one, an email that is one. */
function checkFields(asked: AdLeadField[], given: AdLeadInput['fields']): Fields {
  const out: Fields = {};
  for (const f of asked) {
    const value = (given[f] ?? '').trim();
    if (!value) {
      if (f === 'note') continue;
      throw badLead(`חסר: ${AD_LEAD_FIELD_LABELS[f]}`);
    }
    if (f === 'phone' && !/^[0-9+\-\s()]{7,20}$/.test(value)) throw badLead('מספר הטלפון לא תקין');
    if (f === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw badLead('כתובת המייל לא תקינה');
    out[f] = value;
  }
  return out;
}

const mailFailed = (s: Services) => (err: unknown) => s.log.warn({ err: err instanceof Error ? err.message : err }, 'ad lead mail failed');

/** A lead from an ad's form. The advertiser gets an email (when they asked for one), with a link to their page. */
export async function submitLead(s: Services, input: AdLeadInput, ip: string): Promise<{ thankYou: string }> {
  const t = readAdToken(s, input.token);
  if (!t) throw badLead('הטופס פג תוקף. רעננו את הדף ונסו שוב.');
  const [row] = await s.db
    .select({ creative: adCreatives, campaign: adCampaigns, advertiser: advertisers })
    .from(adCreatives)
    .innerJoin(adCampaigns, eq(adCampaigns.id, adCreatives.campaignId))
    .innerJoin(advertisers, eq(advertisers.id, adCampaigns.advertiserId))
    .where(eq(adCreatives.id, t.creativeId))
    .limit(1);
  if (!row || row.campaign.action !== 'lead' || row.campaign.status === 'draft') throw badLead('הטופס הזה כבר לא פעיל.');
  const fields = checkFields(row.campaign.leadForm.fields as AdLeadField[], input.fields);
  const id = randomUUID();
  await s.db.insert(adLeads).values({
    id,
    kind: 'lead',
    campaignId: row.campaign.id,
    creativeId: row.creative.id,
    sealed: seal(s, id, fields),
    consentText: adLeadConsent(row.creative.sponsor),
    ipHash: keyedHash(s.config.hashPepper, 'ip', ip),
  });
  await bump(s, row.creative.id, t.slot as AdSlot, 'leads');
  const a = row.advertiser;
  if (a.notifyLeads && a.email) {
    const lines = AD_LEAD_FIELDS.filter((f) => fields[f]).map((f) => `${AD_LEAD_FIELD_LABELS[f].replace(' (לא חובה)', '')}: ${fields[f]}`);
    await s.mailer
      .send({
        to: a.email,
        subject: `ליד חדש מ-B4 NEW'S: ${row.campaign.name}`,
        text: `שלום,\n\nהתקבל ליד חדש מהמודעה שלכם ב-B4 NEW'S (${row.campaign.name}):\n\n${lines.join('\n')}\n\nהפונה אישר/ה: "${adLeadConsent(row.creative.sponsor)}"\n\nכל הלידים והנתונים של הקמפיין:\n${s.config.publicSiteUrl}/partner/${partnerKey(s, a.id, a.linkVersion)}\n\nצוות B4 NEW'S`,
      })
      .then(() => s.db.update(adLeads).set({ notifiedAt: new Date() }).where(eq(adLeads.id, id)))
      .catch(mailFailed(s));
  }
  return { thankYou: row.campaign.leadForm.thankYou || THANK_YOU };
}

/**
 * A business asks to advertise with us (the "advertise" page): kept as an inquiry, and every
 * active admin (and the site's contact address) gets an email with the details and a link.
 */
export async function submitInquiry(s: Services, input: AdInquiryInput, ip: string): Promise<void> {
  const id = randomUUID();
  const section = input.section ? (CATEGORIES.find((c) => c.slug === input.section)?.name ?? '') : '';
  const fields: Fields = {
    name: input.name,
    company: input.company,
    phone: input.phone,
    email: input.email,
    interests: input.interests.map((i) => AD_INQUIRY_INTEREST_LABELS[i]).join(', '),
    section,
    message: input.message,
  };
  await s.db.insert(adLeads).values({ id, kind: 'inquiry', sealed: seal(s, id, fields), consentText: AD_INQUIRY_CONSENT, ipHash: keyedHash(s.config.hashPepper, 'ip', ip) });
  const site = await getSite(s);
  const admins = await s.db.select({ email: users.email }).from(users).where(and(eq(users.role, 'admin'), eq(users.isActive, true)));
  const to = [...new Set([...admins.map((a) => a.email), site.contact.email].filter(Boolean))];
  const lines = [
    `שם: ${input.name}`,
    `טלפון: ${input.phone}`,
    `מייל: ${input.email || '-'}`,
    `עסק: ${input.company || '-'}`,
    fields.interests ? `מה מעניין: ${fields.interests}` : '',
    section ? `הגיע מהמדור: ${section}` : '',
    input.message ? `\nעל העסק:\n${input.message}` : '',
  ].filter(Boolean);
  for (const address of to) {
    await s.mailer
      .send({
        to: address,
        subject: `פנייה חדשה לפרסום: ${input.company || input.name}`,
        text: `עסק השאיר פרטים בעמוד "פרסמו אצלנו".\n\n${lines.join('\n')}\n\nכל הפניות במערכת: ${s.config.cmsUrl}/ads?tab=inquiries`,
      })
      .catch(mailFailed(s));
  }
}

/** What waits for a person in advertising (the menu's badge). */
export async function waitingLeads(db: Db): Promise<{ newLeads: number; newInquiries: number }> {
  const rows = await db.select({ kind: adLeads.kind, n: sql<number>`count(*)::int` }).from(adLeads).where(eq(adLeads.status, 'new')).groupBy(adLeads.kind);
  return { newLeads: rows.find((r) => r.kind === 'lead')?.n ?? 0, newInquiries: rows.find((r) => r.kind === 'inquiry')?.n ?? 0 };
}

// ---------------------------------------------------------------------------
// The CMS (admins only)
// ---------------------------------------------------------------------------

export async function listLeads(s: Services, q: { kind?: 'lead' | 'inquiry'; campaignId?: string }): Promise<AdLeadDto[]> {
  const rows = await s.db
    .select({ l: adLeads, campaign: adCampaigns.name, advertiser: advertisers.name })
    .from(adLeads)
    .leftJoin(adCampaigns, eq(adCampaigns.id, adLeads.campaignId))
    .leftJoin(advertisers, eq(advertisers.id, adCampaigns.advertiserId))
    .where(and(q.kind ? eq(adLeads.kind, q.kind) : undefined, q.campaignId ? eq(adLeads.campaignId, q.campaignId) : undefined))
    .orderBy(desc(adLeads.createdAt))
    .limit(LEAD_LIMIT);
  return rows.map(({ l, campaign, advertiser }) => ({
    id: l.id,
    kind: l.kind as AdLeadDto['kind'],
    campaignId: l.campaignId,
    campaignName: campaign,
    advertiserName: advertiser,
    fields: open(s, l.id, l.sealed),
    consentText: l.consentText,
    status: l.status as AdLeadDto['status'],
    createdAt: l.createdAt.toISOString(),
  }));
}

export async function setLeadStatus(s: Services, id: string, status: 'new' | 'handled'): Promise<void> {
  const done = await s.db.update(adLeads).set({ status }).where(eq(adLeads.id, id)).returning({ id: adLeads.id });
  if (!done.length) throw errors.notFound('הליד');
}

export async function deleteLead(s: Services, id: string): Promise<void> {
  const done = await s.db.delete(adLeads).where(eq(adLeads.id, id)).returning({ id: adLeads.id });
  if (!done.length) throw errors.notFound('הליד');
}

// ---------------------------------------------------------------------------
// The advertiser's private page
// ---------------------------------------------------------------------------

/** The page behind an advertiser's link: their campaigns (not drafts), the last days' numbers, and their leads. */
export async function partnerReport(s: Services, key: string): Promise<PartnerReportDto> {
  const [advertiserId, sig] = key.split('.');
  const notFound = errors.notFound('הדוח');
  if (!advertiserId || !sig || !/^[0-9a-f-]{36}$/.test(advertiserId)) throw notFound;
  const [a] = await s.db.select().from(advertisers).where(eq(advertisers.id, advertiserId)).limit(1);
  if (!a || !safeEqualHex(sig, partnerKey(s, a.id, a.linkVersion).split('.')[1]!)) throw notFound;
  const campaigns = await s.db
    .select()
    .from(adCampaigns)
    .where(and(eq(adCampaigns.advertiserId, a.id), inArray(adCampaigns.status, ['active', 'paused', 'ended'])))
    .orderBy(desc(adCampaigns.createdAt));
  const since = sinceDays(REPORT_DAYS);
  const out: PartnerReportDto['campaigns'] = [];
  for (const c of campaigns) {
    const days = await campaignDays(s.db, c.id, '0000-00-00');
    const totals = days.reduce((t, d) => ({ served: t.served + d.served, views: t.views + d.views, clicks: t.clicks + d.clicks, leads: t.leads + d.leads }), { served: 0, views: 0, clicks: 0, leads: 0 });
    out.push({
      id: c.id,
      name: c.name,
      status: c.status as AdStatus,
      startsAt: c.startsAt?.toISOString() ?? null,
      endsAt: c.endsAt?.toISOString() ?? null,
      endedAt: c.endedAt?.toISOString() ?? null,
      slots: c.slots as AdSlot[],
      totals,
      days: days.filter((d) => d.day >= since),
      reportNote: c.reportNote,
    });
  }
  const ids = campaigns.map((c) => c.id);
  const leads = ids.length
    ? await s.db.select().from(adLeads).where(and(eq(adLeads.kind, 'lead'), inArray(adLeads.campaignId, ids))).orderBy(desc(adLeads.createdAt)).limit(LEAD_LIMIT)
    : [];
  const nameOf = new Map(campaigns.map((c) => [c.id, c.name]));
  return {
    advertiser: a.name,
    generatedAt: new Date().toISOString(),
    campaigns: out,
    leads: leads.map((l) => ({ id: l.id, campaignName: nameOf.get(l.campaignId!) ?? '', fields: open(s, l.id, l.sealed), createdAt: l.createdAt.toISOString() })),
  };
}
