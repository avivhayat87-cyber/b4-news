// The social networks against stand-ins for Meta and Telegram: "test connection" is
// green only when the account can really publish, with a page token that never
// expires; the personal token an editor pastes is turned into that page token; and
// publishing uploads our own files rather than handing the network a link it can't
// reach (a local media address). Instagram images, which go by link only, say so plainly.
import { auditLog, eq } from '@b4/db';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { testSocialAccount } from '../src/services/connection-tests';
import type { Services } from '../src/services/context';
import { SettingsStore } from '../src/services/settings';
import { LOCAL_MEDIA_ERROR, type SocialPayload, publiclyReachable, publishToNetwork } from '../src/services/social-adapters';
import { setup, signInStaff, staffClient } from './helpers';

const PAGE = '1424305327424928';
const IG = '17841449972058596';
const APP_ID = '1665664261787346';
const APP_SECRET = 'a1b2c3d4'.repeat(4);
const GRAPH = 'https://graph.facebook.com/v26.0';

/** Services with just what the tests need: a token, the Meta app, and where the media and the site are served from. */
function services(mediaBaseUrl = 'https://media.b4news.co.il', publicSiteUrl = 'https://b4news.co.il', app: Record<string, string> = { appId: APP_ID, appSecret: APP_SECRET }): Services {
  return {
    settings: { socialToken: async () => 'EAA-token', integration: async () => ({ ...app, source: 'cms' }) },
    config: { metaGraphVersion: 'v26.0', mediaBaseUrl, publicSiteUrl },
  } as unknown as Services;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** What debug_token says about the page's own token that never expires. */
const FOREVER = { is_valid: true, type: 'PAGE', app_id: APP_ID, expires_at: 0, data_access_expires_at: 0 };
const inAnHour = () => Math.floor(Date.now() / 1000) + 3600;

/** Meta's answers by path: me (who the token belongs to), debug_token (when it expires) and the account itself. */
function meta(me: { status?: number; body: unknown }, account: unknown = { username: 'b4news' }, debug: { status?: number; body: unknown } = { body: { data: FOREVER } }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = new URL(url).pathname;
      if (path.endsWith('/me')) return json(me.body, me.status);
      if (path.endsWith('/debug_token')) return json(debug.body, debug.status);
      return json(account);
    }),
  );
}

const facebook = { id: 'a', platform: 'facebook', externalId: PAGE, secretRef: 'FB' };
const instagram = { id: 'b', platform: 'instagram', externalId: IG, secretRef: 'IG' };

afterEach(() => vi.unstubAllGlobals());

describe('connection test for Facebook and Instagram', () => {
  it('is green with the page’s own token, which never expires', async () => {
    meta({ body: { id: PAGE, name: 'B4 - חדשות' } });
    expect(await testSocialAccount(services(), facebook)).toEqual({ ok: true, message: 'מחובר לעמוד "B4 - חדשות". הטוקן קבוע ולא יפוג.' });
    meta({ body: { id: PAGE, name: 'B4 - חדשות', instagram_business_account: { id: IG } } });
    expect(await testSocialAccount(services(), instagram)).toMatchObject({ ok: true, message: expect.stringContaining('@b4news') });
  });

  it('refuses a page token that expires, like the one the Explorer’s page picker makes, and says what to paste', async () => {
    meta({ body: { id: PAGE, name: 'B4 - חדשות' } }, undefined, { body: { data: { ...FOREVER, expires_at: inAnHour() } } });
    const hour = await testSocialAccount(services(), facebook);
    expect(hour.ok).toBe(false);
    expect(hour.message).toContain('טוקן זמני');
    expect(hour.message).toContain('User Token');

    // Meta stopped its access to the data: the same, though the token itself never expires.
    meta({ body: { id: PAGE, name: 'B4 - חדשות', instagram_business_account: { id: IG } } }, undefined, { body: { data: { ...FOREVER, data_access_expires_at: 1_700_000_000 } } });
    const stopped = await testSocialAccount(services(), instagram);
    expect(stopped.ok).toBe(false);
    expect(stopped.message).toContain('לאשר אותה מחדש');
  });

  it('asks for the app’s secret when Meta won’t say when a page token expires without it', async () => {
    meta({ body: { id: PAGE, name: 'B4 - חדשות' } }, undefined, { status: 400, body: { error: { code: 100, message: 'You must provide an app access token, or a user access token that is an owner or developer of the app' } } });
    const result = await testSocialAccount(services(undefined, undefined, {}), facebook);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('סוד האפליקציה');
  });

  it('refuses a personal token, which reads the page but cannot publish as it', async () => {
    meta({ body: { id: '28674838832170416', name: 'אביב חייט' } });
    const fb = await testSocialAccount(services(), facebook);
    expect(fb.ok).toBe(false);
    expect(fb.message).toContain('טוקן אישי');
    meta({ status: 400, body: { error: { code: 100, message: 'Tried accessing nonexisting field (instagram_business_account) on node type (User)' } } });
    expect((await testSocialAccount(services(), instagram)).message).toContain('טוקן אישי');
  });

  it('says when the token expired', async () => {
    meta({ status: 400, body: { error: { code: 190, message: 'Error validating access token: Session has expired' } } });
    expect((await testSocialAccount(services(), instagram)).message).toContain('פג תוקף');
  });

  it('names the Instagram ID linked to the page when another one was entered', async () => {
    meta({ body: { id: PAGE, name: 'B4 - חדשות', instagram_business_account: { id: IG } } });
    const wrong = await testSocialAccount(services(), { ...instagram, externalId: '142430532742928' });
    expect(wrong.ok).toBe(false);
    expect(wrong.message).toContain(IG);
  });

  it('notes, while connected, what a local computer can’t do: Instagram images and the article link', async () => {
    meta({ body: { id: PAGE, name: 'B4 - חדשות' } });
    const fb = await testSocialAccount(services('http://localhost:4000/media', 'http://localhost:3000'), facebook);
    expect(fb.ok).toBe(true);
    expect(fb.message).toContain('http://localhost:3000');
    expect(fb.message).not.toContain('אינסטגרם מקבל תמונות'); // Facebook gets the file itself
    meta({ body: { id: PAGE, name: 'B4 - חדשות', instagram_business_account: { id: IG } } });
    expect((await testSocialAccount(services('http://localhost:4000/media'), instagram)).message).toContain('אינסטגרם מקבל תמונות');
  });
});

// --- Saving a token ----------------------------------------------------------------------
/**
 * Meta for saving: what debug_token says about each token, the long-lived token a personal one
 * is exchanged for (only with the app's id and secret), and the pages each personal token reaches.
 */
function metaTokens(known: Record<string, Record<string, unknown>>, pages: Record<string, unknown[]>) {
  const calls: URL[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = new URL(url);
      calls.push(u);
      const q = u.searchParams;
      if (u.pathname === '/v23.0/debug_token') return json({ data: known[q.get('input_token')!] ?? { is_valid: false, error: { code: 190, message: 'Invalid OAuth access token' } } });
      if (u.pathname === '/v23.0/oauth/access_token') {
        if (q.get('grant_type') !== 'fb_exchange_token' || q.get('client_id') !== APP_ID || q.get('client_secret') !== APP_SECRET) return json({ error: { code: 101, message: 'Error validating application' } }, 400);
        return json({ access_token: `${q.get('fb_exchange_token')}-long`, token_type: 'bearer', expires_in: 5_184_000 });
      }
      if (u.pathname === '/v23.0/me/accounts') return json({ data: pages[q.get('access_token')!] ?? [] });
      return json({ error: { message: `unexpected ${u.pathname}` } }, 400);
    }),
  );
  return calls;
}

describe('saving a Facebook or Instagram token', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  let admin: ReturnType<typeof staffClient>;
  let fbId: string;
  let igId: string;
  const PERSONAL = 'EAA-personal-from-explorer';
  const known = {
    [PERSONAL]: { is_valid: true, type: 'USER', app_id: APP_ID, expires_at: inAnHour(), data_access_expires_at: inAnHour() + 90 * 86_400 },
    'EAA-page-from-the-picker': { is_valid: true, type: 'PAGE', app_id: APP_ID, expires_at: inAnHour() },
    'EAA-page-forever': FOREVER,
  };
  const ourPage = { id: PAGE, name: 'B4 - חדשות', instagram_business_account: { id: IG } };
  const pages = {
    // With the long-lived token, the page's token never expires; with the Explorer's own, it would die within the hour.
    [`${PERSONAL}-long`]: [{ ...ourPage, access_token: 'EAA-page-forever' }, { id: '555', name: 'עמוד אחר', access_token: 'EAA-other-page' }],
    [PERSONAL]: [{ ...ourPage, access_token: 'EAA-page-for-an-hour' }],
  };
  const stored = (id: string) => new SettingsStore(ctx.db, ctx.config).socialToken({ id, secretRef: 'NONE' });

  beforeAll(async () => {
    ctx = await setup();
    admin = staffClient(ctx, await signInStaff(ctx, 'admin'));
    fbId = (await admin.post('/social-accounts', { platform: 'facebook', displayName: 'פייסבוק', externalId: PAGE, secretRef: 'FB_T' })).body.id;
    igId = (await admin.post('/social-accounts', { platform: 'instagram', displayName: 'אינסטגרם', externalId: IG, secretRef: 'IG_T' })).body.id;
    expect((await admin.put('/integrations/meta', { values: { appSecret: APP_SECRET } })).body.connected).toBe(true);
  });
  afterAll(() => ctx.close());

  it('turns the pasted personal token into the page’s own, which never expires, for Facebook and Instagram', async () => {
    const calls = metaTokens(known, pages);
    const res = await admin.put(`/social-accounts/${fbId}/token`, { token: PERSONAL });
    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(true);
    expect(await stored(fbId)).toBe('EAA-page-forever');
    // Asked with the app's own key, and nothing went anywhere but Meta's Graph API.
    expect(calls.find((c) => c.pathname.endsWith('/debug_token'))!.searchParams.get('access_token')).toBe(`${APP_ID}|${APP_SECRET}`);
    expect(calls.every((c) => c.origin === 'https://graph.facebook.com')).toBe(true);

    // Instagram: the same personal token, and the page it is linked to.
    expect((await admin.put(`/social-accounts/${igId}/token`, { token: PERSONAL })).status).toBe(200);
    expect(await stored(igId)).toBe('EAA-page-forever');

    // No token in the answers or the audit log.
    const audit = await ctx.db.select().from(auditLog).where(eq(auditLog.entityId, fbId));
    expect(audit.filter((a) => a.action === 'set_token').map((a) => a.details)).toEqual([{ madeFrom: 'personal_token' }]);
    expect(JSON.stringify([res.body, audit, (await admin.get('/social-accounts')).body])).not.toContain('EAA');
  });

  it('keeps a page token that never expires as it is', async () => {
    const calls = metaTokens(known, pages);
    expect((await admin.put(`/social-accounts/${fbId}/token`, { token: 'EAA-page-forever' })).status).toBe(200);
    expect(await stored(fbId)).toBe('EAA-page-forever');
    expect(calls.map((c) => c.pathname)).toEqual(['/v23.0/debug_token']);
  });

  it('refuses what would stop working, says what to do, and keeps the token it had', async () => {
    metaTokens(known, pages);
    // The Explorer's page picker: a page token for an hour.
    const picker = await admin.put(`/social-accounts/${fbId}/token`, { token: 'EAA-page-from-the-picker' });
    expect(picker.status).toBe(422);
    expect(picker.body.message).toContain('טוקן זמני');
    expect(picker.body.message).toContain('User Token');
    expect(picker.body.message).not.toContain('EAA');

    // A token Meta doesn't know (expired or revoked).
    expect((await admin.put(`/social-accounts/${fbId}/token`, { token: 'EAA-expired-long-ago' })).body.message).toContain('פג תוקף');
    expect(await stored(fbId)).toBe('EAA-page-forever');
  });

  it('names the pages the personal token reaches when the account’s page isn’t one of them', async () => {
    metaTokens(known, { [`${PERSONAL}-long`]: [{ id: '555', name: 'עמוד אחר', access_token: 'EAA-other-page', instagram_business_account: { id: '17841400000000777' } }] });
    const fb = await admin.put(`/social-accounts/${fbId}/token`, { token: PERSONAL });
    expect(fb.status).toBe(422);
    expect(fb.body.message).toContain('"עמוד אחר" (555)');
    const ig = await admin.put(`/social-accounts/${igId}/token`, { token: PERSONAL });
    expect(ig.status).toBe(422);
    expect(ig.body.message).toContain('17841400000000777');
    expect(await stored(igId)).toBe('EAA-page-forever');
  });

  it('asks for the app’s secret before it can make a short-lived personal token permanent', async () => {
    expect((await admin.put('/integrations/meta', { values: { appSecret: null } })).body.connected).toBe(false);
    const calls = metaTokens(known, pages);
    const res = await admin.put(`/social-accounts/${fbId}/token`, { token: PERSONAL });
    expect(res.status).toBe(422);
    expect(res.body.message).toContain('סוד האפליקציה');
    // Without the app, the token was asked about itself, and never used to read a page token that dies within the hour.
    expect(calls.map((c) => c.pathname)).toEqual(['/v23.0/debug_token']);
    expect(await stored(fbId)).toBe('EAA-page-forever');
  });
});

// --- Publishing ------------------------------------------------------------------------
type Call = { url: string; init: RequestInit };

/** A stand-in for our media server, Telegram and Meta; records every request. */
function network() {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      const u = new URL(url);
      if (u.hostname === 'localhost') {
        const video = u.pathname.endsWith('.mp4');
        return new Response(new Uint8Array(video ? 5000 : 1200).fill(7), { headers: { 'content-type': video ? 'video/mp4' : 'image/jpeg' } });
      }
      if (u.hostname === 'api.telegram.org') return json({ ok: true, result: { message_id: 7 } });
      if (u.hostname === 'rupload.facebook.com') return json({ success: true });
      const path = u.pathname;
      if (path.endsWith('/photos')) return json({ id: 'photo1', post_id: `${PAGE}_post1` });
      if (path.endsWith('/comments')) return json({ id: 'comment1' });
      if (path.endsWith('/photo_stories')) return json({ post_id: 'story1' });
      if (path.endsWith('/video_reels')) return json(init.body instanceof URLSearchParams && init.body.get('upload_phase') === 'start' ? { video_id: 'v1', upload_url: 'https://rupload.facebook.com/video-upload/v26.0/v1' } : { success: true });
      if (path.endsWith('/v1')) return json({ status: { video_status: 'ready' } });
      if (path.endsWith(`/${IG}/media`)) return json({ id: 'container1' });
      if (path.endsWith('/container1')) return json({ status_code: 'FINISHED' });
      if (path.endsWith('/media_publish')) return json({ id: 'media1' });
      return json({ error: { message: `unexpected ${url}` } }, 400);
    }),
  );
  return calls;
}

const local: SocialPayload = {
  headline: 'כותרת',
  caption: 'משפט.',
  articleUrl: 'http://localhost:3000/a/1',
  storyImageUrl: 'http://localhost:4000/media/2026/10/x/story-1.jpg',
  squareImageUrl: 'http://localhost:4000/media/2026/10/x/feed-1.jpg',
  videoUrl: 'http://localhost:4000/media/2026/10/x/reel-1.mp4',
  linkInFirstComment: true,
};
const config = services().config;
const fbAccount = { platform: 'facebook' as const, externalId: PAGE, secretRef: 'FB' };
const igAccount = { platform: 'instagram' as const, externalId: IG, secretRef: 'IG' };

/** The file a multipart request carried in a field, and that no field holds a link to our media. */
async function fileIn(call: Call, field: string) {
  const body = call.init.body as FormData;
  expect(body).toBeInstanceOf(FormData);
  for (const [, value] of body.entries()) if (typeof value === 'string') expect(value).not.toContain('localhost:4000');
  const file = body.get(field) as File;
  return { size: file.size, type: file.type };
}

describe('publishing while the media is on a local address', () => {
  it('uploads the post image to Telegram as a file', async () => {
    const calls = network();
    const result = await publishToNetwork(config, { platform: 'telegram', externalId: '@B4newsB4', secretRef: 'TG' }, '1:abc', { ...local, linkInFirstComment: false });
    expect(result).toEqual({ status: 'posted', postId: '7', commentId: null });
    const send = calls.find((c) => c.url.includes('/sendPhoto'))!;
    expect(await fileIn(send, 'photo')).toEqual({ size: 1200, type: 'image/jpeg' });
    expect((send.init.body as FormData).get('chat_id')).toBe('@B4newsB4');
    expect((send.init.body as FormData).get('caption')).toContain('http://localhost:3000/a/1'); // the link is in the text
  });

  it('uploads the Facebook post and story as files, with the link in the first comment', async () => {
    const calls = network();
    expect(await publishToNetwork(config, fbAccount, 'EAA-page', local)).toEqual({ status: 'posted', postId: `${PAGE}_post1`, commentId: 'comment1' });
    const photo = calls.find((c) => c.url === `${GRAPH}/${PAGE}/photos`)!;
    expect(await fileIn(photo, 'source')).toEqual({ size: 1200, type: 'image/jpeg' });
    expect((calls.find((c) => c.url.endsWith('/comments'))!.init.body as URLSearchParams).get('message')).toBe('http://localhost:3000/a/1');

    const story = network();
    expect((await publishToNetwork(config, fbAccount, 'EAA-page', local, 'story')).status).toBe('posted');
    const unpublished = story.find((c) => c.url === `${GRAPH}/${PAGE}/photos`)!;
    expect(await fileIn(unpublished, 'source')).toMatchObject({ size: 1200 });
    expect((unpublished.init.body as FormData).get('published')).toBe('false');
  });

  it('uploads reels to Facebook and Instagram as files (resumable upload)', async () => {
    const fb = network();
    expect((await publishToNetwork(config, fbAccount, 'EAA-page', local, 'reel')).status).toBe('posted');
    const upload = fb.find((c) => c.url.startsWith('https://rupload.facebook.com/video-upload/'))!;
    expect(upload.init.headers).toMatchObject({ Authorization: 'OAuth EAA-page', offset: '0', file_size: '5000' });
    expect((upload.init.body as Uint8Array).length).toBe(5000);
    expect(fb.some((c) => JSON.stringify(c.init.headers ?? {}).includes('file_url'))).toBe(false);

    const ig = network();
    const cover = 'https://media.b4news.co.il/2026/10/reel-poster-abc.jpg';
    expect(await publishToNetwork(config, igAccount, 'EAA-page', { ...local, coverUrl: cover }, 'reel')).toEqual({ status: 'posted', postId: 'media1', commentId: 'comment1' });
    const container = ig.find((c) => c.url === `${GRAPH}/${IG}/media`)!.init.body as URLSearchParams;
    expect(container.get('upload_type')).toBe('resumable');
    expect(container.get('video_url')).toBeNull();
    // The branded cover goes with the reel; Instagram's API has no music from its library.
    expect(container.get('cover_url')).toBe(cover);
    expect(container.get('audio_configuration')).toBeNull();
    const igUpload = ig.find((c) => c.url === 'https://rupload.facebook.com/ig-api-upload/v26.0/container1')!;
    expect(igUpload.init.headers).toMatchObject({ offset: '0', file_size: '5000' });
  });

  it('explains that Instagram images need a public address, before calling Instagram', async () => {
    const calls = network();
    await expect(publishToNetwork(config, igAccount, 'EAA-page', local)).rejects.toThrow(LOCAL_MEDIA_ERROR);
    await expect(publishToNetwork(config, igAccount, 'EAA-page', local, 'story')).rejects.toThrow(LOCAL_MEDIA_ERROR);
    expect(calls).toHaveLength(0);
  });

  it('gives Instagram the image link once the media is on a public address', async () => {
    const calls = network();
    const online = { ...local, squareImageUrl: 'https://media.b4news.co.il/2026/10/x/feed-1.jpg' };
    expect((await publishToNetwork(config, igAccount, 'EAA-page', online)).status).toBe('posted');
    expect((calls.find((c) => c.url === `${GRAPH}/${IG}/media`)!.init.body as URLSearchParams).get('image_url')).toBe(online.squareImageUrl);
  });

  it('sends nothing without a token: the post is prepared for manual posting', async () => {
    const calls = network();
    expect((await publishToNetwork(config, fbAccount, undefined, local)).status).toBe('prepared');
    expect(calls).toHaveLength(0);
  });

  it('tells local and private addresses from public ones', () => {
    expect(publiclyReachable('http://localhost:4000/media/x.jpg')).toBe(false);
    expect(publiclyReachable('http://127.0.0.1/x.jpg')).toBe(false);
    expect(publiclyReachable('http://192.168.1.20/x.jpg')).toBe(false);
    expect(publiclyReachable('https://media.b4news.co.il/x.jpg')).toBe(true);
  });
});
