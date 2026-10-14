// Job kind -> handler. The only place that maps queued work to code.
import type { Handlers } from '../lib/jobs';
import type { Services } from './context';
import { FINAL_IMAGE_JOB, markRefineFailed, markRewriteFailed, runFinalImage, runImages, runRefine, runRewrite } from './drafts';
import { AGENT_TURN_JOB, markTurnFailed, runAgentTurn } from './agent/chat';
import { VISUAL_LEARN_JOB, runVisualLearning } from './agent/visual';
import { BATCH_LEARNING_JOB, runBatchLearning, runDistill } from './learning';
import { DIGEST_JOB, NOTIFY_JOB, runDigest, runNotify } from './notifications';
import { markPublishFailed, runPublish } from './publish';
import { failRun, runDiscovery } from './scraper/run';
import { runSourceSetup } from './scraper/setup';
import { runSocialGenerate } from './social';
import { PLAN_JOB, markPlanFailed, runPlan } from './social-plan';
import { REEL_JOBS, runReelImage, runReelPrompts, runReelVideo } from './social-reel';
import { KIT_JOB, SHARE_PUBLISH_JOB, markSharePublishFailed, runKit, runSharePublish } from './social-share';
import { TRANSLATE_JOB, runHeadlineTranslation } from './translate';

export const handlers: Handlers<Services> = {
  'discovery.run': {
    run: (s, job) => runDiscovery(s, String(job.payload.runId)),
    onFailed: (s, job, error) => failRun(s, String(job.payload.runId), error.message),
    maxAttempts: 1,
  },
  'draft.rewrite': { run: runRewrite, onFailed: (s, job) => markRewriteFailed(s, job) },
  'draft.refine': { run: runRefine, onFailed: markRefineFailed, maxAttempts: 2 },
  'draft.images': { run: runImages, maxAttempts: 2 },
  [FINAL_IMAGE_JOB]: { run: runFinalImage, maxAttempts: 2 },
  'social.generate': { run: runSocialGenerate, maxAttempts: 2 },
  [KIT_JOB]: { run: runKit, maxAttempts: 2 },
  [PLAN_JOB]: { run: runPlan, onFailed: markPlanFailed, maxAttempts: 2 },
  // A video costs money: one attempt; the editor retries from the CMS (the error is shown there).
  [REEL_JOBS.prompts]: { run: runReelPrompts, maxAttempts: 2 },
  [REEL_JOBS.image]: { run: runReelImage, maxAttempts: 1 },
  [REEL_JOBS.video]: { run: runReelVideo, maxAttempts: 1 },
  [SHARE_PUBLISH_JOB]: { run: runSharePublish, onFailed: markSharePublishFailed, maxAttempts: 1 },
  'publish.run': { run: runPublish, onFailed: markPublishFailed, maxAttempts: 2 },
  'learning.distill': { run: runDistill, maxAttempts: 2 },
  [BATCH_LEARNING_JOB]: { run: runBatchLearning, maxAttempts: 2 },
  [VISUAL_LEARN_JOB]: { run: runVisualLearning, maxAttempts: 2 },
  [NOTIFY_JOB]: { run: runNotify, maxAttempts: 2 },
  [DIGEST_JOB]: { run: runDigest, maxAttempts: 3 },
  [AGENT_TURN_JOB]: { run: runAgentTurn, onFailed: markTurnFailed, maxAttempts: 1 },
  'source.setup': { run: runSourceSetup, maxAttempts: 1 },
  [TRANSLATE_JOB]: { run: runHeadlineTranslation, maxAttempts: 2 },
};
