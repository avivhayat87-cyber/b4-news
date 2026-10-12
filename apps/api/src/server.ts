import path from 'node:path';
import { createDb, defaultDatabaseUrl, seedReferenceData, seedSampleContent } from '@b4/db';
import { buildApp } from './app';
import { loadConfig } from './config';
import { CATEGORY_SLUGS } from '@b4/shared';
import { illustrateSampleArticles } from './dev/illustrations';
import { ensureDevAdmin, seedDevSources } from './dev/seed';
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

const shutdown = async () => {
  await runner?.stop();
  await app.close();
  await handle.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ host: config.host, port: config.port });
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
