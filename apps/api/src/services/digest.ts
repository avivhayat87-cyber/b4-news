// "העיתון שלי": a personal issue at the hour each reader chose, with the latest articles in the
// topics they picked, in their order. Signed-in readers set it in their account (mail and/or a
// push to their phone); newsletter subscribers through the link in every issue (mail). A
// recurring job looks every 15 minutes for whoever is due, once a day (or on Sundays, weekly).
// Someone with an account and a subscription on the same address gets one issue, not two.
import { DigestPrefs, type DigestPrefs as Prefs } from '@b4/shared';
import { type Db, and, articles, categories, desc, devices, eq, gt, inArray, isNotNull, isNull, jobs, newsletterSubscribers, readers, sql } from '@b4/db';
import { AppError } from '../errors';
import { keyedHash, safeEqualHex } from '../lib/crypto';
import { sendExpoPush } from '../lib/expo-push';
import { enqueue, type JobRow } from '../lib/jobs';
import type { Services } from './context';
import { newsletterMail, unsubscribeLinks, unsubscribeToken, validUnsubscribeToken } from './newsletter';

export const DIGEST_TICK_JOB = 'digest.tick';
const TICK_MS = 15 * 60 * 1000;
const MAX_ARTICLES = 8;
const PER_SECTION = 3;

/** For subscribers who never chose: every topic, 07:00, daily, by mail. */
export const SUBSCRIBER_DEFAULT: Prefs = DigestPrefs.parse({});

// --- Time, in Israel ---------------------------------------------------------------------------------------
const parts = (d: Date) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(d).map((p) => [p.type, p.value]));
export const israelHour = (d: Date) => Number(parts(d).hour);
const israelDay = (d: Date) => {
  const p = parts(d);
  return `${p.year}-${p.month}-${p.day}`;
};
const isSunday = (d: Date) => parts(d).weekday === 'Sun';

/** Due now: their hour, not sent yet today (weekly: on Sundays). */
export function isDue(prefs: Prefs, last: Date | null, now: Date): boolean {
  if (israelHour(now) !== prefs.hour) return false;
  if (prefs.frequency === 'weekly' && !isSunday(now)) return false;
  return !last || israelDay(last) !== israelDay(now);
}

// --- The issue ---------------------------------------------------------------------------------------------
type Item = { id: number; slug: string; title: string; excerpt: string; section: string };

/** The latest articles since the last issue, a few per topic in the reader's order, then the rest. */
export async function buildIssue(db: Db, prefs: Prefs, since: Date): Promise<Item[]> {
  const rows = await db
    .select({ id: articles.id, slug: articles.slug, title: articles.title, excerpt: articles.excerpt, section: categories.slug, sectionName: categories.name })
    .from(articles)
    .innerJoin(categories, eq(articles.categoryId, categories.id))
    .where(and(eq(articles.status, 'published'), gt(articles.publishedAt, since), sql`${articles.publishedAt} <= now()`))
    .orderBy(desc(articles.publishedAt))
    .limit(200);
  const picked: Item[] = [];
  const take = (r: (typeof rows)[number]) => picked.length < MAX_ARTICLES && !picked.some((p) => p.id === r.id) && picked.push({ id: r.id, slug: r.slug, title: r.title, excerpt: r.excerpt, section: r.sectionName });
  for (const slug of prefs.sections) rows.filter((r) => r.section === slug).slice(0, PER_SECTION).forEach(take);
  // Nothing chosen: everything; chosen topics first, then the rest only if the issue is still thin.
  if (!prefs.sections.length || picked.length < 3) rows.filter((r) => !prefs.sections.length || !prefs.sections.includes(r.section)).forEach(take);
  return picked;
}

const sinceFor = (prefs: Prefs, last: Date | null, now: Date) => last ?? new Date(now.getTime() - (prefs.frequency === 'weekly' ? 7 : 1) * 86_400_000);

/** The issue as text and HTML; the footer links (change, stop) appear in both. */
function issueText(s: Services, items: Item[], footer: { label: string; url: string }[], note = ''): { text: string; html: string } {
  const site = s.config.publicSiteUrl;
  const text = items.map((i) => `• ${i.title} (${i.section})\n  ${i.excerpt}\n  ${site}/a/${i.id}`).join('\n\n');
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const html = `<!doctype html><html lang="he" dir="rtl"><body style="margin:0;background:#f4f1ec;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a"><div style="max-width:560px;margin:0 auto;padding:28px 22px;text-align:right">
<p style="font-size:22px;font-weight:bold;margin:0 0 4px">העיתון שלך</p><p style="font-size:14px;color:#666;margin:0 0 22px">B4 NEW'S · הכתבות האחרונות בתחומים שבחרת</p>
${items.map((i) => `<div style="margin:0 0 20px"><p style="font-size:12px;color:#c8102e;font-weight:bold;margin:0 0 4px">${esc(i.section)}</p><a href="${site}/a/${i.id}" style="font-size:18px;font-weight:bold;color:#1a1a1a;text-decoration:none">${esc(i.title)}</a><p style="font-size:15px;color:#444;margin:6px 0 0">${esc(i.excerpt)}</p></div>`).join('')}
<p style="font-size:13px;color:#666;border-top:1px solid #ddd;padding-top:14px;margin:8px 0 0">${footer.map((f) => `<a href="${f.url}" style="color:#666">${esc(f.label)}</a>`).join(' · ')}${note ? `<br>${esc(note)}` : ''}</p>
</div></body></html>`;
  return { text, html };
}

// --- Sending -------------------------------------------------------------------------------------------------
export const readerMailOffToken = (s: Services, readerId: string) => keyedHash(s.config.hashPepper, 'digest-mail-off', readerId);

async function sendToReader(s: Services, r: { id: string; email: string; digest: Prefs; lastDigestAt: Date | null }, now: Date) {
  const items = await buildIssue(s.db, r.digest, sinceFor(r.digest, r.lastDigestAt, now));
  if (items.length) {
    if (r.digest.email) {
      const manage = `${s.config.publicSiteUrl}/account#my-paper`;
      const { text, html } = issueText(s, items, [{ label: 'שינוי התחומים, השעה או הפסקת המייל', url: manage }]);
      const off = `${s.config.publicApiUrl}/api/v1/public/digest/mail-off/${r.id}/${readerMailOffToken(s, r.id)}`;
      await s.mailer.send({
        to: r.email,
        subject: `העיתון שלך: ${items[0]!.title}`,
        text: `${text}\n\n---\nשינוי התחומים, השעה או הפסקת המייל: ${manage}`,
        html,
        headers: { 'List-Unsubscribe': `<${off}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      });
    }
    if (r.digest.push && !s.config.devFixtures) {
      const tokens = (await s.db.select({ token: devices.pushToken }).from(devices).where(eq(devices.readerId, r.id))).map((d) => d.token);
      if (tokens.length) await sendExpoPush(tokens.map((to) => ({ to, title: 'העיתון שלך מוכן', body: items[0]!.title, data: { url: '/my' }, sound: 'default' as const })));
    }
  }
  await s.db.update(readers).set({ lastDigestAt: now }).where(eq(readers.id, r.id));
}

async function sendToSubscriber(s: Services, sub: { id: string; email: string; digest: Prefs | null; lastDigestAt: Date | null }, now: Date) {
  const prefs = sub.digest ?? SUBSCRIBER_DEFAULT;
  const items = await buildIssue(s.db, prefs, sinceFor(prefs, sub.lastDigestAt, now));
  if (items.length) {
    const prefsLink = `${s.config.publicSiteUrl}/newsletter/preferences?id=${sub.id}&token=${unsubscribeToken(s.config, sub.id)}`;
    const links = unsubscribeLinks(s.config, sub.id);
    const { text, html } = issueText(
      s,
      items,
      [
        { label: 'שינוי התחומים והשעה', url: prefsLink },
        { label: 'הסרה מרשימת התפוצה בלחיצה אחת', url: links.page },
      ],
      "נשלח אליך כי נרשמת לניוזלטר של B4 NEW'S.",
    );
    // The text version carries the law's footer (unsubscribe and sender) from newsletterMail.
    const mail = await newsletterMail(s, { to: sub.email, subscriberId: sub.id, subject: `העיתון שלך: ${items[0]!.title}`, text, containsAds: false });
    await s.mailer.send({ ...mail, text: `${mail.text}\nשינוי התחומים והשעה: ${prefsLink}`, html });
  }
  await s.db.update(newsletterSubscribers).set({ lastDigestAt: now }).where(eq(newsletterSubscribers.id, sub.id));
}

/** Everyone due now. One recipient failing never stops the others. */
export async function sendDueDigests(s: Services, now = new Date()): Promise<{ readers: number; subscribers: number; failed: number }> {
  let sentReaders = 0;
  let sentSubscribers = 0;
  let failed = 0;
  const withDigest = await s.db
    .select({ id: readers.id, email: readers.email, digest: readers.digest, lastDigestAt: readers.lastDigestAt })
    .from(readers)
    .where(and(isNotNull(readers.digest), eq(readers.status, 'active')));
  const accountEmails = new Set<string>();
  for (const r of withDigest) {
    const prefs = DigestPrefs.safeParse(r.digest);
    if (!prefs.success || (!prefs.data.email && !prefs.data.push)) continue;
    if (prefs.data.email) accountEmails.add(r.email);
    if (!isDue(prefs.data, r.lastDigestAt, now)) continue;
    try {
      await sendToReader(s, { ...r, digest: prefs.data }, now);
      sentReaders++;
    } catch (e) {
      failed++;
      s.log.error({ reader: r.id, err: e instanceof Error ? e.message : e }, 'digest to reader failed');
    }
  }
  const subs = await s.db
    .select({ id: newsletterSubscribers.id, email: newsletterSubscribers.email, digest: newsletterSubscribers.digest, lastDigestAt: newsletterSubscribers.lastDigestAt })
    .from(newsletterSubscribers)
    .where(and(isNotNull(newsletterSubscribers.confirmedAt), isNull(newsletterSubscribers.unsubscribedAt)));
  for (const sub of subs) {
    if (accountEmails.has(sub.email)) continue; // their account's issue covers it
    const prefs = DigestPrefs.safeParse(sub.digest ?? {});
    if (!isDue(prefs.success ? prefs.data : SUBSCRIBER_DEFAULT, sub.lastDigestAt, now)) continue;
    try {
      await sendToSubscriber(s, { ...sub, digest: prefs.success ? prefs.data : null }, now);
      sentSubscribers++;
    } catch (e) {
      failed++;
      s.log.error({ subscriber: sub.id, err: e instanceof Error ? e.message : e }, 'digest to subscriber failed');
    }
  }
  return { readers: sentReaders, subscribers: sentSubscribers, failed };
}

/** The recurring job: sends what is due, then books the next run (one queued at a time). */
export async function runDigestTick(s: Services, _job: JobRow) {
  const result = await sendDueDigests(s);
  await ensureDigestTick(s.db, new Date(Date.now() + TICK_MS));
  return result;
}

export async function ensureDigestTick(db: Db, runAt = new Date()) {
  const [queued] = await db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.kind, DIGEST_TICK_JOB), inArray(jobs.status, ['queued']))).limit(1);
  if (!queued) await enqueue(db, DIGEST_TICK_JOB, {}, { runAt, maxAttempts: 1 });
}

// --- Preferences ---------------------------------------------------------------------------------------------
export async function readerDigest(s: Services, readerId: string): Promise<Prefs> {
  const [r] = await s.db.select({ digest: readers.digest }).from(readers).where(eq(readers.id, readerId)).limit(1);
  // Not set up yet: nothing is sent until the reader turns something on.
  return DigestPrefs.parse({ ...(r?.digest ?? { email: false, push: false }) });
}

export async function saveReaderDigest(s: Services, readerId: string, prefs: Prefs): Promise<Prefs> {
  await s.db.update(readers).set({ digest: prefs }).where(eq(readers.id, readerId));
  return prefs;
}

function subscriberByToken(s: Services, id: string, token: string) {
  if (!validUnsubscribeToken(s.config, id, token)) throw new AppError(400, 'token_invalid', 'הקישור לא תקין');
}

export async function subscriberDigest(s: Services, id: string, token: string): Promise<Prefs> {
  subscriberByToken(s, id, token);
  const [sub] = await s.db.select({ digest: newsletterSubscribers.digest }).from(newsletterSubscribers).where(eq(newsletterSubscribers.id, id)).limit(1);
  if (!sub) throw new AppError(404, 'not_found', 'המנוי לא נמצא');
  return DigestPrefs.parse({ ...(sub.digest ?? {}), email: true, push: false });
}

export async function saveSubscriberDigest(s: Services, id: string, token: string, prefs: Prefs): Promise<Prefs> {
  subscriberByToken(s, id, token);
  // A subscriber's issue is a mail; there is no phone to push to.
  const value = { ...prefs, email: true, push: false };
  const [row] = await s.db.update(newsletterSubscribers).set({ digest: value }).where(eq(newsletterSubscribers.id, id)).returning({ id: newsletterSubscribers.id });
  if (!row) throw new AppError(404, 'not_found', 'המנוי לא נמצא');
  return value;
}

export async function stopReaderDigestMail(s: Services, readerId: string, token: string) {
  if (!safeEqualHex(readerMailOffToken(s, readerId), token)) throw new AppError(400, 'token_invalid', 'הקישור לא תקין');
  const current = await readerDigest(s, readerId);
  await saveReaderDigest(s, readerId, { ...current, email: false });
}
