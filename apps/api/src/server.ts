import path from 'node:path';
import { createDb, defaultDatabaseUrl, seedReferenceData, seedSampleContent } from '@b4/db';
import { buildApp } from './app';
import { loadConfig } from './config';
import { ensureDevAdmin, seedDevSources } from './dev/seed';
import { JobRunner } from './lib/jobs';
import { ConsoleMailer, SmtpMailer } from './lib/mailer';
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

const mailer = config.smtpUrl ? new SmtpMailer(config.smtpUrl, config.mailFrom) : new ConsoleMailer();
const app = await buildApp({ config, db: handle.db, mailer });

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
app.log.info(`AI: text=${config.ai.text} images=${config.ai.image}; worker=${config.worker.mode}`);
