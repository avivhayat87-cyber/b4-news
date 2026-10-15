// The research reporter (services/research.ts): starting a research from a link, screenshots or an
// idea, the free "do we already have this story" check, the list and one research with its file,
// the copies of its sources, and the reporter's settings. And the editorial meeting
// (services/editorial-meeting.ts): holding one, and approving or turning down its pitches.
import {
  ApprovePitchInput,
  MeetingDto,
  ResearchOverviewDto,
  ResearcherSettings,
  ResearchTaskDto,
  SimilarStoriesInput,
  SimilarStoryDto,
  SourceCopyDto,
  StartMeetingInput,
  StartResearchInput,
} from '@b4/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { audit } from '../../lib/audit';
import { requireStaff } from '../../plugins/auth';
import { getResearcherSettings, saveResearcherSettings } from '../../services/agent/researcher';
import type { Services } from '../../services/context';
import * as meeting from '../../services/editorial-meeting';
import * as research from '../../services/research';

const params = z.object({ id: z.string().uuid() });
const pitchParams = params.extend({ pitchId: z.string().regex(/^p\d{1,2}$/) });

export const researchRoutes: FastifyPluginAsyncZod<{ s: Services }> = async (app, { s }) => {
  app.get('/research', { schema: { response: { 200: ResearchOverviewDto } } }, async () => research.researchOverview(s));

  app.post('/research/similar', { schema: { body: SimilarStoriesInput, response: { 200: z.array(SimilarStoryDto) } } }, async (req) => {
    requireStaff(req, 'editor');
    return 'url' in req.body ? research.similarForUrl(s, req.body.url) : research.similarByTopic(s, req.body.text);
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


  // --- The editorial meeting ---------------------------------------------------------------------
  app.get('/meetings', { schema: { response: { 200: z.array(MeetingDto) } } }, async () => meeting.meetings(s));

  app.get('/meetings/:id', { schema: { params, response: { 200: MeetingDto } } }, async (req) => meeting.meeting(s, req.params.id));

  // One AI call per meeting (cheap, but not free): a limit, and a record of who called it.
  app.post('/meetings', { schema: { body: StartMeetingInput, response: { 202: MeetingDto } }, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const staff = requireStaff(req, 'editor');
    const held = await meeting.startMeeting(s, staff, req.body);
    await audit(s.db, { userId: staff.id, entity: 'meeting', entityId: held.id, action: 'start', details: { focus: held.focus } });
    return reply.status(202).send(held);
  });

  // Approving starts a paid research: recorded with who decided.
  app.post(
    '/meetings/:id/pitches/:pitchId/approve',
    { schema: { params: pitchParams, body: ApprovePitchInput, response: { 200: MeetingDto } }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const staff = requireStaff(req, 'editor');
      const result = await meeting.approvePitch(s, staff, req.params.id, req.params.pitchId, req.body);
      await audit(s.db, { userId: staff.id, entity: 'meeting', entityId: req.params.id, action: 'approve', details: { pitch: req.params.pitchId, depth: req.body.depth ?? null } });
      return result;
    },
  );

  app.post('/meetings/:id/pitches/:pitchId/reject', { schema: { params: pitchParams, response: { 200: MeetingDto } } }, async (req) => {
    const staff = requireStaff(req, 'editor');
    return meeting.rejectPitch(s, staff, req.params.id, req.params.pitchId);
  });
};