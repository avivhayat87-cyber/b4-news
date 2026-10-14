// "מנויים וגולשים" in the CMS: the registered readers and the newsletter subscribers, what the
// newsroom can do about them (by role), and whether this environment can send their mail.
import { articles, comments, desc, eq, newsletterSubscribers, readers, sessions } from '@b4/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGIN, setup, signInReader, signInStaff, staffClient } from './helpers';

let ctx: Awaited<ReturnType<typeof setup>>;
let editor: ReturnType<typeof staffClient>;
let admin: ReturnType<typeof staffClient>;
let viewer: ReturnType<typeof staffClient>;

beforeAll(async () => {
  ctx = await setup();
  editor = staffClient(ctx, await signInStaff(ctx, 'editor'));
  admin = staffClient(ctx, await signInStaff(ctx, 'admin'));
  viewer = staffClient(ctx, await signInStaff(ctx, 'viewer'));
  await signInReader(ctx, 'dana@example.com', 'דנה');
  await signInReader(ctx, 'yoav@example.com', 'יואב');
  const [a] = await ctx.db.select({ id: articles.id }).from(articles).orderBy(desc(articles.publishedAt)).limit(1);
  const [yoav] = await ctx.db.select().from(readers).where(eq(readers.email, 'yoav@example.com'));
  await ctx.db.insert(comments).values([
    { articleId: a!.id, readerId: yoav!.id, body: 'תגובה ראשונה' },
    { articleId: a!.id, readerId: yoav!.id, body: 'תגובה שנייה' },
  ]);
});
afterAll(() => ctx.close());

const readerId = async (email: string) => (await ctx.db.select({ id: readers.id }).from(readers).where(eq(readers.email, email)))[0]?.id;

describe('readers', () => {
  it('lists them for editors only, with search, comments and whether they are signed in', async () => {
    expect((await viewer.get('/readers')).status).toBe(403); // emails are personal details
    const all = await editor.get('/readers');
    expect(all.status).toBe(200);
    const yoav = all.body.items.find((r: { email: string }) => r.email === 'yoav@example.com');
    expect(yoav).toMatchObject({ displayName: 'יואב', status: 'active', comments: 2, hiddenComments: 0, signedIn: true, termsAccepted: true });
    const found = await editor.get('/readers?q=dana');
    expect(found.body.items.map((r: { email: string }) => r.email)).toEqual(['dana@example.com']);
  });

  it('bans and lifts the ban; the ban signs them out and hides their comments', async () => {
    const id = await readerId('yoav@example.com');
    expect((await editor.post(`/readers/${id}/ban`, { reason: 'הטרדה של מגיבים אחרים' })).status).toBe(204);
    let [yoav] = (await editor.get('/readers?status=banned')).body.items;
    expect(yoav).toMatchObject({ email: 'yoav@example.com', status: 'banned', bannedReason: 'הטרדה של מגיבים אחרים', signedIn: false, hiddenComments: 2 });
    expect((await editor.post(`/readers/${id}/unban`)).status).toBe(204);
    [yoav] = (await editor.get('/readers?q=yoav')).body.items;
    expect(yoav).toMatchObject({ status: 'active', bannedReason: null });
  });

  it('signs a reader out on every device', async () => {
    const id = await readerId('dana@example.com');
    expect((await ctx.db.select().from(sessions).where(eq(sessions.readerId, id!))).length).toBeGreaterThan(0);
    expect((await editor.post(`/readers/${id}/sign-out`)).status).toBe(204);
    expect(await ctx.db.select().from(sessions).where(eq(sessions.readerId, id!))).toEqual([]);
  });

  it('deletes an account for good only by an admin (a privacy request), with its comments', async () => {
    const id = await readerId('yoav@example.com');
    expect((await editor.del(`/readers/${id}`)).status).toBe(403);
    expect((await admin.del(`/readers/${id}`)).status).toBe(204);
    expect(await readerId('yoav@example.com')).toBeUndefined();
    expect(await ctx.db.select().from(comments).where(eq(comments.readerId, id!))).toEqual([]);
  });
});

describe('newsletter subscribers', () => {
  it('shows pending, active and removed subscribers, and takes one off the list', async () => {
    const signup = (email: string) =>
      ctx.app.inject({ method: 'POST', url: '/api/v1/public/newsletter', payload: { email, acceptTerms: true }, headers: { origin: ORIGIN }, remoteAddress: `10.9.9.${email.length}` });
    expect((await signup('pending@example.com')).statusCode).toBe(202);
    expect((await signup('reader@example.com')).statusCode).toBe(202);
    const token = ctx.mailer.lastTo('reader@example.com')!.text.match(/token=([^\s]+)/)![1]!;
    expect((await ctx.app.inject({ method: 'POST', url: '/api/v1/public/newsletter/confirm', payload: { token: decodeURIComponent(token) }, headers: { origin: ORIGIN } })).statusCode).toBe(204);

    expect((await editor.get('/newsletter/subscribers')).body.items.map((s: { email: string }) => s.email)).toEqual(['reader@example.com']);
    expect((await editor.get('/newsletter/subscribers?status=pending')).body.items.map((s: { email: string }) => s.email)).toEqual(['pending@example.com']);

    const [active] = (await editor.get('/newsletter/subscribers')).body.items;
    expect((await editor.post(`/newsletter/subscribers/${active.id}/unsubscribe`)).status).toBe(204);
    const [removed] = (await editor.get('/newsletter/subscribers?status=unsubscribed')).body.items;
    expect(removed).toMatchObject({ email: 'reader@example.com', status: 'unsubscribed', unsubscribedAt: expect.any(String) });

    expect((await editor.del(`/newsletter/subscribers/${removed.id}`)).status).toBe(403);
    expect((await admin.del(`/newsletter/subscribers/${removed.id}`)).status).toBe(204);
    expect(await ctx.db.select().from(newsletterSubscribers).where(eq(newsletterSubscribers.id, removed.id))).toEqual([]);
  });
});

describe('the overview', () => {
  it('counts the audience and says what this environment still needs', async () => {
    const res = await viewer.get('/audience'); // counts only, no personal details
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      readers: { total: 1, banned: 0, newThisWeek: 1, active30d: 1 },
      subscribers: { active: 0, pending: 1, unsubscribed: 0 },
      devices: { ios: 0, android: 0, web: 0 },
    });
    // The test environment has no outgoing mail and no HTTPS address.
    expect(res.body.setup).toEqual(expect.arrayContaining([{ key: 'mail', ok: false }, { key: 'https', ok: false }]));
  });
});
