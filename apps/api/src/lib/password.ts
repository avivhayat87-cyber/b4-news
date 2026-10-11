import { hash, verify } from '@node-rs/argon2';

// argon2id with OWASP-recommended parameters (19 MiB, 2 iterations).
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

// Used when the email is unknown, so a failed login takes the same time either way.
let dummyHash: Promise<string> | undefined;

export async function verifyPassword(storedHash: string | null | undefined, password: string): Promise<boolean> {
  if (!storedHash) {
    dummyHash ??= hash('not-a-real-password', OPTIONS);
    await verify(await dummyHash, password).catch(() => false);
    return false;
  }
  return verify(storedHash, password).catch(() => false);
}
