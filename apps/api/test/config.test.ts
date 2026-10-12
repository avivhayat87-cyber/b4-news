import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

const example = parseEnv(readFileSync(new URL('../.env.example', import.meta.url), 'utf8')) as NodeJS.ProcessEnv;

describe('configuration', () => {
  it('starts with .env.example copied as-is (empty values mean defaults)', () => {
    const config = loadConfig({ ...example, NODE_ENV: 'development' });
    expect(config.mediaDir.length).toBeGreaterThan(0);
    expect(config.ai.text).toBe('auto');
    expect(config.ai.allowStandIns).toBe(true);
    expect(config.revalidate.url).toBe('http://localhost:3000/api/revalidate');
  });

  it('refuses unsafe production settings', () => {
    expect(() => loadConfig({ ...example, NODE_ENV: 'production' })).toThrow(/HASH_PEPPER[\s\S]*SECRETS_KEY/);
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        HASH_PEPPER: 'a'.repeat(32),
        SECRETS_KEY: Buffer.alloc(32, 7).toString('base64'),
        REVALIDATE_SECRET: 'b'.repeat(32),
        SEED_SAMPLE_CONTENT: 'false',
        DEV_FIXTURES: 'true',
      } as NodeJS.ProcessEnv),
    ).toThrow(/DEV_FIXTURES/);
  });

  it('reads social tokens from the environment as a fallback', () => {
    const config = loadConfig({ NODE_ENV: 'test', SOCIAL_SECRET_TELEGRAM_BOT: 'token' } as NodeJS.ProcessEnv);
    expect(config.socialSecret('TELEGRAM_BOT')).toBe('token');
    expect(config.socialSecret('MISSING')).toBeUndefined();
  });
});
