// Job kind -> handler. The only place that maps queued work to code.
import type { Handlers } from '../lib/jobs';
import type { Services } from './context';
import { markRefineFailed, markRewriteFailed, runImages, runRefine, runRewrite } from './drafts';
import { runDistill } from './learning';
import { markPublishFailed, runPublish } from './publish';
import { failRun, runDiscovery } from './scraper/run';
import { runSocialGenerate } from './social';

export const handlers: Handlers<Services> = {
  'discovery.run': {
    run: (s, job) => runDiscovery(s, String(job.payload.runId)),
    onFailed: (s, job, error) => failRun(s, String(job.payload.runId), error.message),
    maxAttempts: 1,
  },
  'draft.rewrite': { run: runRewrite, onFailed: (s, job) => markRewriteFailed(s, job) },
  'draft.refine': { run: runRefine, onFailed: markRefineFailed, maxAttempts: 2 },
  'draft.images': { run: runImages, maxAttempts: 2 },
  'social.generate': { run: runSocialGenerate, maxAttempts: 2 },
  'publish.run': { run: runPublish, onFailed: markPublishFailed, maxAttempts: 2 },
  'learning.distill': { run: runDistill, maxAttempts: 2 },
};
