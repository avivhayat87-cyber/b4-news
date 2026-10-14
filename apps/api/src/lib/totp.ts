// Time-based one-time codes (RFC 6238, as in Google Authenticator and Microsoft Authenticator):
// HMAC-SHA1, 30-second steps, 6 digits, one step of clock drift either way. Plus the base32
// secret the apps scan, and one-time recovery codes for a lost phone.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('invalid base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new secret: 20 random bytes, as the apps expect. */
export const newTotpSecret = () => base32Encode(randomBytes(20));

export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS);

export function totpAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 15;
  const n = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return n.toString().padStart(6, '0');
}

/**
 * The step the code belongs to (now, or one step before or after), or null. A step at or before
 * `notAfter` (the last one used) is refused, so a code can't be used twice.
 */
export function verifyTotp(secret: string, code: string, opts: { now?: number; notAfter?: number | null } = {}): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const step = currentStep(opts.now);
  for (const s of [step - 1, step, step + 1]) {
    if (opts.notAfter != null && s <= opts.notAfter) continue;
    if (timingSafeEqual(Buffer.from(totpAt(secret, s)), Buffer.from(code))) return s;
  }
  return null;
}

/** What the authenticator app scans: otpauth://totp/<issuer>:<account>?secret=…&issuer=… */
export function otpauthUrl(issuer: string, account: string, secret: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
}

/** Ten one-time recovery codes, "abcd-efgh" (letters and digits that are easy to read). */
export function newRecoveryCodes(count = 10): string[] {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: count }, () => {
    const b = randomBytes(8);
    const s = [...b].map((x) => chars[x % chars.length]).join('');
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
}
