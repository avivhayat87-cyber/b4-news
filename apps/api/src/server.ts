import { createDb, defaultDatabaseUrl, seedReferenceData, seedSampleContent } from '@b4/db';
import { buildApp } from './app';
import { loadConfig } from './config';
import { ConsoleMailer, SmtpMailer } from './lib/mailer';

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

const mailer = config.smtpUrl ? new SmtpMailer(config.smtpUrl, config.mailFrom) : new ConsoleMailer();
const app = await buildApp({ config, db: handle.db, mailer });

const shutdown = async () => {
  await app.close();
  await handle.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ host: config.host, port: config.port });
