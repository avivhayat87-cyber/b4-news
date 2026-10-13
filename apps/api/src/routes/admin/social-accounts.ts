// Settings > social networks: the accounts posts go to (one per network), their
// write-only tokens and a connection test. Anyone on the staff may read the list;
// changes are for admins.
import { ConnectionTest, CreateSocialAccountInput, SetTokenInput, SocialAccountDto, UpdateSocialAccountInput } from '@b4/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireStaff } from '../../plugins/auth';
import { testSocialAccount } from '../../services/connection-tests';
import type { Services } from '../../services/context';
import * as accounts from '../../services/social-accounts';

const params = z.object({ id: z.string().uuid() });
const testLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };

export const socialAccountRoutes: FastifyPluginAsyncZod<{ s: Services }> = async (app, { s }) => {
  app.get('/social-accounts', { schema: { response: { 200: z.array(SocialAccountDto) } } }, async () => accounts.listAccounts(s));

  app.post('/social-accounts', { schema: { body: CreateSocialAccountInput, response: { 201: SocialAccountDto } } }, async (req, reply) => {
    const staff = requireStaff(req, 'admin');
    return reply.status(201).send(await accounts.createAccount(s, staff, req.body));
  });

  app.patch('/social-accounts/:id', { schema: { params, body: UpdateSocialAccountInput, response: { 200: SocialAccountDto } } }, async (req) => {
    const staff = requireStaff(req, 'admin');
    return accounts.updateAccount(s, staff, req.params.id, req.body);
  });

  app.delete('/social-accounts/:id', { schema: { params } }, async (req, reply) => {
    const staff = requireStaff(req, 'admin');
    await accounts.deleteAccount(s, staff, req.params.id);
    return reply.status(204).send();
  });

  app.put('/social-accounts/:id/token', { schema: { params, body: SetTokenInput, response: { 200: SocialAccountDto } } }, async (req) => {
    const staff = requireStaff(req, 'admin');
    return accounts.setAccountToken(s, staff, req.params.id, req.body.token);
  });

  app.post('/social-accounts/:id/test', { schema: { params, response: { 200: ConnectionTest } }, config: testLimit }, async (req) => {
    requireStaff(req, 'admin');
    return testSocialAccount(s, await accounts.loadAccount(s, req.params.id));
  });
};
