// What a reader is told about: a reply to their comment, a like, the editors' pick. It shows at
// once on the site and in the app (the bell), goes to their phone as a push when they are signed
// in to the app, and is mailed gathered with the rest: one mail at most an hour after the first,
// only with what they haven't seen yet, and with a one-click way to stop the mails.
import type { NotificationKind, ReaderNotificationList, ReaderPrefs } from '@b4/shared';
import { and, articles, comments, desc, devices, eq, gt, inArray, isNull, jobs, readerNotifications, readers, sql } from '@b4/db';
import { alias } from 'drizzle-orm/pg-core';
import { AppError } from '../errors';
import { keyedHash, safeEqualHex } from '../lib/crypto';
import { sendExpoPush } from '../lib/expo-push';
import { enqueue, type JobRow } from '../lib/jobs';
import type { Services } from './context';

export const NOTIFY_JOB = 'reader.notify';
export const DIGEST_JOB = 'reader.digest';
/** The first notification starts the clock; the mail goes this long after it. */
const DIGEST_AFTER_MS = 60 * 60 * 1000;

const actorWord: Record<NotificationKind, (actor: string | null) => string> = {
  reply: (a) => `${a ?? 'מישהו'} הגיב/ה לתגובה שלך`,
  like: (a) => `${a ?? 'מישהו'} אהב/ה את התגובה שלך`,
  pick: () => 'התגובה שלך נבחרה ל"בחירת העורכים"',
};

export async function notify(s: Services, n: { readerId: string; kind: NotificationKind; commentId: string; actorReaderId: string | null; articleId: number }) {
  if (n.actorReaderId === n.readerId) return;
  // Likes on one comment gather into a single unread notice.
  if (n.kind === 'like') {
    const [open] = await s.db
      .select({ id: readerNotifications.id })
      .from(readerNotifications)
      .where(and(eq(readerNotifications.readerId, n.readerId), eq(readerNotifications.kind, 'like'), eq(readerNotifications.commentId, n.commentId), isNull(readerNotifications.readAt)))
      .limit(1);
    if (open) return;
  }
  const [row] = await s.db.insert(readerNotifications).values(n).returning({ id: readerNotifications.id });
  await enqueue(s.db, NOTIFY_JOB, { notificationId: row!.id }, { maxAttempts: 2 });
}

/** The push to the reader's phone(s), and the mail later (one job per reader at a time). */
export async function runNotify(s: Services, job: JobRow) {
  const [n] = await s.db
    .select({ id: readerNotifications.id, readerId: readerNotifications.readerId, kind: readerNotifications.kind, articleId: readerNotifications.articleId, slug: articles.slug, title: articles.title, actor: readers.displayName })
    .from(readerNotifications)
    .innerJoin(articles, eq(readerNotifications.articleId, articles.id))
    .leftJoin(readers, eq(readerNotifications.actorReaderId, readers.id))
    .where(eq(readerNotifications.id, String(job.payload.notificationId)))
    .limit(1);
  if (!n) return { skipped: 'gone' };
  const [reader] = await s.db.select({ notifyPush: readers.notifyPush, notifyEmail: readers.notifyEmail }).from(readers).where(eq(readers.id, n.readerId)).limit(1);
  if (!reader) return { skipped: 'reader gone' };

  let pushed = 0;
  if (reader.notifyPush) {
    const tokens = (await s.db.select({ token: devices.pushToken }).from(devices).where(eq(devices.readerId, n.readerId))).map((d) => d.token).filter((t) => /^Expo(nent)?PushToken\[/.test(t));
    // Development and tests never reach Expo's servers.
    if (tokens.length && !s.config.devFixtures) {
      await sendExpoPush(tokens.map((to) => ({ to, title: actorWord[n.kind as NotificationKind](n.actor), body: n.title, data: { url: `${s.config.publicSiteUrl}/a/${n.articleId}` }, sound: 'default' as const })));
      pushed = tokens.length;
    }
  }
  if (reader.notifyEmail) {
    const [queued] = await s.db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.kind, DIGEST_JOB), eq(jobs.status, 'queued'), sql`${jobs.payload}->>'readerId' = ${n.readerId}`))
      .limit(1);
    if (!queued) await enqueue(s.db, DIGEST_JOB, { readerId: n.readerId }, { runAt: new Date(Date.now() + DIGEST_AFTER_MS), maxAttempts: 3 });
  }
  return { pushed };
}

export function stopMailsToken(s: Services, readerId: string) {
  return keyedHash(s.config.hashPepper, 'notify-mail-off', readerId);
}

/** One mail with what the reader hasn't seen yet (on the site or in the app). */
export async function runDigest(s: Services, job: JobRow) {
  const readerId = String(job.payload.readerId);
  const [reader] = await s.db.select({ email: readers.email, notifyEmail: readers.notifyEmail, status: readers.status }).from(readers).where(eq(readers.id, readerId)).limit(1);
  if (!reader) return { skipped: 'reader gone' };
  const actor = alias(readers, 'actor');
  const unseen = await s.db
    .select({ id: readerNotifications.id, kind: readerNotifications.kind, articleId: articles.id, title: articles.title, actor: actor.displayName })
    .from(readerNotifications)
    .innerJoin(articles, eq(readerNotifications.articleId, articles.id))
    .leftJoin(actor, eq(readerNotifications.actorReaderId, actor.id))
    .where(and(eq(readerNotifications.readerId, readerId), isNull(readerNotifications.emailedAt), isNull(readerNotifications.readAt), gt(readerNotifications.createdAt, sql`now() - interval '3 days'`)))
    .orderBy(desc(readerNotifications.createdAt))
    .limit(30);
  if (!unseen.length) return { sent: false };
  if (reader.notifyEmail && reader.status === 'active') {
    const lines = unseen.map((u) => `• ${actorWord[u.kind as NotificationKind](u.actor)}: "${u.title}"\n  ${s.config.publicSiteUrl}/a/${u.articleId}#comments`);
    const off = `${s.config.publicApiUrl}/api/v1/public/notifications/mail-off/${readerId}/${stopMailsToken(s, readerId)}`;
    await s.mailer.send({
      to: reader.email,
      subject: unseen.length === 1 ? actorWord[unseen[0]!.kind as NotificationKind](unseen[0]!.actor) : `${unseen.length} עדכונים על התגובות שלך ב-B4 NEW'S`,
      // The link in the text opens the account settings (a mail scanner opening it changes nothing);
      // the one-click stop is the List-Unsubscribe header, which mail apps send as a POST.
      text: `${lines.join('\n\n')}\n\n---\nקיבלת את המייל כי הגבת באתר. להפסקת המיילים האלה: ${s.config.publicSiteUrl}/account`,
      headers: { 'List-Unsubscribe': `<${off}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    });
  }
  await s.db.update(readerNotifications).set({ emailedAt: new Date() }).where(inArray(readerNotifications.id, unseen.map((u) => u.id)));
  return { sent: reader.notifyEmail, count: unseen.length };
}

export async function stopMails(s: Services, readerId: string, token: string) {
  if (!safeEqualHex(stopMailsToken(s, readerId), token)) throw new AppError(400, 'token_invalid', 'הקישור לא תקין');
  await s.db.update(readers).set({ notifyEmail: false }).where(eq(readers.id, readerId));
}

// --- The bell ------------------------------------------------------------------------------------------
export async function listNotifications(s: Services, readerId: string): Promise<ReaderNotificationList> {
  const actor = alias(readers, 'actor');
  const rows = await s.db
    .select({
      id: readerNotifications.id,
      kind: readerNotifications.kind,
      actor: actor.displayName,
      articleId: articles.id,
      slug: articles.slug,
      title: articles.title,
      body: comments.body,
      commentId: comments.id,
      readAt: readerNotifications.readAt,
      createdAt: readerNotifications.createdAt,
    })
    .from(readerNotifications)
    .innerJoin(articles, eq(readerNotifications.articleId, articles.id))
    .innerJoin(comments, eq(readerNotifications.commentId, comments.id))
    .leftJoin(actor, eq(readerNotifications.actorReaderId, actor.id))
    .where(eq(readerNotifications.readerId, readerId))
    .orderBy(desc(readerNotifications.createdAt))
    .limit(30);
  const [unread] = await s.db
    .select({ n: sql<number>`count(*)::int` })
    .from(readerNotifications)
    .where(and(eq(readerNotifications.readerId, readerId), isNull(readerNotifications.readAt)));
  return {
    items: rows.map((r) => ({
      id: r.id,
      kind: r.kind as NotificationKind,
      actor: r.kind === 'pick' ? null : r.actor,
      article: { id: r.articleId, slug: r.slug, title: r.title },
      excerpt: r.body.length > 120 ? `${r.body.slice(0, 120)}…` : r.body,
      commentId: r.commentId,
      read: Boolean(r.readAt),
      createdAt: r.createdAt.toISOString(),
    })),
    unread: unread?.n ?? 0,
  };
}

export async function markRead(s: Services, readerId: string, ids?: string[]) {
  await s.db
    .update(readerNotifications)
    .set({ readAt: new Date() })
    .where(and(eq(readerNotifications.readerId, readerId), isNull(readerNotifications.readAt), ids?.length ? inArray(readerNotifications.id, ids) : undefined));
}

export async function getPrefs(s: Services, readerId: string): Promise<ReaderPrefs> {
  const [r] = await s.db.select({ notifyEmail: readers.notifyEmail, notifyPush: readers.notifyPush }).from(readers).where(eq(readers.id, readerId)).limit(1);
  return r ?? { notifyEmail: true, notifyPush: true };
}

export async function setPrefs(s: Services, readerId: string, prefs: ReaderPrefs): Promise<ReaderPrefs> {
  await s.db.update(readers).set(prefs).where(eq(readers.id, readerId));
  return prefs;
}
