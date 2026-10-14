// A copy of the live data made safe for the workshop, so code is developed against real articles
// and comments. What identifies readers, newsletter subscribers and people who asked for a
// takedown is replaced; sessions, sign-in codes, access tokens, push devices and the live keys
// are removed; background work is cancelled and the social accounts are switched off. The
// workshop can't reach a real person or a real page. Its own keys and staff sign-ins are put back.
import {
  type Db,
  appSettings,
  consents,
  devices,
  eq,
  ilike,
  inArray,
  jobs,
  loginCodes,
  newsletterSubscribers,
  readers,
  secrets,
  sessions,
  socialAccounts,
  sql,
  staffApiTokens,
  staffLoginChallenges,
  takedownRequests,
  users,
} from '@b4/db';

export async function prepareWorkshopCopy(copy: Db, workshop: Db | null): Promise<Record<string, number>> {
  const n = async (q: Promise<unknown[]>) => (await q).length;
  const report: Record<string, number> = {};

  // Nothing that signs in or reaches anyone survives the copy.
  report.sessions = await n(copy.delete(sessions).returning({ id: sessions.id }));
  report.signInCodes = await n(copy.delete(loginCodes).returning({ id: loginCodes.id }));
  report.accessTokens = await n(copy.delete(staffApiTokens).returning({ id: staffApiTokens.id }));
  report.pushDevices = await n(copy.delete(devices).returning({ id: devices.id }));
  report.liveKeys = await n(copy.delete(secrets).returning({ key: secrets.key }));
  await copy.delete(staffLoginChallenges);
  // Staff sign-ins, including the authenticator secrets (sealed with the live key anyway), and the live rule requiring them.
  await copy.update(users).set({ passwordHash: null, totpSecret: null, totpPendingSecret: null, totpEnabledAt: null, totpLastStep: null, totpRecoveryHashes: [] });
  await copy.delete(appSettings).where(eq(appSettings.key, 'security.staff'));

  // People, replaced by stand-ins (the content they wrote stays).
  report.readers = await n(
    copy
      .update(readers)
      .set({ email: sql`'reader-' || ${readers.id} || '@example.invalid'`, displayName: sql`'גולש/ת ' || substr(${readers.id}::text, 1, 4)` })
      .returning({ id: readers.id }),
  );
  report.subscribers = await n(
    copy
      .update(newsletterSubscribers)
      .set({ email: sql`'subscriber-' || ${newsletterSubscribers.id} || '@example.invalid'`, confirmTokenHash: null })
      .returning({ id: newsletterSubscribers.id }),
  );
  await copy.update(consents).set({ ipHash: null, userAgent: null });
  report.takedownRequests = await n(
    copy
      .update(takedownRequests)
      .set({ name: 'פונה', email: sql`'takedown-' || ${takedownRequests.id} || '@example.invalid'`, ipHash: null })
      .returning({ id: takedownRequests.id }),
  );

  // Work the live site had queued (publishing, posts, AI) never runs in the workshop.
  report.cancelledJobs = await n(copy.update(jobs).set({ status: 'cancelled' }).where(inArray(jobs.status, ['queued', 'running'])).returning({ id: jobs.id }));
  report.socialAccountsOff = await n(copy.update(socialAccounts).set({ isActive: false }).where(eq(socialAccounts.isActive, true)).returning({ id: socialAccounts.id }));

  if (workshop) {
    // The workshop's staff keep signing in with their own passwords. Someone who is new to the copy
    // keeps their id, and with it their two-step setup (its secret is sealed with that id); someone
    // the live site has too gets the live id, and signs in with the password alone.
    for (const u of await workshop.select().from(users)) {
      const [match] = await copy.update(users).set({ passwordHash: u.passwordHash, isActive: true }).where(eq(users.email, u.email)).returning({ id: users.id });
      if (!match) {
        await copy.insert(users).values({
          id: u.id,
          email: u.email,
          fullName: u.fullName,
          role: u.role,
          passwordHash: u.passwordHash,
          totpSecret: u.totpSecret,
          totpEnabledAt: u.totpEnabledAt,
          totpLastStep: u.totpLastStep,
          totpRecoveryHashes: u.totpRecoveryHashes,
        });
      }
    }
    // The workshop's own keys (encrypted with its own key) and connection settings.
    const keys = await workshop.select().from(secrets);
    if (keys.length) await copy.insert(secrets).values(keys.map((k) => ({ ...k, updatedBy: null })));
    for (const s of await workshop.select().from(appSettings).where(ilike(appSettings.key, 'integration:%'))) {
      await copy
        .insert(appSettings)
        .values({ key: s.key, value: s.value, updatedBy: null })
        .onConflictDoUpdate({ target: appSettings.key, set: { value: s.value, updatedBy: null } });
    }
    report.workshopKeys = keys.length;
  }
  return report;
}

/** Whether a copy still holds anything personal or live (used by the tests and after a copy). */
export async function leftovers(copy: Db): Promise<string[]> {
  const found: string[] = [];
  const [r] = await copy.select({ n: sql<number>`count(*)::int` }).from(readers).where(sql`${readers.email} not like '%@example.invalid'`);
  if (r?.n) found.push(`${r.n} reader emails`);
  const [s] = await copy.select({ n: sql<number>`count(*)::int` }).from(newsletterSubscribers).where(sql`${newsletterSubscribers.email} not like '%@example.invalid'`);
  if (s?.n) found.push(`${s.n} subscriber emails`);
  const [d] = await copy.select({ n: sql<number>`count(*)::int` }).from(devices);
  if (d?.n) found.push(`${d.n} push devices`);
  const [a] = await copy.select({ n: sql<number>`count(*)::int` }).from(socialAccounts).where(eq(socialAccounts.isActive, true));
  if (a?.n) found.push(`${a.n} active social accounts`);
  const [j] = await copy.select({ n: sql<number>`count(*)::int` }).from(jobs).where(inArray(jobs.status, ['queued', 'running']));
  if (j?.n) found.push(`${j.n} queued jobs`);
  return found;
}
