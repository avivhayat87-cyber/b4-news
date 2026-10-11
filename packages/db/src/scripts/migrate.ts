// Applies pending migrations and reference data: `npm run db:migrate`
import { createDb, defaultDatabaseUrl } from '../client';
import { seedReferenceData } from '../seed';

const handle = createDb(process.env.DATABASE_URL ?? defaultDatabaseUrl());
try {
  await handle.migrate();
  await seedReferenceData(handle.db);
  console.log(`Migrations applied (${handle.kind}).`);
} finally {
  await handle.close();
}
