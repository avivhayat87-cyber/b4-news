// Settings > connections and site details: write-only secrets, encrypted at
// rest, admin-only, applied without a restart.
import { secrets, socialAccounts } from '@b4/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SecretBox } from '../src/lib/secret-box';
import { createAiHub } from '../src/services/ai';
import { SettingsStore } from '../src/services/settings';
import { setup, signInStaff, staffClient } from './helpers';

let ctx: Awaited<ReturnType<typeof setup>>;
let admin: ReturnType<typeof staffClient>;
let editor: ReturnType<typeof staffClient>;
const KEY = `sk-ant-api03-${'x'.repeat(40)}ABCD`;

beforeAll(async () => {
  ctx = await setup();
  admin = staffClient(ctx, await signInStaff(ctx, 'admin'));
  editor = staffClient(ctx, await signInStaff(ctx, 'editor'));
});
afterAll(() => ctx.close());

describe('connections', () => {
  it('only admins can see or change keys', async () => {
    expect((await editor.get('/integrations')).status).toBe(403);
    expect((await editor.put('/integrations/anthropic', { values: { apiKey: KEY } })).status).toBe(403);
  });

  it('stores keys encrypted and never returns them', async () => {
    const res = await admin.put('/integrations/anthropic', { values: { apiKey: KEY, model: 'claude-opus-5-5' } });
    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(true);
    expect(res.body.source).toBe('cms');
    expect(res.body.fields.find((f: { key: string }) => f.key === 'apiKey').hint).toBe('••••ABCD');
    expect(res.body.fields.find((f: { key: string }) => f.key === 'model').value).toBe('claude-opus-5-5');

    const [row] = await ctx.db.select().from(secrets);
    expect(row!.ciphertext.startsWith('v1:')).toBe(true);
    expect(row!.ciphertext).not.toContain('xxxxxxxx');
    const list = await admin.get('/integrations');
    expect(JSON.stringify([res.body, list.body])).not.toContain('xxxxxxxx');
  });

  it('rejects values that are not keys and unknown fields', async () => {
    expect((await admin.put('/integrations/anthropic', { values: { apiKey: 'hello' } })).status).toBe(422);
    expect((await admin.put('/integrations/anthropic', { values: { nope: 'x' } })).status).toBe(400);
  });

  it('uses a key entered in the CMS for the next AI call, without a restart', async () => {
    const hub = createAiHub({ ...ctx.config, ai: { ...ctx.config.ai, text: 'auto' } }, new SettingsStore(ctx.db, ctx.config));
    const text = await hub.text();
    expect(text.provider).toBe('anthropic');
    expect(text.live).toBe(true);

    expect((await admin.put('/integrations/anthropic', { values: { apiKey: null } })).body.connected).toBe(false);
    const production = createAiHub({ ...ctx.config, ai: { ...ctx.config.ai, text: 'auto', allowStandIns: false } }, new SettingsStore(ctx.db, ctx.config));
    await expect(production.text()).rejects.toThrow(/לא מחובר/);
  });

  it('binds each secret to its name', () => {
    const box = new SecretBox(ctx.config.secretsKey);
    const sealed = box.seal('integration:gemini:apiKey', 'test-value');
    expect(box.open('integration:gemini:apiKey', sealed)).toBe('test-value');
    expect(() => box.open('integration:anthropic:apiKey', sealed)).toThrow();
    expect(() => new SecretBox(Buffer.alloc(32, 1)).open('integration:gemini:apiKey', sealed)).toThrow();
  });

  it('makes images with Gemini once its key is entered', async () => {
    const hub = createAiHub({ ...ctx.config, ai: { ...ctx.config.ai, image: 'auto' } }, new SettingsStore(ctx.db, ctx.config));
    expect((await hub.image()).provider).toBe('placeholder');

    expect((await admin.put('/integrations/gemini', { values: { imageSize: '8K' } })).status).toBe(422);
    const res = await admin.put('/integrations/gemini', { values: { apiKey: `AIza${'y'.repeat(35)}`, imageSize: '1K' } });
    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(true);
    const image = await createAiHub({ ...ctx.config, ai: { ...ctx.config.ai, image: 'auto' } }, new SettingsStore(ctx.db, ctx.config)).image();
    expect(image.provider).toBe('gemini');
    expect(image.model).toBe('gemini-nano-banana-2.1');
    expect((await admin.put('/integrations/gemini', { values: { apiKey: null, imageSize: null } })).body.connected).toBe(false);
  });

  it('keeps social tokens write-only too', async () => {
    const [account] = await ctx.db.insert(socialAccounts).values({ platform: 'telegram', displayName: 'ערוץ', externalId: '@chan', secretRef: 'TG', linkInFirstComment: false }).returning();
    const res = await admin.put(`/social-accounts/${account!.id}/token`, { token: '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ' });
    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('ABCDEFGHIJ');
    expect((await editor.put(`/social-accounts/${account!.id}/token`, { token: '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ' })).status).toBe(403);
  });
});

describe('site details', () => {
  it('serves links, contact and info pages to the site, hiding empty links', async () => {
    const before = await ctx.app.inject({ method: 'GET', url: '/api/v1/public/site' });
    expect(JSON.parse(before.body).links).toEqual({});
    const about = await ctx.app.inject({ method: 'GET', url: '/api/v1/public/pages/about' });
    expect(JSON.parse(about.body).bodyHtml).toContain('<h2>');
    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/public/pages/nope' })).statusCode).toBe(400);

    const site = (await admin.get('/site')).body;
    site.links.telegram = 'https://t.me/b4news';
    site.contact.email = 'news@example.co.il';
    site.pages.about.body = 'פסקה ראשונה.\n\n<script>alert(1)</script>';
    expect((await admin.put('/site', site)).status).toBe(200);

    const after = JSON.parse((await ctx.app.inject({ method: 'GET', url: '/api/v1/public/site' })).body);
    expect(after.links).toEqual({ telegram: 'https://t.me/b4news' });
    expect(after.contact.email).toBe('news@example.co.il');
    const page = JSON.parse((await ctx.app.inject({ method: 'GET', url: '/api/v1/public/pages/about' })).body);
    expect(page.bodyHtml).not.toContain('<script>');
    expect(page.bodyHtml).toContain('&lt;script&gt;');
  });

  it('accepts only https links and admin changes', async () => {
    const site = (await admin.get('/site')).body;
    expect((await admin.put('/site', { ...site, links: { ...site.links, facebook: 'javascript:alert(1)' } })).status).toBe(400);
    expect((await editor.put('/site', site)).status).toBe(403);
  });
});
