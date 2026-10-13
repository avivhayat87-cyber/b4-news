// Settings > connections (AI, email) and site details. Admins only for changes;
// keys are write-only and never leave the server. (Social accounts: ./social-accounts.ts)
import { ConnectionTest, INTEGRATIONS, INTEGRATION_IDS, IntegrationStatus, SiteSettings, UpdateIntegrationInput } from '@b4/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '../../errors';
import { audit } from '../../lib/audit';
import { requireStaff } from '../../plugins/auth';
import { testIntegration } from '../../services/connection-tests';
import type { Services } from '../../services/context';
import { revalidateSite } from '../../services/publish';
import { secretKey } from '../../services/settings';
import { DEFAULT_PAGES, getSite, publishLegalVersion, saveSite } from '../../services/site-settings';

const idParam = z.object({ id: z.enum(INTEGRATION_IDS) });
const testLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };

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

  // --- Site details ------------------------------------------------------------------
  app.get('/site', { schema: { response: { 200: SiteSettings } } }, async () => getSite(s));

  app.put('/site', { bodyLimit: 512 * 1024, schema: { body: SiteSettings, response: { 200: SiteSettings } } }, async (req) => {
    const staff = requireStaff(req, 'admin');
    await saveSite(s, staff.id, req.body);
    await audit(s.db, { userId: staff.id, entity: 'site', entityId: 'site', action: 'update' });
    await revalidateSite(s, ['site']).catch((err) => s.log.warn({ err: err instanceof Error ? err.message : err }, 'site revalidate failed'));
    return getSite(s);
  });

  /** The built-in text of each info page, for "restore the default text". */
  app.get('/site/defaults', { schema: { response: { 200: z.object({ pages: SiteSettings.shape.pages }) } } }, async () => ({ pages: DEFAULT_PAGES }));

  /** After a material change to the terms: every reader is asked to accept them again. */
  app.post('/site/legal-version', { schema: { response: { 200: SiteSettings } } }, async (req) => {
    const staff = requireStaff(req, 'admin');
    const version = await publishLegalVersion(s, staff.id);
    await audit(s.db, { userId: staff.id, entity: 'site', entityId: 'legal', action: 'publish_version', details: { version } });
    await revalidateSite(s, ['site']).catch((err) => s.log.warn({ err: err instanceof Error ? err.message : err }, 'site revalidate failed'));
    return getSite(s);
  });
};
