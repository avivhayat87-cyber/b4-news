// Authenticated encryption for API keys and tokens at rest (AES-256-GCM).
// The key name is bound as associated data, so a ciphertext copied to another
// row (say, from a test key to the production key) fails to decrypt.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';

export class SecretBox {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error('SecretBox needs a 32-byte key');
  }

  seal(name: string, plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(name));
    const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return `${VERSION}:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')}`;
  }

  open(name: string, sealed: string): string {
    const [version, payload] = sealed.split(':', 2);
    if (version !== VERSION || !payload) throw new Error('unknown secret format');
    const raw = Buffer.from(payload, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(name));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  }
}

/** The last characters of a secret, to recognize it in the CMS without revealing it. */
export function hintOf(secret: string): string {
  return secret.length <= 8 ? '••••' : `••••${secret.slice(-4)}`;
}
