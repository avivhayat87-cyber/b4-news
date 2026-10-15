// The research reporter (services/research.ts): starting a research from a link or screenshots,
// the free "do we already have this story" check, the list and one research with its file, the
// copies of its sources, and the reporter's settings.
import { ResearchOverviewDto, ResearcherSettings, ResearchTaskDto, SimilarStoriesInput, SimilarStoryDto, SourceCopyDto, StartResearchInput } from '@b4/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { audit } from '../../lib/audit';
import { requireStaff } from '../../plugins/auth';
import { getResearcherSettings, saveResearcherSettings } from '../../services/agent/researcher';
import type { Services } from '../../services/context';
import * as research from '../../services/research';

const params = z.object({ id: z.string().uuid() });

export const researchRoutes: FastifyPluginAsyncZod<{ s: Services }> = async (app, { s }) => {
  app.get('/research', { schema: { response: { 200: ResearchOverviewDto } } }, async () => research.researchOverview(s));

  app.post('/research/similar', { schema: { body: SimilarStoriesInput, response: { 200: z.array(SimilarStoryDto) } } }, async (req) => {
    requireStaff(req, 'editor');
    return research.similarForUrl(s, req.body.url);
  });

  // Each research costs searches and tokens: a tight limit, and a record of who asked.
  app.post('/research', { schema: { body: StartResearchInput, response: { 202: ResearchTaskDto } }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const staff = requireStaff(req, 'editor');
    const task = await research.startResearch(s, staff, req.body);
    await audit(s.db, { userId: staff.id, entity: 'research', entityId: task.id, action: 'start', details: { kind: task.kind, depth: task.depth } });
    return reply.status(202).send(task);
  });

  app.get('/research/:id', { schema: { params, response: { 200: ResearchTaskDto } } }, async (req) => research.researchTask(s, req.params.id));

  app.post('/research/:id/retry', { schema: { params, response: { 202: ResearchTaskDto } }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const staff = requireStaff(req, 'editor');
    return reply.status(202).send(await research.retryResearch(s, staff, req.params.id));
  });

  app.post('/research/:id/archive', { schema: { params, response: { 202: ResearchTaskDto } }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const staff = requireStaff(req, 'editor');
    return reply.status(202).send(await research.retryArchive(s, staff, req.params.id));
  });

  app.get(
    '/research/:id/sources/:sourceId/text',
    { schema: { params: params.extend({ sourceId: z.string().regex(/^s\d{1,3}$/) }), response: { 200: SourceCopyDto } } },
    async (req) => research.sourceCopy(s, req.params.id, req.params.sourceId),
  );

  app.get('/drafts/:id/research', { schema: { params, response: { 200: ResearchTaskDto.nullable() } } }, async (req) => research.researchForDraft(s, req.params.id));

  // --- The reporter's settings (the budget and which sources may back a fact: an admin's call) ---
  app.get('/agent/researcher-settings', { schema: { response: { 200: ResearcherSettings } } }, async () => getResearcherSettings(s.db));

  app.put('/agent/researcher-settings', { schema: { body: ResearcherSettings, response: { 200: ResearcherSettings } } }, async (req) => {
    const staff = requireStaff(req, 'admin');
    const saved = await saveResearcherSettings(s.db, staff.id, req.body);
    await audit(s.db, { userId: staff.id, entity: 'agent', entityId: 'researcher-settings', action: 'update', details: { monthlyBudgetUsd: saved.monthlyBudgetUsd, defaultDepth: saved.defaultDepth } });
    return saved;
  });
};
