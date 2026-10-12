// Settings > connections (AI, email, social tokens) and site details. Admins only
// for changes; keys are write-only and never leave the server.
import { ConnectionTest, INTEGRATIONS, INTEGRATION_IDS, IntegrationStatus, SetTokenInput, SiteSettings, SocialAccountDto, UpdateIntegrationInput } from '@b4/shared';
import { eq, socialAccounts } from '@b4/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError, errors } from '../../errors';
import { audit } from '../../lib/audit';
import { requireStaff } from '../../plugins/auth';
import { testIntegration, testSocialAccount } from '../../services/connection-tests';
import type { Services } from '../../services/context';
import { revalidateSite } from '../../services/publish';
import { secretKey } from '../../services/settings';
import { getSite, saveSite } from '../../services/site-settings';

const idParam = z.object({ id: z.enum(INTEGRATION_IDS) });
const accountParam = z.object({ id: z.string().uuid() });
const testLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };

export async function socialAccountDto(s: Services, a: typeof socialAccounts.$inferSelect): Promise<SocialAccountDto> {
  return {
    id: a.id,
    platform: a.platform,
    displayName: a.displayName,
    externalId: a.externalId,
    linkInFirstComment: a.linkInFirstComment,
    isActive: a.isActive,
    connected: Boolean(await s.settings.socialToken(a)),
  };
}

export const settingsRoutes: FastifyPluginAsyncZod<{ s: Services }> = async (app, { s }) => {
  // --- Connections ---------------------------------------------------------------
  app.get('/integrations', { schema: { response: { 200: z.array(IntegrationStatus) } } }, async (req) => {
    requireStaff(req, 'admin');
    return Promise.all(INTEGRATION_IDS.map((id) => s.settings.integrationStatus(id)));
  });

  app.put('/integrations/:id', { schema: { params: idParam, body: UpdateIntegrationInput, response: { 200: IntegrationStatus } } }, async (req) => {
    const staff = requireStaff(req, 'admin');
    const def = INTEGRATIONS[req.params.id];
    const plain = { ...((await s.settings.getSetting<Record<string, string>>(`integration:${req.params.id}`)) ?? {}) };
    const changed: string[] = [];
    for (const [key, raw] of Object.entries(req.body.values)) {
      const field = def.fields.find((f) => f.key === key);
      if (!field) throw new AppError(400, 'unknown_field', `שדה לא מוכר: ${key}`);
      const value = raw === null || raw === '' ? null : raw;
      if (value !== null && field.pattern && !new RegExp(field.pattern).test(value)) {
        throw new AppError(422, 'bad_value', `${field.label}: הערך לא נראה תקין${field.placeholder ? ` (למשל ${field.placeholder})` : ''}`);
      }
      if (field.secret) await s.settings.setSecret(secretKey.integration(req.params.id, key), value, staff.id);
      else if (value === null) delete plain[key];
      else plain[key] = value;
      changed.push(key);
    }
    await s.settings.setSetting(`integration:${req.params.id}`, plain, staff.id);
    // Values are never logged, only which fields changed.
    await audit(s.db, { userId: staff.id, entity: 'integration', entityId: req.params.id, action: 'update', details: { fields: changed } });
    return s.settings.integrationStatus(req.params.id);
  });

  app.post('/integrations/:id/test', { schema: { params: idParam, response: { 200: ConnectionTest } }, config: testLimit }, async (req) => {
    requireStaff(req, 'admin');
    return testIntegration(s, req.params.id);
  });

  // --- Social account tokens --------------------------------------------------------
  app.put('/social-accounts/:id/token', { schema: { params: accountParam, body: SetTokenInput, response: { 200: SocialAccountDto } } }, async (req) => {
    const staff = requireStaff(req, 'admin');
    const [account] = await s.db.select().from(socialAccounts).where(eq(socialAccounts.id, req.params.id)).limit(1);
    if (!account) throw errors.notFound('החשבון');
    await s.settings.setSecret(secretKey.socialToken(account.id), req.body.token, staff.id);
    await audit(s.db, { userId: staff.id, entity: 'social_account', entityId: account.id, action: req.body.token ? 'set_token' : 'remove_token' });
    return socialAccountDto(s, account);
  });

  app.post('/social-accounts/:id/test', { schema: { params: accountParam, response: { 200: ConnectionTest } }, config: testLimit }, async (req) => {
    requireStaff(req, 'admin');
    const [account] = await s.db.select().from(socialAccounts).where(eq(socialAccounts.id, req.params.id)).limit(1);
    if (!account) throw errors.notFound('החשבון');
    return testSocialAccount(s, account);
  });

  // --- Site details ------------------------------------------------------------------
  app.get('/site', { schema: { response: { 200: SiteSettings } } }, async () => getSite(s));

  app.put('/site', { bodyLimit: 512 * 1024, schema: { body: SiteSettings, response: { 200: SiteSettings } } }, async (req) => {
    const staff = requireStaff(req, 'admin');
    await saveSite(s, staff.id, req.body);
    await audit(s.db, { userId: staff.id, entity: 'site', entityId: 'site', action: 'update' });
    await revalidateSite(s, ['site']).catch((err) => s.log.warn({ err: err instanceof Error ? err.message : err }, 'site revalidate failed'));
    return getSite(s);
  });
};
