// Settings > connections and site details: write-only secrets, encrypted at
// rest, admin-only, applied without a restart.
import { articleDrafts, eq, secrets, socialAccounts, socialPackages, socialPosts, users } from '@b4/db';
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
    const connected = createAiHub({ ...ctx.config, ai: { ...ctx.config.ai, image: 'auto' } }, new SettingsStore(ctx.db, ctx.config));
    const image = await connected.image();
    expect(image.provider).toBe('gemini');
    expect(image.model).toBe('gemini-nano-banana-2.1');
    // The options to choose from come from a cheaper model.
    expect((await connected.image('draft')).model).toBe('gemini-3.1-flash-lite-image');
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

  it('takes the numeric Meta IDs, not @usernames, and lets an ID be corrected without losing the token', async () => {
    const byName = await admin.post('/social-accounts', { platform: 'instagram', displayName: 'אינסטגרם', externalId: '@B4newsB4', secretRef: 'IG_TEST' });
    expect(byName.status).toBe(400);
    expect(byName.body.message).toContain('IG User ID');
    expect((await admin.post('/social-accounts', { platform: 'telegram', displayName: 'ערוץ', externalId: 'b4news', secretRef: 'TG_TEST' })).status).toBe(400);

    // An account saved with a wrong ID before this check existed.
    const [ig] = await ctx.db.insert(socialAccounts).values({ platform: 'instagram', displayName: 'אינסטגרם', externalId: '@B4newsB4', secretRef: 'IG_OLD', linkInFirstComment: true }).returning();
    await admin.put(`/social-accounts/${ig!.id}/token`, { token: 'EAAG-test-page-token-0123456789' });
    expect((await admin.patch(`/social-accounts/${ig!.id}`, { externalId: 'B4newsB4' })).status).toBe(422);
    const fixed = await admin.patch(`/social-accounts/${ig!.id}`, { externalId: '17841400000000001' });
    expect(fixed.status).toBe(200);
    expect(fixed.body).toMatchObject({ externalId: '17841400000000001', connected: true, isActive: true });
    expect((await editor.patch(`/social-accounts/${ig!.id}`, { externalId: '17841400000000002' })).status).toBe(403);
  });

  it('allows one account per network, and deletes one for good: its token and its posts go too', async () => {
    const first = await admin.post('/social-accounts', { platform: 'whatsapp', displayName: 'ערוץ וואטסאפ', externalId: 'b4-channel', secretRef: 'WA_ONE' });
    expect(first.status).toBe(201);
    const second = await admin.post('/social-accounts', { platform: 'whatsapp', displayName: 'עוד ערוץ', externalId: 'other-channel', secretRef: 'WA_TWO' });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('network_taken');

    // The Instagram account from the test above, with its token and a post waiting in a draft.
    const ig = (await admin.get('/social-accounts')).body.find((a: { platform: string }) => a.platform === 'instagram');
    const [author] = await ctx.db.select({ id: users.id }).from(users).limit(1);
    const [draft] = await ctx.db.insert(articleDrafts).values({ origin: 'manual_write', status: 'text_final', title: 'כתבה', createdBy: author!.id }).returning({ id: articleDrafts.id });
    await ctx.db.insert(socialPackages).values({ draftId: draft!.id, headline: 'כותרת' });
    await ctx.db.insert(socialPosts).values({ draftId: draft!.id, socialAccountId: ig.id });

    expect((await editor.del(`/social-accounts/${ig.id}`)).status).toBe(403);
    expect((await admin.del(`/social-accounts/${ig.id}`)).status).toBe(204);
    expect((await admin.get('/social-accounts')).body.some((a: { id: string }) => a.id === ig.id)).toBe(false);
    expect(await ctx.db.select().from(socialPosts).where(eq(socialPosts.socialAccountId, ig.id))).toHaveLength(0);
    expect(await ctx.db.select().from(secrets).where(eq(secrets.key, `social:${ig.id}:token`))).toHaveLength(0);
    expect((await admin.del(`/social-accounts/${ig.id}`)).status).toBe(404);

    // The network is free again: add it anew.
    expect((await admin.post('/social-accounts', { platform: 'instagram', displayName: 'אינסטגרם', externalId: '17841400000000009', secretRef: 'IG_NEW' })).status).toBe(201);
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
