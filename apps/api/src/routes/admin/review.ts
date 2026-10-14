// The legal review (services/legal-review.ts): the articles waiting for a decision, one article's
// review, the decisions, the AI's safer wording, a new check, and publishing without a check.
import { DecideReviewInput, DraftReviewDto, WaiveReviewInput } from '@b4/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { audit } from '../../lib/audit';
import { requireStaff } from '../../plugins/auth';
import type { Services } from '../../services/context';
import * as review from '../../services/legal-review';

const params = z.object({ id: z.string().uuid() });
const issueParams = params.extend({ issueId: z.string().min(1).max(40) });
const jobId = z.object({ jobId: z.string().uuid() });

export const reviewRoutes: FastifyPluginAsyncZod<{ s: Services }> = async (app, { s }) => {
  app.get('/reviews', { schema: { response: { 200: z.array(DraftReviewDto) } } }, async () => review.reviewQueue(s));

  app.get('/drafts/:id/review', { schema: { params, response: { 200: DraftReviewDto } } }, async (req) => review.getReview(s, req.params.id));

  app.post('/drafts/:id/review', { schema: { params, response: { 202: jobId } }, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const staff = requireStaff(req, 'editor');
    return reply.status(202).send({ jobId: await review.requestReview(s, staff, req.params.id) });
  });

  // Every decision is recorded: it is the newsroom's responsibility for what goes out.
  app.post('/drafts/:id/review/issues/:issueId/decide', { schema: { params: issueParams, body: DecideReviewInput, response: { 200: DraftReviewDto } } }, async (req) => {
    const staff = requireStaff(req, 'editor');
    const result = await review.decideIssue(s, staff, req.params.id, req.params.issueId, req.body);
    await audit(s.db, { userId: staff.id, entity: 'draft_review', entityId: req.params.id, action: req.body.action, details: { issue: req.params.issueId, reason: req.body.reason ?? null } });
    return result;
  });

  app.post(
    '/drafts/:id/review/issues/:issueId/fix',
    { schema: { params: issueParams, response: { 202: jobId } }, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const staff = requireStaff(req, 'editor');
      return reply.status(202).send({ jobId: await review.requestFix(s, staff, req.params.id, req.params.issueId) });
    },
  );

  app.post('/drafts/:id/review/waive', { schema: { params, body: WaiveReviewInput, response: { 200: DraftReviewDto } } }, async (req) => {
    const staff = requireStaff(req, 'editor');
    const result = await review.waiveReview(s, staff, req.params.id, req.body.reason);
    await audit(s.db, { userId: staff.id, entity: 'draft_review', entityId: req.params.id, action: 'waive', details: { reason: req.body.reason } });
    return result;
  });
};
