// "העיתון שלי": a personal issue at the reader's hour (Israel time), with the latest articles in
// their topics in their order; once a day (weekly: Sundays); one issue per address even with an
// account and a subscription; preferences without signing in through the issue's link; one-click stop.
import { articles, categories, desc, eq, inArray, jobs, newsletterSubscribers } from '@b4/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildIssue, ensureDigestTick, isDue, israelHour, sendDueDigests } from '../src/services/digest';
import { ORIGIN, setup, signInReader } from './helpers';

let ctx: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(() => ctx.close());

const prefs = (over: object = {}) => ({ sections: [], hour: 7, frequency: 'daily' as const, email: true, push: false, ...over });

/** Some articles of these sections, as if just published. */
async function freshIn(slugs: string[]) {
  const rows = await ctx.db
    .select({ id: articles.id, slug: categories.slug })
    .from(articles)
    .innerJoin(categories, eq(articles.categoryId, categories.id))
    .where(inArray(categories.slug, slugs))
    .orderBy(desc(articles.publishedAt));
  const ids = slugs.flatMap((s) => rows.filter((r) => r.slug === s).slice(0, 2).map((r) => r.id));
  await ctx.db.update(articles).set({ publishedAt: new Date(Date.now() - 30 * 60_000) }).where(inArray(articles.id, ids));
}

describe('when', () => {
  it('goes out at the chosen hour in Israel, once a day; weekly only on Sundays', () => {
    const at7 = new Date('2026-10-14T04:10:00Z'); // 07:10 in Israel (summer time), a Wednesday
    expect(israelHour(at7)).toBe(7);
    expect(isDue(prefs(), null, at7)).toBe(true);
    expect(isDue(prefs(), new Date('2026-10-14T04:00:00Z'), at7)).toBe(false); // sent this morning
    expect(isDue(prefs(), new Date('2026-10-13T04:00:00Z'), at7)).toBe(true);
    expect(isDue(prefs({ hour: 8 }), null, at7)).toBe(false);
    expect(isDue(prefs({ frequency: 'weekly' }), null, at7)).toBe(false);
    expect(isDue(prefs({ frequency: 'weekly' }), null, new Date('2026-10-18T04:10:00Z'))).toBe(true); // Sunday
  });

  it('keeps one recurring job booked', async () => {
    await ensureDigestTick(ctx.db);
    await ensureDigestTick(ctx.db);
    expect((await ctx.db.select().from(jobs).where(eq(jobs.kind, 'digest.tick'))).length).toBe(1);
  });
});

describe('the issue', () => {
  it('puts the reader\'s topics first, in their order', async () => {
    await freshIn(['real-estate', 'hi-tech']);
    const items = await buildIssue(ctx.db, prefs({ sections: ['hi-tech', 'real-estate'] }), new Date(Date.now() - 3600_000));
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items[0]!.section).toBe('הייטק');
    expect(items.map((i) => i.section)).toContain('נדל״ן');
  });

  it('a subscriber chooses topics and time from the confirmation, gets one issue that day, and can stop it', async () => {
    const email = 'paper@example.com';
    await ctx.app.inject({ method: 'POST', url: '/api/v1/public/newsletter', payload: { email, acceptTerms: true }, headers: { origin: ORIGIN }, remoteAddress: '10.4.4.4' });
    const token = decodeURIComponent(ctx.mailer.lastTo(email)!.text.match(/token=([^\s]+)/)![1]!);
    const confirmed = await ctx.app.inject({ method: 'POST', url: '/api/v1/public/newsletter/confirm', payload: { token }, headers: { origin: ORIGIN } });
    const { id, token: key } = confirmed.json();
    const url = `/api/v1/public/newsletter/preferences/${id}/${key}`;
    expect((await ctx.app.inject({ method: 'GET', url })).json()).toMatchObject({ hour: 7, frequency: 'daily', email: true, sections: [] });
    const hour = israelHour(new Date());
    const saved = await ctx.app.inject({ method: 'PUT', url, payload: prefs({ sections: ['real-estate'], hour, push: true }), headers: { origin: ORIGIN } });
    expect(saved.json()).toMatchObject({ sections: ['real-estate'], hour, push: false }); // no phone for a subscriber
    expect((await ctx.app.inject({ method: 'GET', url: `/api/v1/public/newsletter/preferences/${id}/${'0'.repeat(64)}` })).statusCode).toBe(400);

    await freshIn(['real-estate']);
    expect((await sendDueDigests(ctx.app.services)).subscribers).toBe(1);
    const issue = ctx.mailer.lastTo(email)!;
    expect(issue.subject).toMatch(/^העיתון שלך: /);
    expect(issue.html).toContain('הסרה מרשימת התפוצה');
    expect(issue.text).toContain('/newsletter/preferences?id=');
    expect(issue.headers!['List-Unsubscribe']).toContain('/newsletter/unsubscribe/');
    expect((await sendDueDigests(ctx.app.services)).subscribers).toBe(0); // once a day
  });

  it('a reader turns it on in the account (off until then); their subscription on the same address adds no second issue', async () => {
    const email = 'reader-paper@example.com';
    const cookie = await signInReader(ctx, email, 'קוראת');
    const call = (method: 'GET' | 'PUT', payload?: object) =>
      ctx.app.inject({ method, url: '/api/v1/auth/reader/digest', headers: { cookie, origin: ORIGIN }, ...(payload ? { payload } : {}) });
    expect((await call('GET')).json()).toMatchObject({ email: false, push: false });
    const hour = israelHour(new Date());
    expect((await call('PUT', prefs({ sections: ['hi-tech'], hour }))).statusCode).toBe(200);
    // Also subscribed to the newsletter with the same address.
    await ctx.app.inject({ method: 'POST', url: '/api/v1/public/newsletter', payload: { email, acceptTerms: true }, headers: { origin: ORIGIN }, remoteAddress: '10.4.4.5' });
    await ctx.db.update(newsletterSubscribers).set({ confirmedAt: new Date() }).where(eq(newsletterSubscribers.email, email));

    await freshIn(['hi-tech']);
    const before = ctx.mailer.sent.filter((m) => m.to === email && m.subject.startsWith('העיתון')).length;
    const sent = await sendDueDigests(ctx.app.services);
    expect(sent.readers).toBe(1);
    const issues = ctx.mailer.sent.filter((m) => m.to === email && m.subject.startsWith('העיתון'));
    expect(issues.length - before).toBe(1);

    const off = issues.at(-1)!.headers!['List-Unsubscribe']!.slice(1, -1).replace(ctx.config.publicApiUrl, '');
    expect((await ctx.app.inject({ method: 'POST', url: off, headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'List-Unsubscribe=One-Click' })).statusCode).toBe(204);
    expect((await call('GET')).json()).toMatchObject({ email: false, sections: ['hi-tech'] });
  });
});
