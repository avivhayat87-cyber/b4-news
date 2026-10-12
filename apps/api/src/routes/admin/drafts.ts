// Saved edits, the split-screen editor, the social module and publishing.
import {
  AutosaveInput,
  AutosaveResult,
  ChatMessageDto,
  DraftDetail,
  DraftMetaInput,
  GenerateImagesInput,
  GenerateSocialInput,
  ImageBatchDto,
  JobRef,
  MagazineDetail,
  PublishInput,
  PublishJobDto,
  PublishPreview,
  RefineInput,
  SavedEdits,
  SkipInput,
  SocialPackageDto,
  SocialTargetsInput,
  UpdateSocialInput,
} from '@b4/shared';
import { eq, jobs, magazines } from '@b4/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errors } from '../../errors';
import { audit } from '../../lib/audit';
import { requireStaff } from '../../plugins/auth';
import type { Services } from '../../services/context';
import * as drafts from '../../services/drafts';
import { preview, publishJobDto, startPublish } from '../../services/publish';
import * as social from '../../services/social';

const params = z.object({ id: z.string().uuid() });
const jobId = z.object({ jobId: z.string().uuid() });

export const draftRoutes: FastifyPluginAsyncZod<{ s: Services }> = async (app, { s }) => {
  // --- Saved edits and magazines ------------------------------------------
  app.get('/saved', { schema: { response: { 200: SavedEdits } } }, async () => drafts.listSaved(s));

  app.get('/magazines/:id', { schema: { params, response: { 200: MagazineDetail } } }, async (req) => drafts.magazineDetail(s, req.params.id));

  app.patch('/magazines/:id', { schema: { params, body: z.object({ title: z.string().trim().min(1).max(120) }) } }, async (req, reply) => {
    requireStaff(req, 'editor');
    const [row] = await s.db.update(magazines).set({ title: req.body.title }).where(eq(magazines.id, req.params.id)).returning({ id: magazines.id });
    if (!row) throw errors.notFound('המגזין');
    return reply.status(204).send();
  });

  app.post('/magazines/:id/archive', { schema: { params } }, async (req, reply) => {
    const staff = requireStaff(req, 'editor');
    await s.db.update(magazines).set({ status: 'archived' }).where(eq(magazines.id, req.params.id));
    await audit(s.db, { userId: staff.id, entity: 'magazine', entityId: req.params.id, action: 'archive' });
    return reply.status(204).send();
  });

  app.get('/magazines/:id/preview', { schema: { params, response: { 200: PublishPreview } } }, async (req) => {
    const staff = requireStaff(req);
    return preview(s, staff, { magazineId: req.params.id });
  });

  app.post('/magazines/:id/publish', { schema: { params, body: PublishInput, response: { 202: z.object({ publishJobId: z.string().uuid() }) } } }, async (req, reply) => {
    const staff = requireStaff(req, 'editor');
    const publishJobId = await startPublish(s, staff, { magazineId: req.params.id }, req.body.idempotencyKey);
    await audit(s.db, { userId: staff.id, entity: 'magazine', entityId: req.params.id, action: 'publish', details: { publishJobId } });
    return reply.status(202).send({ publishJobId });
  });

  app.get('/publish-jobs/:id', { schema: { params, response: { 200: PublishJobDto } } }, async (req) => publishJobDto(s, req.params.id));

  app.get('/jobs/:id', { schema: { params, response: { 200: JobRef } } }, async (req) => {
    const [job] = await s.db.select({ id: jobs.id, kind: jobs.kind, status: jobs.status, error: jobs.lastError }).from(jobs).where(eq(jobs.id, req.params.id)).limit(1);
    if (!job) throw errors.notFound('המשימה');
    return job;
  });

  // --- The editor -----------------------------------------------------------
  app.get('/drafts/:id', { schema: { params, response: { 200: DraftDetail } } }, async (req) => drafts.draftDetail(s, req.params.id));

  app.put(
    '/drafts/:id/content',
    { bodyLimit: 1_000_000, schema: { params, body: AutosaveInput, response: { 200: AutosaveResult } }, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (req) => {
      const staff = requireStaff(req, 'editor');
      return drafts.autosave(s, staff, req.params.id, req.body);
    },
  );

  app.patch('/drafts/:id', { schema: { params, body: DraftMetaInput } }, async (req, reply) => {
    const staff = requireStaff(req, 'editor');
    await drafts.updateMeta(s, staff, req.params.id, req.body);
    return reply.status(204).send();
  });

  app.post('/drafts/:id/refine', { schema: { params, body: RefineInput, response: { 202: jobId } }, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const staff = requireStaff(req, 'editor');
    return reply.status(202).send({ jobId: await drafts.requestRefine(s, staff, req.params.id, req.body.instruction, req.body.selection) });
  });

  app.get('/drafts/:id/chat', { schema: { params, response: { 200: z.array(ChatMessageDto) } } }, async (req) => drafts.chatMessages(s, req.params.id));

  app.post('/drafts/:id/retry-ai', { schema: { params } }, async (req, reply) => {
    const staff = requireStaff(req, 'editor');
    await drafts.retryRewrite(s, staff, req.params.id);
    return reply.status(202).send();
  });

  app.get(
    '/drafts/:id/images',
    { schema: { params, response: { 200: z.object({ batches: z.array(ImageBatchDto), activeJob: JobRef.nullable() }) } } },
    async (req) => ({ batches: await drafts.imageBatchesOf(s, req.params.id, 'article'), activeJob: await drafts.imagesJob(s, req.params.id) }),
  );

  app.post(
    '/drafts/:id/images',
    { schema: { params, body: GenerateImagesInput, response: { 202: jobId } }, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const staff = requireStaff(req, 'editor');
      return reply.status(202).send({ jobId: await drafts.requestImages(s, staff.id, req.params.id, 'article', req.body.prompt) });
    },
  );

  for (const [path, action] of [
    ['finalize', drafts.finalizeText],
    ['reopen', drafts.reopenText],
    ['unskip', drafts.unskipDraft],
  ] as const) {
    app.post(`/drafts/:id/${path}`, { schema: { params } }, async (req, reply) => {
      const staff = requireStaff(req, 'editor');
      await action(s, staff, req.params.id);
      return reply.status(204).send();
    });
  }

  app.post('/drafts/:id/skip', { schema: { params, body: SkipInput } }, async (req, reply) => {
    const staff = requireStaff(req, 'editor');
    await drafts.skipDraft(s, staff, req.params.id, req.body.reason);
    return reply.status(204).send();
  });

  app.get('/drafts/:id/revisions', { schema: { params } }, async (req) => drafts.revisions(s, req.params.id));

  app.post(
    '/drafts/:id/revisions/:revisionId/restore',
    { schema: { params: z.object({ id: z.string().uuid(), revisionId: z.coerce.number().int().positive() }), response: { 200: AutosaveResult } } },
    async (req) => {
      const staff = requireStaff(req, 'editor');
      return drafts.restoreRevision(s, staff, req.params.id, req.params.revisionId);
    },
  );

  app.get('/drafts/:id/preview', { schema: { params, response: { 200: PublishPreview } } }, async (req) => {
    const staff = requireStaff(req);
    return preview(s, staff, { draftId: req.params.id });
  });

  app.post('/drafts/:id/publish', { schema: { params, body: PublishInput, response: { 202: z.object({ publishJobId: z.string().uuid() }) } } }, async (req, reply) => {
    const staff = requireStaff(req, 'editor');
    const publishJobId = await startPublish(s, staff, { draftId: req.params.id }, req.body.idempotencyKey);
    await audit(s.db, { userId: staff.id, entity: 'draft', entityId: req.params.id, action: 'publish', details: { publishJobId } });
    return reply.status(202).send({ publishJobId });
  });

  // --- Social module (after the text is final) -------------------------------
  app.get('/drafts/:id/social', { schema: { params, response: { 200: SocialPackageDto } } }, async (req) => social.getSocial(s, req.params.id));

  app.put('/drafts/:id/social', { schema: { params, body: UpdateSocialInput, response: { 200: z.object({ version: z.number().int() }) } } }, async (req) => {
    const staff = requireStaff(req, 'editor');
    return social.updateSocial(s, staff, req.params.id, req.body);
  });

  app.post(
    '/drafts/:id/social/generate',
    { schema: { params, body: GenerateSocialInput, response: { 202: jobId } }, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const staff = requireStaff(req, 'editor');
      return reply.status(202).send({ jobId: await social.requestSocial(s, staff, req.params.id, req.body.what, req.body.instruction) });
    },
  );

  app.post('/drafts/:id/social/approve', { schema: { params } }, async (req, reply) => {
    const staff = requireStaff(req, 'editor');
    await social.approveSocial(s, staff, req.params.id);
    return reply.status(204).send();
  });

  app.put('/drafts/:id/social/targets', { schema: { params, body: SocialTargetsInput } }, async (req, reply) => {
    requireStaff(req, 'editor');
    await social.setTargets(s, req.params.id, req.body.accounts);
    return reply.status(204).send();
  });
};
