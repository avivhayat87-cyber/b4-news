import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { createDb, defaultDatabaseUrl, seedReferenceData, seedSampleContent } from '@b4/db';
import { buildApp } from './app';
import { loadConfig } from './config';
import { CATEGORY_SLUGS } from '@b4/shared';
import { illustrateSampleArticles } from './dev/illustrations';
import { ensureDevAdmin, seedDevSources } from './dev/seed';
import { ensureDigestTick } from './services/digest';
import { ensureMorningTick } from './services/editorial-meeting';
import { revalidateSite } from './services/publish';
import { JobRunner } from './lib/jobs';
import { handlers } from './services/handlers';

try {
  process.loadEnvFile('.env');
} catch {
  // No .env file: defaults apply.
}

const config = loadConfig();
const handle = createDb(config.databaseUrl ?? defaultDatabaseUrl());
await handle.migrate();
await seedReferenceData(handle.db);
if (config.seedSampleContent) {
  const { articles } = await seedSampleContent(handle.db);
  if (articles) console.log(`Seeded ${articles} sample articles.`);
}
if (config.devFixtures) {
  await seedDevSources(handle.db, config.publicApiUrl);
  await ensureDevAdmin(handle.db, path.dirname(config.mediaDir));
}

const app = await buildApp({ config, db: handle.db });

// Background work runs in this process unless WORKER=off (then run `npm run worker`).
const runner = config.worker.mode === 'inline' ? new JobRunner(handle.db, handlers, app.services, { concurrency: config.worker.concurrency, logger: app.log }) : null;

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  // Running jobs get a minute to finish; any still running then resume at the next start.
  await Promise.race([runner?.stop(), new Promise((resolve) => setTimeout(resolve, 60_000))]);
  await app.close();
  await handle.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// The live environment's release tool (scripts/live.mjs) stops this process over HTTP, since
// Windows has no graceful signal for a background process. Local callers with the token only.
const shutdownToken = process.env.SHUTDOWN_TOKEN;
if (shutdownToken) {
  app.post('/internal/shutdown', { config: { rateLimit: false } }, async (req, reply) => {
    const given = Buffer.from(String(req.headers['x-shutdown-token'] ?? ''));
    const expected = Buffer.from(shutdownToken);
    const local = req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1';
    if (!local || given.length !== expected.length || !timingSafeEqual(given, expected)) return reply.status(404).send();
    setImmediate(() => void shutdown());
    return reply.status(202).send({ stopping: true });
  });
}

await app.listen({ host: config.host, port: config.port });
// The embedded database has a single worker (this process), so jobs a restart cut off resume right away.
if (runner && handle.kind === 'pglite') await runner.recoverInterrupted();
// "העיתון שלי": the recurring job that sends personal issues at each reader's hour.
if (runner) await ensureDigestTick(handle.db);
// The morning editorial meeting: on the live site only, so a workshop never mails the admins too.
if (runner && config.production) await ensureMorningTick(handle.db);
runner?.start();
const ai = await app.services.ai.status();
app.log.info(`AI: text=${ai.text} images=${ai.image}; worker=${config.worker.mode}`);

// Development: draw the sample articles' illustrations in the background, then refresh the site.
if (config.seedSampleContent) {
  void illustrateSampleArticles(handle.db, app.services.storage, (msg) => app.log.info(msg))
    .then((slugs) =>
      slugs.length
        ? revalidateSite(app.services, ['home', 'search', ...CATEGORY_SLUGS.map((c) => `category:${c}`), ...slugs.map((s) => `article-slug:${s}`)])
        : undefined,
    )
    .catch((err) => app.log.warn({ err: err instanceof Error ? err.message : err }, 'sample illustrations failed'));
}
