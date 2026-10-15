// A copy of the live data for the workshop: nothing that identifies a reader, a subscriber, a
// requester or an ad lead, no advertiser contacts, no sessions, tokens, devices or live keys, no queued work and no active social
// account; the workshop's own keys and staff sign-ins come back. The articles stay as they are.
import { adCampaigns, adLeads, advertisers, appSettings, articles, createDb, devices, jobs, newsletterSubscribers, readers, secrets, seedReferenceData, sessions, socialAccounts, users } from '@b4/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { leftovers, prepareWorkshopCopy } from '../src/services/workshop-copy';
import { setup } from './helpers';

let live: Awaited<ReturnType<typeof setup>>;
let workshop: ReturnType<typeof createDb>;

beforeAll(async () => {
  live = await setup();
  workshop = createDb('memory:');
  await workshop.migrate();
  await seedReferenceData(workshop.db);
});
afterAll(async () => {
  await workshop.close();
  await live.close();
});

describe('a copy of the live data for the workshop', () => {
  it('keeps the content, replaces the people, and removes everything that reaches out', async () => {
    const db = live.db;
    const [reader] = await db.insert(readers).values({ email: 'dana@gmail.com', displayName: 'דנה כהן' }).returning();
    await db.insert(sessions).values({ id: 'live-session', kind: 'reader', readerId: reader!.id, expiresAt: new Date(Date.now() + 3600_000) });
    await db.insert(newsletterSubscribers).values({ email: 'yossi@walla.co.il', confirmTokenHash: 'abc' });
    await db.insert(devices).values({ platform: 'ios', pushToken: 'ExponentPushToken[live]' });
    await db.insert(secrets).values({ key: 'integration:gemini:apiKey', ciphertext: 'live-cipher', hint: 'LIVE' });
    await db.insert(jobs).values({ kind: 'social.publish', payload: {}, status: 'queued' });
    await db.update(socialAccounts).set({ isActive: true });
    const [advertiser] = await db.insert(advertisers).values({ name: 'בנק', email: 'ads@bank.co.il', phone: '03-1234567', contactName: 'רונית' }).returning();
    const [campaign] = await db.insert(adCampaigns).values({ advertiserId: advertiser!.id, name: 'קמפיין', action: 'lead' }).returning();
    await db.insert(adLeads).values({ campaignId: campaign!.id, sealed: 'v1:live', consentText: 'מסכים/ה' });
    const [admin] = await db.insert(users).values({ email: 'admin@b4.local', fullName: 'מנהל', role: 'admin', passwordHash: 'live-hash' }).returning();
    const articleCount = (await db.select({ id: articles.id }).from(articles)).length;

    // The workshop's own admin and keys.
    await workshop.db.insert(users).values({ email: admin!.email, fullName: 'מנהל', role: 'admin', passwordHash: 'workshop-hash' });
    await workshop.db.insert(users).values({ email: 'dev@b4.local', fullName: 'מפתח', role: 'developer', passwordHash: 'dev-hash' });
    await workshop.db.insert(secrets).values({ key: 'integration:gemini:apiKey', ciphertext: 'workshop-cipher', hint: 'WORK' });
    await workshop.db.insert(appSettings).values({ key: 'integration:gemini', value: { agentModel: 'gemini-3.5-flash-lite' } });

    expect(await leftovers(db)).not.toHaveLength(0);
    const report = await prepareWorkshopCopy(db, workshop.db);
    expect(report).toMatchObject({ sessions: 1, pushDevices: 1, liveKeys: 1, cancelledJobs: 1, workshopKeys: 1 });
    expect(await leftovers(db)).toEqual([]);

    const [r] = await db.select().from(readers);
    expect(r!.email).toMatch(/@example\.invalid$/);
    expect(r!.displayName).not.toContain('דנה');
    expect((await db.select().from(newsletterSubscribers))[0]).toMatchObject({ email: expect.stringMatching(/@example\.invalid$/), confirmTokenHash: null });
    expect(await db.select().from(sessions)).toEqual([]);
    expect((await db.select().from(socialAccounts)).every((a) => !a.isActive)).toBe(true);
    expect(await db.select().from(adLeads)).toEqual([]);
    expect((await db.select().from(advertisers))[0]).toMatchObject({ name: 'בנק', phone: '', contactName: '', email: expect.stringMatching(/@example\.invalid$/) });

    // The workshop signs in and connects as before; the live keys are gone.
    expect((await db.select().from(secrets)).map((s) => s.ciphertext)).toEqual(['workshop-cipher']);
    const staff = await db.select({ email: users.email, passwordHash: users.passwordHash }).from(users);
    expect(staff).toContainEqual({ email: admin!.email, passwordHash: 'workshop-hash' });
    expect(staff).toContainEqual({ email: 'dev@b4.local', passwordHash: 'dev-hash' });
    expect(staff.filter((u) => u.passwordHash && !['workshop-hash', 'dev-hash'].includes(u.passwordHash))).toEqual([]);
    expect((await db.select().from(appSettings)).find((s) => s.key === 'integration:gemini')?.value).toEqual({ agentModel: 'gemini-3.5-flash-lite' });

    // The articles are untouched.
    expect((await db.select({ id: articles.id }).from(articles)).length).toBe(articleCount);
  });
});
