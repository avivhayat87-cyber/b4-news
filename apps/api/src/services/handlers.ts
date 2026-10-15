// Job kind -> handler. The only place that maps queued work to code.
import type { Handlers } from '../lib/jobs';
import type { Services } from './context';
import { FINAL_IMAGE_JOB, markRefineFailed, markRewriteFailed, runFinalImage, runImages, runRefine, runRewrite } from './drafts';
import { AD_AGENT_JOB, markAdTaskFailed, runAdTask } from './agent/ads';
import { AGENT_TURN_JOB, markTurnFailed, runAgentTurn } from './agent/chat';
import { VISUAL_LEARN_JOB, runVisualLearning } from './agent/visual';
import { DESK_PLAN_JOB, runDeskPlan } from './front-page';
import { BATCH_LEARNING_JOB, runBatchLearning, runDistill } from './learning';
import { DIGEST_TICK_JOB, ensureDigestTick, runDigestTick } from './digest';
import { DIGEST_JOB, NOTIFY_JOB, runDigest, runNotify } from './notifications';
import { MEETING_JOB, MORNING_TICK_JOB, ensureMorningTick, markMeetingFailed, runMeeting, runMorningTick } from './editorial-meeting';
import { REGISTRY_JOB, REGISTRY_TICK_JOB, ensureRegistryTick, runRegistryTick, runRegistryUpdate } from './official-sources';
import { FIX_JOB, REVIEW_JOB, markFixFailed, markReviewFailed, runFix, runReview } from './legal-review';
import { markPublishFailed, runPublish } from './publish';
import { PICK_JOB, markPicksFailed, runPicks } from './scraper/picks';
import { failRun, runDiscovery } from './scraper/run';
import { runSourceSetup } from './scraper/setup';
import { runSocialGenerate } from './social';
import { PLAN_JOB, markPlanFailed, runPlan } from './social-plan';
import { ARCHIVE_JOB, RESEARCH_JOB, markResearchFailed, runArchive, runResearch } from './research';
import { REEL_JOBS, runReelImage, runReelPrompts, runReelVideo } from './social-reel';
import { KIT_JOB, SHARE_PUBLISH_JOB, markSharePublishFailed, runKit, runSharePublish } from './social-share';
import { TRANSLATE_JOB, runHeadlineTranslation } from './translate';

export const handlers: Handlers<Services> = {
  'discovery.run': {
    run: (s, job) => runDiscovery(s, String(job.payload.runId)),
    onFailed: (s, job, error) => failRun(s, String(job.payload.runId), error.message),
    maxAttempts: 1,
  },
  // The chief editor's picks: cheap, so a second attempt; then the editor asks again from the run.
  [PICK_JOB]: { run: runPicks, onFailed: markPicksFailed, maxAttempts: 2 },
  'draft.rewrite': { run: runRewrite, onFailed: (s, job) => markRewriteFailed(s, job) },
  'draft.refine': { run: runRefine, onFailed: markRefineFailed, maxAttempts: 2 },
  'draft.images': { run: runImages, maxAttempts: 2 },
  // One attempt (the AI client already retries): a failure shows at once, with "check again".
  [REVIEW_JOB]: { run: runReview, onFailed: markReviewFailed, maxAttempts: 1 },
  [FIX_JOB]: { run: runFix, onFailed: markFixFailed, maxAttempts: 1 },
  [FINAL_IMAGE_JOB]: { run: runFinalImage, maxAttempts: 2 },
  // The chief editor places a batch: cheap, one attempt; the editor asks again from the CMS.
  [DESK_PLAN_JOB]: { run: runDeskPlan, maxAttempts: 1 },
  // A research is paid for by its searches: one attempt; the editor retries from the CMS.
  [RESEARCH_JOB]: { run: runResearch, onFailed: markResearchFailed, maxAttempts: 1 },
  [ARCHIVE_JOB]: { run: runArchive, maxAttempts: 1 },
  [MEETING_JOB]: { run: runMeeting, onFailed: markMeetingFailed, maxAttempts: 1 },
  [REGISTRY_JOB]: { run: runRegistryUpdate, maxAttempts: 1 },
  [REGISTRY_TICK_JOB]: { run: runRegistryTick, maxAttempts: 1, onFailed: (s) => ensureRegistryTick(s.db, new Date(Date.now() + 6 * 3600_000)).then(() => undefined) },
  [MORNING_TICK_JOB]: { run: runMorningTick, maxAttempts: 1, onFailed: (s) => ensureMorningTick(s.db, new Date(Date.now() + 15 * 60_000)).then(() => undefined) },
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
  [DIGEST_TICK_JOB]: { run: runDigestTick, maxAttempts: 1, onFailed: (s) => ensureDigestTick(s.db, new Date(Date.now() + 15 * 60_000)).then(() => undefined) },
  [DIGEST_JOB]: { run: runDigest, maxAttempts: 3 },
  [AGENT_TURN_JOB]: { run: runAgentTurn, onFailed: markTurnFailed, maxAttempts: 1 },
  // The ads agent: one attempt (a picture costs money); the admin asks again from the CMS.
  [AD_AGENT_JOB]: { run: runAdTask, onFailed: markAdTaskFailed, maxAttempts: 1 },
  'source.setup': { run: runSourceSetup, maxAttempts: 1 },
  [TRANSLATE_JOB]: { run: runHeadlineTranslation, maxAttempts: 2 },
};
