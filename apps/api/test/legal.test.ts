// Terms acceptance, account deletion, newsletter consent and unsubscribe,
// notice-and-takedown, company details in the legal pages, and the copy check.
import type { HomeData } from '@b4/shared';
import { appSettings, auditLog, comments, consents, eq, newsletterSubscribers, readers, takedownRequests } from '@b4/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compareWording } from '../src/lib/similarity';
import { newsletterMail, unsubscribeToken } from '../src/services/newsletter';
import { ORIGIN, setup, signInReader, signInStaff, staffClient } from './helpers';

let ctx: Awaited<ReturnType<typeof setup>>;
let articleId: number;
let admin: ReturnType<typeof staffClient>;

beforeAll(async () => {
  ctx = await setup();
  articleId = (await ctx.app.inject({ url: '/api/v1/public/home' })).json<HomeData>().main[0]!.id;
  admin = staffClient(ctx, await signInStaff(ctx, 'admin'));
});
afterAll(async () => {
  await ctx.close();
});

const postComment = (cookie: string, body: string) =>
  ctx.app.inject({ method: 'POST', url: `/api/v1/articles/${articleId}/comments`, headers: { cookie, origin: ORIGIN }, payload: { body } });

const currentVersion = async () => (await ctx.app.inject({ url: '/api/v1/public/site' })).json().consent.version as string;

describe('accepting the terms', () => {
  it('records the acceptance when a reader signs up', async () => {
    await signInReader(ctx, 'terms@example.com', 'מאשרת תנאים');
    const [reader] = await ctx.db.select().from(readers).where(eq(readers.email, 'terms@example.com'));
    expect(reader!.termsVersion).toBe(await currentVersion());
    const rows = await ctx.db.select().from(consents).where(eq(consents.readerId, reader!.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ipHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('asks again after a new version, before the next comment', async () => {
    const cookie = await signInReader(ctx, 'again@example.com', 'קורא ותיק');
    expect((await postComment(cookie, 'תגובה לפני העדכון')).statusCode).toBe(201);

    const bumped = await admin.post('/site/legal-version');
    expect(bumped.status).toBe(200);
    const version = bumped.body.legal.version as string;
    expect(await currentVersion()).toBe(version);

    const session = await ctx.app.inject({ url: '/api/v1/auth/reader/session', headers: { cookie } });
    expect(session.json().reader.termsAccepted).toBe(false);
    const blocked = await postComment(cookie, 'תגובה אחרי העדכון');
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe('terms_required');

    const stale = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/reader/terms', headers: { cookie, origin: ORIGIN }, payload: { version: '2020-01-01', accept: true } });
    expect(stale.statusCode).toBe(409);
    const accepted = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/reader/terms', headers: { cookie, origin: ORIGIN }, payload: { version, accept: true } });
    expect(accepted.json().termsAccepted).toBe(true);
    expect((await postComment(cookie, 'תגובה אחרי העדכון')).statusCode).toBe(201);
  });

  it('keeps the version when the site details are saved', async () => {
    const before = await currentVersion();
    const site = (await admin.get('/site')).body;
    const saved = await admin.put('/site', { ...site, legal: { version: '2000-01-01' } });
    expect(saved.status).toBe(200);
    expect(saved.body.legal.version).toBe(before);
  });

  it('records an anonymous visitor who accepts in the banner', async () => {
    const visitorId = '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b';
    const wrong = await ctx.app.inject({ method: 'POST', url: '/api/v1/public/consent', payload: { visitorId, version: '2020-01-01', channel: 'web' } });
    expect(wrong.statusCode).toBe(409);
    const ok = await ctx.app.inject({ method: 'POST', url: '/api/v1/public/consent', payload: { visitorId, version: await currentVersion(), ads: false, channel: 'web' } });
    expect(ok.statusCode).toBe(204);
    const [row] = await ctx.db.select().from(consents).where(eq(consents.visitorId, visitorId));
    expect(row).toMatchObject({ subject: 'visitor', channel: 'web', ads: false });
  });
});

describe('deleting an account', () => {
  it('removes the reader, their comments and consents, and keeps the audit trail without them', async () => {
    const author = await signInReader(ctx, 'leaving@example.com', 'עוזב את האתר');
    const reporterCookie = await signInReader(ctx, 'stays@example.com', 'נשאר באתר');
    const created = await postComment(author, 'תגובה שתימחק עם החשבון');
    expect(created.statusCode).toBe(201);
    // The leaving reader also reports someone else's comment (an audited action).
    const other = await postComment(reporterCookie, 'תגובה של קורא אחר');
    await ctx.app.inject({ method: 'POST', url: `/api/v1/comments/${other.json().id}/report`, headers: { cookie: author, origin: ORIGIN }, payload: { reason: 'spam' } });
    const [reader] = await ctx.db.select().from(readers).where(eq(readers.email, 'leaving@example.com'));
    await ctx.db.insert(auditLog).values({ actorReaderId: reader!.id, entity: 'test', entityId: 'x', action: 'probe' });

    const noOrigin = await ctx.app.inject({ method: 'DELETE', url: '/api/v1/auth/reader/me', headers: { cookie: author } });
    expect(noOrigin.statusCode).toBe(403); // CSRF check
    const res = await ctx.app.inject({ method: 'DELETE', url: '/api/v1/auth/reader/me', headers: { cookie: author, origin: ORIGIN } });
    expect(res.statusCode).toBe(204);

    expect(await ctx.db.select().from(readers).where(eq(readers.id, reader!.id))).toHaveLength(0);
    expect(await ctx.db.select().from(comments).where(eq(comments.readerId, reader!.id))).toHaveLength(0);
    expect(await ctx.db.select().from(consents).where(eq(consents.readerId, reader!.id))).toHaveLength(0);
    const probe = await ctx.db.select().from(auditLog).where(eq(auditLog.action, 'probe'));
    expect(probe[0]!.actorReaderId).toBeNull();
    const session = await ctx.app.inject({ url: '/api/v1/auth/reader/session', headers: { cookie: author } });
    expect(session.json().reader).toBeNull();
  });
});

describe('newsletter', () => {
  it('requires the terms checkbox and records the consent', async () => {
    const without = await ctx.app.inject({ method: 'POST', url: '/api/v1/public/newsletter', payload: { email: 'news@example.com' } });
    expect(without.statusCode).toBe(400);
    const signed = await ctx.app.inject({ method: 'POST', url: '/api/v1/public/newsletter', payload: { email: 'news@example.com', acceptTerms: true } });
    expect(signed.statusCode).toBe(202);
    const [sub] = await ctx.db.select().from(newsletterSubscribers).where(eq(newsletterSubscribers.email, 'news@example.com'));
    const rows = await ctx.db.select().from(consents).where(eq(consents.subscriberId, sub!.id));
    expect(rows).toHaveLength(1);
  });

  it('unsubscribes with the signed link, from the site or in one click from the mail client', async () => {
    const [sub] = await ctx.db.select().from(newsletterSubscribers).where(eq(newsletterSubscribers.email, 'news@example.com'));
    const id = sub!.id;
    const bad = await ctx.app.inject({ method: 'POST', url: '/api/v1/public/newsletter/unsubscribe', payload: { id, token: '0'.repeat(64) } });
    expect(bad.statusCode).toBe(400);

    const token = unsubscribeToken(ctx.config, id);
    const oneClick = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/public/newsletter/unsubscribe/${id}/${token}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'List-Unsubscribe=One-Click',
    });
    expect(oneClick.statusCode).toBe(204);
    const [after] = await ctx.db.select().from(newsletterSubscribers).where(eq(newsletterSubscribers.id, id));
    expect(after!.unsubscribedAt).toBeInstanceOf(Date);
    const again = await ctx.app.inject({ method: 'POST', url: '/api/v1/public/newsletter/unsubscribe', payload: { id, token } });
    expect(again.statusCode).toBe(204);
  });

  it('builds messages with the unsubscribe link, the headers and the ad label', async () => {
    const mail = await newsletterMail(ctx.app.services, { to: 'a@example.com', subscriberId: '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b', subject: 'הכותרות של היום', text: 'גוף', containsAds: true });
    expect(mail.subject).toBe('פרסומת: הכותרות של היום');
    expect(mail.text).toContain('/newsletter/unsubscribe?id=');
    expect(mail.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });
});

describe('notice and takedown', () => {
  it('takes a request from anyone, queues it with an answer-by time and confirms by email', async () => {
    const author = await signInReader(ctx, 'rude.writer@example.com', 'כותב פוגעני');
    const comment = (await postComment(author, 'תגובה שמישהו ירצה להסיר')).json();
    const payload = {
      kind: 'defamation',
      url: `${ORIGIN}/article/x#comments`,
      commentId: comment.id,
      name: 'ישראל ישראלי',
      email: 'victim@example.com',
      details: 'התגובה מייחסת לי מעשים שלא עשיתי ופוגעת בשמי הטוב.',
      declaration: true,
    };
    const bot = await ctx.app.inject({ method: 'POST', url: '/api/v1/public/takedown', payload: { ...payload, website: 'spam' } });
    expect(bot.statusCode).toBe(400);
    const res = await ctx.app.inject({ method: 'POST', url: '/api/v1/public/takedown', payload });
    expect(res.statusCode).toBe(201);
    expect(ctx.mailer.lastTo('victim@example.com')?.subject).toContain(res.json().reference);

    const dash = (await admin.get('/dashboard')).body;
    expect(dash.takedowns.open).toBeGreaterThanOrEqual(1);
    const queue = (await admin.get('/takedowns')).body.items;
    const item = queue.find((t: { id: string }) => t.id === res.json().id);
    expect(item.comment.body).toBe('תגובה שמישהו ירצה להסיר');

    const decided = await admin.patch(`/takedowns/${item.id}`, { status: 'removed', note: 'לשון הרע', hideComment: true });
    expect(decided.status).toBe(204);
    const [c] = await ctx.db.select().from(comments).where(eq(comments.id, comment.id));
    expect(c!.status).toBe('removed');
    const [t] = await ctx.db.select().from(takedownRequests).where(eq(takedownRequests.id, item.id));
    expect(t!.decidedAt).toBeInstanceOf(Date);
    expect(ctx.mailer.lastTo('victim@example.com')?.text).toContain('התוכן הוסר');
    expect((await admin.get('/takedowns?view=closed')).body.items.some((x: { id: string }) => x.id === item.id)).toBe(true);
  });
});

describe('legal pages', () => {
  it('fills the company details into the pages and flags what is missing', async () => {
    const empty = (await ctx.app.inject({ url: '/api/v1/public/pages/privacy' })).json().bodyHtml as string;
    expect(empty).toContain('[להשלמה: שם החברה המפעילה]');

    const site = (await admin.get('/site')).body;
    await admin.put('/site', { ...site, company: { ...site.company, name: 'בי פור חדשות בע״מ', regNumber: '512345678', address: 'רחוב הדוגמה 1, תל אביב', privacyEmail: 'privacy@b4.example' } });
    const filled = (await ctx.app.inject({ url: '/api/v1/public/pages/privacy' })).json().bodyHtml as string;
    expect(filled).toContain('בי פור חדשות בע״מ');
    expect(filled).toContain('privacy@b4.example');
    expect(filled).not.toContain('{שם החברה}');
  });

  it('serves the comment rules page, and gives older saved settings the new page', async () => {
    const rules = await ctx.app.inject({ url: '/api/v1/public/pages/comment-rules' });
    expect(rules.statusCode).toBe(200);
    // Settings saved before the page existed (no "comment-rules" key) still load.
    const [row] = await ctx.db.select().from(appSettings).where(eq(appSettings.key, 'site'));
    const value = row!.value as { pages: Record<string, unknown> };
    delete value.pages['comment-rules'];
    await ctx.app.services.settings.setSetting('site', value, row!.updatedBy!);
    const site = (await admin.get('/site')).body;
    expect(site.pages['comment-rules'].title).toBe('כללי השתתפות בתגובות');
    expect((await admin.get('/site/defaults')).body.pages.terms.title).toBe('תנאי שימוש');
  });
});

describe('copy check', () => {
  it('finds passages copied from the original', () => {
    const original = 'בנק ישראל הודיע היום כי הוא מותיר את הריבית ללא שינוי ברמה של ארבעה אחוזים וחצי, בשל האינפלציה שעדיין גבוהה מהיעד.';
    const copied = `לפי ההודעה, ${original}`;
    const rewritten = 'הריבית נשארת במקומה: הוועדה המוניטרית החליטה שלא לגעת בה, וציינה שקצב עליית המחירים עוד לא חזר לטווח הרצוי.';
    expect(compareWording(copied, original).level).toBe('high');
    expect(compareWording(copied, original).passages[0]).toContain('בנק ישראל הודיע היום');
    expect(compareWording(rewritten, original)).toEqual({ ratio: 0, level: 'ok', passages: [] });
  });
});
