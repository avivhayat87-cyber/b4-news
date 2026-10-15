import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

  it('keeps media on local disk by default, and in an R2 bucket only when it is fully configured', () => {
    expect(loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv).mediaBucket).toBeNull();
    expect(() => loadConfig({ NODE_ENV: 'test', MEDIA_STORAGE: 'r2', R2_BUCKET: 'b4-media' } as NodeJS.ProcessEnv)).toThrow(/R2_ACCOUNT_ID[\s\S]*MEDIA_BASE_URL/);
    const config = loadConfig({
      NODE_ENV: 'test',
      MEDIA_STORAGE: 'r2',
      MEDIA_BASE_URL: 'https://media.b4news.co.il/',
      R2_ACCOUNT_ID: 'a'.repeat(32),
      R2_BUCKET: 'b4-media',
      R2_ACCESS_KEY_ID: 'key',
      R2_SECRET_ACCESS_KEY: 'secret',
    } as NodeJS.ProcessEnv);
    expect(config.mediaBucket).toEqual({ endpoint: `https://${'a'.repeat(32)}.r2.cloudflarestorage.com`, bucket: 'b4-media', accessKeyId: 'key', secretAccessKey: 'secret' });
    expect(config.mediaBaseUrl).toBe('https://media.b4news.co.il');
  });

  it('points the Claude app at the MCP server in this checkout unless an absolute MCP_SCRIPT is set', () => {
    expect(loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv).mcpScript).toBe(fileURLToPath(new URL('../mcp/b4-news-mcp.mjs', import.meta.url)));
    const stable = path.resolve('/b4-news-live/mcp/b4-news-mcp.mjs');
    expect(loadConfig({ NODE_ENV: 'test', MCP_SCRIPT: stable } as NodeJS.ProcessEnv).mcpScript).toBe(stable);
    expect(() => loadConfig({ NODE_ENV: 'test', MCP_SCRIPT: 'mcp/b4-news-mcp.mjs' } as NodeJS.ProcessEnv)).toThrow(/MCP_SCRIPT/);
  });

  it('reads social tokens from the environment as a fallback', () => {
    const config = loadConfig({ NODE_ENV: 'test', SOCIAL_SECRET_TELEGRAM_BOT: 'token' } as NodeJS.ProcessEnv);
    expect(config.socialSecret('TELEGRAM_BOT')).toBe('token');
    expect(config.socialSecret('MISSING')).toBeUndefined();
  });
});
