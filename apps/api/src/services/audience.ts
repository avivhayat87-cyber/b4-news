// The audience for the CMS ("מנויים וגולשים"): registered readers (they sign in with an email
// code to comment) and newsletter subscribers (double opt-in), with what the newsroom does about
// them: ban and lift a ban, sign a reader out everywhere, take a subscriber off the list, and,
// for admins answering a privacy request, delete a reader or a subscriber for good. Also checks
// that this environment can send the sign-in codes and confirmation mail at all.
import type { AudienceOverview, ReaderList, ReaderListQuery, SubscriberList, SubscriberListQuery, SubscriberStatus } from '@b4/shared';
import { and, desc, devices, eq, ilike, isNotNull, isNull, loginCodes, newsletterSubscribers, or, readers, sessions, sql } from '@b4/db';
import type { z } from 'zod';
import { errors } from '../errors';
import { audit } from '../lib/audit';
import type { Services } from './context';
import { getSite, legalVersion } from './site-settings';

type Staff = { id: string };
const PAGE = 50;

/** Newest first, by (created at, id). */
const encode = (row: { createdAt: Date; id: string }) => Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString('base64url');
function decode(cursor: string | undefined): { at: string; id: string } | null {
  if (!cursor) return null;
  const [at, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  return at && id && !Number.isNaN(new Date(at).getTime()) && /^[0-9a-f-]{36}$/.test(id) ? { at, id } : null;
}

// --- Overview -------------------------------------------------------------------------------------------
export async function audienceOverview(s: Services): Promise<AudienceOverview> {
  const [[r], [n], devs, setup] = await Promise.all([
    s.db
      .select({
        total: sql<number>`count(*)::int`,
        active30d: sql<number>`count(*) filter (where ${readers.lastLoginAt} > now() - interval '30 days')::int`,
        newThisWeek: sql<number>`count(*) filter (where ${readers.createdAt} > now() - interval '7 days')::int`,
        banned: sql<number>`count(*) filter (where ${readers.status} = 'banned')::int`,
      })
      .from(readers),
    s.db
      .select({
        active: sql<number>`count(*) filter (where ${newsletterSubscribers.confirmedAt} is not null and ${newsletterSubscribers.unsubscribedAt} is null)::int`,
        pending: sql<number>`count(*) filter (where ${newsletterSubscribers.confirmedAt} is null and ${newsletterSubscribers.unsubscribedAt} is null)::int`,
        unsubscribed: sql<number>`count(*) filter (where ${newsletterSubscribers.unsubscribedAt} is not null)::int`,
      })
      .from(newsletterSubscribers),
    s.db.select({ platform: devices.platform, n: sql<number>`count(*)::int` }).from(devices).groupBy(devices.platform),
    audienceSetup(s),
  ]);
  const device = (p: string) => devs.find((d) => d.platform === p)?.n ?? 0;
  return {
    readers: { total: r?.total ?? 0, active30d: r?.active30d ?? 0, newThisWeek: r?.newThisWeek ?? 0, banned: r?.banned ?? 0 },
    subscribers: { active: n?.active ?? 0, pending: n?.pending ?? 0, unsubscribed: n?.unsubscribed ?? 0 },
    devices: { ios: device('ios'), android: device('android'), web: device('web') },
    setup,
  };
}

/** Without outgoing mail nobody can sign in or confirm a subscription; the rest is what the law and the mail providers expect. */
async function audienceSetup(s: Services): Promise<AudienceOverview['setup']> {
  const [smtp, site] = await Promise.all([s.settings.integration('smtp'), getSite(s)]);
  const c = site.company;
  return [
    { key: 'mail', ok: Boolean(smtp.url) },
    { key: 'sender', ok: Boolean(smtp.from) && !/example\./i.test(smtp.from ?? '') },
    { key: 'company', ok: Boolean(c.name && c.regNumber && c.address && (c.privacyEmail || site.contact.email)) },
    { key: 'https', ok: s.config.publicSiteUrl.startsWith('https://') },
  ];
}

// --- Readers ----------------------------------------------------------------------------------------------
export async function listReaders(s: Services, query: z.infer<typeof ReaderListQuery>): Promise<ReaderList> {
  const version = await legalVersion(s);
  const c = decode(query.cursor);
  const q = query.q?.trim();
  // Written out in full: a one-table select leaves "id" unqualified, which a subquery would read as its own.
  const rows = await s.db
    .select({
      r: readers,
      comments: sql<number>`(select count(*)::int from comments c where c.reader_id = readers.id)`,
      hidden: sql<number>`(select count(*)::int from comments c where c.reader_id = readers.id and c.status <> 'visible')`,
      signedIn: sql<boolean>`exists (select 1 from sessions x where x.reader_id = readers.id and x.expires_at > now())`,
    })
    .from(readers)
    .where(
      and(
        query.status === 'all' ? undefined : eq(readers.status, query.status),
        q ? or(ilike(readers.email, `%${q}%`), ilike(readers.displayName, `%${q}%`)) : undefined,
        c ? sql`(${readers.createdAt}, ${readers.id}) < (${c.at}::timestamptz, ${c.id}::uuid)` : undefined,
      ),
    )
    .orderBy(desc(readers.createdAt), desc(readers.id))
    .limit(PAGE + 1);
  const page = rows.slice(0, PAGE);
  return {
    items: page.map(({ r, ...x }) => ({
      id: r.id,
      email: r.email,
      displayName: r.displayName,
      status: r.status,
      bannedReason: r.bannedReason,
      termsAccepted: r.termsVersion === version,
      createdAt: r.createdAt.toISOString(),
      lastLoginAt: r.lastLoginAt?.toISOString() ?? null,
      comments: x.comments,
      hiddenComments: x.hidden,
      signedIn: Boolean(x.signedIn),
    })),
    nextCursor: rows.length > PAGE ? encode(page.at(-1)!.r) : null,
  };
}

/** Lifts a ban. Comments hidden by the ban stay hidden; the editor restores them one by one. */
export async function unbanReader(s: Services, staff: Staff, id: string) {
  const [row] = await s.db.update(readers).set({ status: 'active', bannedReason: null }).where(eq(readers.id, id)).returning({ id: readers.id });
  if (!row) throw errors.notFound('הגולש');
  await audit(s.db, { userId: staff.id, entity: 'reader', entityId: id, action: 'unban' });
}

/** Ends every session of the reader (e.g. a lost phone); they sign in again with a new code. */
export async function signOutReader(s: Services, staff: Staff, id: string) {
  const [row] = await s.db.select({ id: readers.id }).from(readers).where(eq(readers.id, id)).limit(1);
  if (!row) throw errors.notFound('הגולש');
  await s.db.delete(sessions).where(eq(sessions.readerId, id));
  await audit(s.db, { userId: staff.id, entity: 'reader', entityId: id, action: 'sign_out' });
}

/** A privacy request: the account and everything tied to it, as when the reader deletes it themselves. */
export async function deleteReader(s: Services, staff: Staff, id: string) {
  const [row] = await s.db.select({ email: readers.email }).from(readers).where(eq(readers.id, id)).limit(1);
  if (!row) throw errors.notFound('הגולש');
  await s.db.transaction(async (tx) => {
    await tx.delete(loginCodes).where(eq(loginCodes.email, row.email));
    await tx.delete(readers).where(eq(readers.id, id));
  });
  // No personal details in the log, only that an account was deleted.
  await audit(s.db, { userId: staff.id, entity: 'reader', entityId: id, action: 'admin_delete' });
}

// --- Newsletter subscribers ----------------------------------------------------------------------------------
const statusOf = (r: { confirmedAt: Date | null; unsubscribedAt: Date | null }): SubscriberStatus =>
  r.unsubscribedAt ? 'unsubscribed' : r.confirmedAt ? 'active' : 'pending';

export async function listSubscribers(s: Services, query: z.infer<typeof SubscriberListQuery>): Promise<SubscriberList> {
  const c = decode(query.cursor);
  const q = query.q?.trim();
  const t = newsletterSubscribers;
  const byStatus = {
    active: and(isNotNull(t.confirmedAt), isNull(t.unsubscribedAt)),
    pending: and(isNull(t.confirmedAt), isNull(t.unsubscribedAt)),
    unsubscribed: isNotNull(t.unsubscribedAt),
    all: undefined,
  }[query.status];
  const rows = await s.db
    .select()
    .from(t)
    .where(and(byStatus, q ? ilike(t.email, `%${q}%`) : undefined, c ? sql`(${t.createdAt}, ${t.id}) < (${c.at}::timestamptz, ${c.id}::uuid)` : undefined))
    .orderBy(desc(t.createdAt), desc(t.id))
    .limit(PAGE + 1);
  const page = rows.slice(0, PAGE);
  return {
    items: page.map((r) => ({
      id: r.id,
      email: r.email,
      status: statusOf(r),
      createdAt: r.createdAt.toISOString(),
      confirmedAt: r.confirmedAt?.toISOString() ?? null,
      unsubscribedAt: r.unsubscribedAt?.toISOString() ?? null,
    })),
    nextCursor: rows.length > PAGE ? encode(page.at(-1)!) : null,
  };
}

/** Off the list at the person's request; the row stays, with the time, as the record the law asks for. */
export async function unsubscribeSubscriber(s: Services, staff: Staff, id: string) {
  const [row] = await s.db.update(newsletterSubscribers).set({ unsubscribedAt: new Date() }).where(and(eq(newsletterSubscribers.id, id), isNull(newsletterSubscribers.unsubscribedAt))).returning({ id: newsletterSubscribers.id });
  if (!row) {
    const [exists] = await s.db.select({ id: newsletterSubscribers.id }).from(newsletterSubscribers).where(eq(newsletterSubscribers.id, id)).limit(1);
    if (!exists) throw errors.notFound('המנוי');
    return;
  }
  await audit(s.db, { userId: staff.id, entity: 'newsletter_subscriber', entityId: id, action: 'unsubscribe' });
}

/** A privacy request to be forgotten: the address and its consent records go. */
export async function deleteSubscriber(s: Services, staff: Staff, id: string) {
  const [row] = await s.db.delete(newsletterSubscribers).where(eq(newsletterSubscribers.id, id)).returning({ id: newsletterSubscribers.id });
  if (!row) throw errors.notFound('המנוי');
  await audit(s.db, { userId: staff.id, entity: 'newsletter_subscriber', entityId: id, action: 'admin_delete' });
}
