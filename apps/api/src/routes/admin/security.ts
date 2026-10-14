// /api/v1/admin/me/2fa and /security: each staff member's two-step sign-in ("החשבון שלי"),
// the newsroom's rule (admins can require it for everyone), and an admin's reset for a lost phone.
import { ConfirmTwoFactorInput, DisableTwoFactorInput, RecoveryCodesDto, SecuritySettings, TwoFactorSetupDto, TwoFactorStatus } from '@b4/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireStaff } from '../../plugins/auth';
import type { Services } from '../../services/context';
import { disable, enable, getSecurity, loadUser, newCodes, resetFor, saveSecurity, startSetup, status } from '../../services/two-factor';

export const securityRoutes: FastifyPluginAsyncZod<{ s: Services }> = async (app, { s }) => {
  const limited = { rateLimit: { max: 10, timeWindow: '15 minutes' } };

  app.get('/me/2fa', { schema: { response: { 200: TwoFactorStatus } } }, async (req) => status(s.db, requireStaff(req).id));

  app.post('/me/2fa/setup', { schema: { response: { 200: TwoFactorSetupDto } }, config: limited }, async (req, reply) => {
    reply.header('cache-control', 'no-store');
    return startSetup(s, await loadUser(s.db, requireStaff(req).id));
  });

  app.post('/me/2fa/enable', { schema: { body: ConfirmTwoFactorInput, response: { 200: RecoveryCodesDto } }, config: limited }, async (req, reply) => {
    reply.header('cache-control', 'no-store');
    return { recoveryCodes: await enable(s, await loadUser(s.db, requireStaff(req).id), req.body.code) };
  });

  app.post('/me/2fa/disable', { schema: { body: DisableTwoFactorInput }, config: limited }, async (req, reply) => {
    await disable(s, requireStaff(req), req.body.password, req.body.code);
    return reply.status(204).send();
  });

  app.post('/me/2fa/recovery-codes', { schema: { body: z.object({ code: z.string().trim().min(6).max(20) }), response: { 200: RecoveryCodesDto } }, config: limited }, async (req, reply) => {
    reply.header('cache-control', 'no-store');
    return { recoveryCodes: await newCodes(s, requireStaff(req), req.body.code) };
  });

  app.post('/users/:id/reset-2fa', { schema: { params: z.object({ id: z.string().uuid() }) } }, async (req, reply) => {
    await resetFor(s, requireStaff(req, 'admin'), req.params.id);
    return reply.status(204).send();
  });

  app.get('/security', { schema: { response: { 200: SecuritySettings } } }, async (req) => {
    requireStaff(req, 'admin');
    return getSecurity(s.db);
  });

  app.put('/security', { schema: { body: SecuritySettings, response: { 200: SecuritySettings } } }, async (req) => saveSecurity(s, requireStaff(req, 'admin'), req.body));
};
