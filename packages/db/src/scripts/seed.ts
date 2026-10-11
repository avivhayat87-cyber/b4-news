// Migrations + reference data + sample articles for local development: `npm run db:seed`
import { createDb, defaultDatabaseUrl } from '../client';
import { seedReferenceData, seedSampleContent } from '../seed';

const handle = createDb(process.env.DATABASE_URL ?? defaultDatabaseUrl());
try {
  await handle.migrate();
  await seedReferenceData(handle.db);
  const { articles } = await seedSampleContent(handle.db);
  console.log(articles ? `Seeded ${articles} sample articles.` : 'Articles already exist; sample content skipped.');
} finally {
  await handle.close();
}
