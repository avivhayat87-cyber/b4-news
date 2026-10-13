// The social page: published articles, their branded post/story/reel, and publishing to the networks.
import {
  GenerateSharesInput,
  PublishSharesInput,
  ReelPromptsInput,
  SHARE_FORMATS,
  ShareDto,
  ShareList,
  ShareListQuery,
  ShareTargetDto,
  UpdateReelPromptsInput,
  UpdateShareInput,
} from '@b4/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { audit } from '../../lib/audit';
import { requireStaff } from '../../plugins/auth';
import type { Services } from '../../services/context';
import * as reel from '../../services/social-reel';
import * as shares from '../../services/social-share';

const params = z.object({ articleId: z.coerce.number().int().positive() });
const jobId = z.object({ jobId: z.string().uuid() });

export const socialRoutes: FastifyPluginAsyncZod<{ s: Services }> = async (app, { s }) => {
  app.get('/social/articles', { schema: { querystring: ShareListQuery, response: { 200: ShareList } } }, async (req) => shares.listShares(s, req.query));

  app.get('/social/targets', { schema: { response: { 200: z.array(ShareTargetDto) } } }, async () => shares.listTargets(s));

  app.get('/social/articles/:articleId', { schema: { params, response: { 200: ShareDto } } }, async (req) => shares.getShare(s, req.params.articleId));

  app.put('/social/articles/:articleId', { schema: { params, body: UpdateShareInput, response: { 200: ShareDto } } }, async (req) => {
    const staff = requireStaff(req, 'editor');
    return shares.updateShare(s, staff, req.params.articleId, req.body);
  });

  app.post(
    '/social/generate',
    { schema: { body: GenerateSharesInput, response: { 202: z.object({ jobIds: z.array(z.string().uuid()) }) } }, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const staff = requireStaff(req, 'editor');
      return reply.status(202).send({ jobIds: await shares.requestKits(s, staff, req.body.articleIds, req.body.instruction, req.body.formats) });
    },
  );

  // --- Reels, in steps the editor approves one by one (services/social-reel.ts) ---
  const reelLimit = { rateLimit: { max: 6, timeWindow: '1 minute' } };

  /** 1. The AI writes the picture and video prompts in Hebrew (again, with an optional direction). */
  app.post('/social/articles/:articleId/reel/prompts', { schema: { params, body: ReelPromptsInput, response: { 202: jobId } }, config: reelLimit }, async (req, reply) => {
    const staff = requireStaff(req, 'editor');
    return reply.status(202).send({ jobId: await reel.requestReelPrompts(s, staff, req.params.articleId, req.body.instruction) });
  });

  /** The editor's wording of the prompts. */
  app.put('/social/articles/:articleId/reel/prompts', { schema: { params, body: UpdateReelPromptsInput, response: { 200: ShareDto } } }, async (req) => {
    requireStaff(req, 'editor');
    await reel.updateReelPrompts(s, req.params.articleId, req.body);
    return shares.getShare(s, req.params.articleId);
  });

  /** 2. Prompts approved: the picture (costs an image). */
  app.post('/social/articles/:articleId/reel/image', { schema: { params, response: { 202: jobId } }, config: reelLimit }, async (req, reply) => {
    const staff = requireStaff(req, 'editor');
    const id = await reel.requestReelImage(s, staff, req.params.articleId);
    await audit(s.db, { userId: staff.id, entity: 'article_share', entityId: String(req.params.articleId), action: 'reel_image' });
    return reply.status(202).send({ jobId: id });
  });

  /** 3. Picture approved: the video (costs a video). */
  app.post('/social/articles/:articleId/reel/video', { schema: { params, response: { 202: jobId } }, config: reelLimit }, async (req, reply) => {
    const staff = requireStaff(req, 'editor');
    const id = await reel.requestReelVideo(s, staff, req.params.articleId);
    await audit(s.db, { userId: staff.id, entity: 'article_share', entityId: String(req.params.articleId), action: 'reel_video' });
    return reply.status(202).send({ jobId: id });
  });

  /** 4. Video approved: the reel can be published. */
  app.post('/social/articles/:articleId/reel/approve', { schema: { params, response: { 200: ShareDto } } }, async (req) => {
    const staff = requireStaff(req, 'editor');
    await reel.approveReel(s, req.params.articleId);
    await audit(s.db, { userId: staff.id, entity: 'article_share', entityId: String(req.params.articleId), action: 'reel_approve' });
    return shares.getShare(s, req.params.articleId);
  });

  app.post(
    '/social/articles/:articleId/posted',
    { schema: { params, body: z.object({ accountId: z.string().uuid(), format: z.enum(SHARE_FORMATS) }) } },
    async (req, reply) => {
      requireStaff(req, 'editor');
      await shares.markPostedManually(s, req.params.articleId, req.body.accountId, req.body.format);
      return reply.status(204).send();
    },
  );

  app.post(
    '/social/publish',
    { schema: { body: PublishSharesInput, response: { 202: jobId } }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const staff = requireStaff(req, 'editor');
      return reply.status(202).send({ jobId: await shares.startSharePublish(s, staff, req.body) });
    },
  );
};
