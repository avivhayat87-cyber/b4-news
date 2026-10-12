// A standalone job worker for production (run the API with WORKER=off and as
// many of these as needed). Needs a shared PostgreSQL DATABASE_URL: the
// embedded local database can only be opened by one process.
import { createDb } from '@b4/db';
import { loadConfig } from './config';
import { JobRunner } from './lib/jobs';
import { consoleLog, createServices } from './services/context';
import { handlers } from './services/handlers';

try {
  process.loadEnvFile('.env');
} catch {
  // No .env file: defaults apply.
}

const config = loadConfig();
if (!config.databaseUrl?.startsWith('postgres')) {
  console.error('The standalone worker needs DATABASE_URL=postgres://... (use WORKER=inline with the local database).');
  process.exit(1);
}
const handle = createDb(config.databaseUrl);
const services = createServices(config, handle.db, consoleLog);
const runner = new JobRunner(handle.db, handlers, services, { concurrency: config.worker.concurrency, logger: consoleLog });

const shutdown = async () => {
  await runner.stop();
  await handle.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

runner.start();
console.log(`Worker started (concurrency ${config.worker.concurrency}).`);