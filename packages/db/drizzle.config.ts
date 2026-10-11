import { defineConfig } from 'drizzle-kit';

// `npm run db:generate` turns changes in src/schema.ts into a new SQL migration in ./drizzle.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
  casing: 'snake_case',
});
