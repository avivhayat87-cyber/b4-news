import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** 256-bit random token, URL-safe. Given to the client; only its hash is stored. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Keyed hash for values we must compare later but never store in clear (codes, IPs). */
export function keyedHash(pepper: string, ...parts: string[]): string {
  return createHmac('sha256', pepper).update(parts.join('\u0000')).digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Six-digit one-time code, uniformly random. */
export function newSixDigitCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}
