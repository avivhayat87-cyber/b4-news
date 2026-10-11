// Creates (or resets) a CMS staff account. Stop the API first when using the local database.
//   npm run create-admin -w @b4/api -- --email you@example.com --name "Your Name" [--role admin|editor|developer|viewer]
import { parseArgs } from 'node:util';
import { createDb, defaultDatabaseUrl, seedReferenceData, users } from '@b4/db';
import { Email, STAFF_ROLES } from '@b4/shared';
import { z } from 'zod';
import { newToken } from '../lib/crypto';
import { hashPassword } from '../lib/password';

try {
  process.loadEnvFile('.env');
} catch {
  // defaults
}

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    role: { type: 'string', default: 'admin' },
  },
});

const input = z
  .object({ email: Email, name: z.string().trim().min(2).max(80), role: z.enum(STAFF_ROLES) })
  .safeParse({ email: values.email, name: values.name, role: values.role });
if (!input.success) {
  console.error('Usage: npm run create-admin -w @b4/api -- --email you@example.com --name "Full Name" [--role admin]');
  console.error(input.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n'));
  process.exit(1);
}

const password = newToken().slice(0, 20);
const handle = createDb(process.env.DATABASE_URL || defaultDatabaseUrl());
try {
  await handle.migrate();
  await seedReferenceData(handle.db);
  await handle.db
    .insert(users)
    .values({ email: input.data.email, fullName: input.data.name, role: input.data.role, passwordHash: await hashPassword(password) })
    .onConflictDoUpdate({
      target: users.email,
      set: { fullName: input.data.name, role: input.data.role, passwordHash: await hashPassword(password), isActive: true },
    });
  console.log(`\nStaff account ready: ${input.data.email} (${input.data.role})\nTemporary password: ${password}\nIt is shown only once.\n`);
} finally {
  await handle.close();
}
