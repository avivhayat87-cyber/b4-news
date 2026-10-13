// The CMS's published articles ("כתבות באתר"): change one in place, take it off the site
// and put it back, and delete it for good (admins, removed articles only).
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGIN, setup, signInStaff, staffClient } from './helpers';

let ctx: Awaited<ReturnType<typeof setup>>;
let editorCookie: string;
let editor: ReturnType<typeof staffClient>;
let admin: ReturnType<typeof staffClient>;

beforeAll(async () => {
  ctx = await setup();
  editorCookie = await signInStaff(ctx, 'editor');
  editor = staffClient(ctx, editorCookie);
  admin = staffClient(ctx, await signInStaff(ctx, 'admin'));
});
afterAll(() => ctx.close());

const site = async (slug: string) => ctx.app.inject({ method: 'GET', url: `/api/v1/public/articles/${encodeURIComponent(slug)}` });

async function uploadHero(): Promise<string> {
  const png = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#3366aa' } }).png().toBuffer();
  const boundary = '----b4articles';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="alt"\r\n\r\nתמונה\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`),
    png,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/admin/media',
    headers: { cookie: editorCookie, origin: ORIGIN, 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: body,
  });
  return JSON.parse(res.body).id;
}

describe('articles on the site', () => {
  it('lists what is on the site, with search and a section filter', async () => {
    const all = await editor.get('/articles');
    expect(all.status).toBe(200);
    expect(all.body.items.length).toBeGreaterThan(5);
    const first = all.body.items[0];
    const found = await editor.get(`/articles?q=${encodeURIComponent(first.title.slice(0, 10))}`);
    expect(found.body.items.map((i: { id: number }) => i.id)).toContain(first.id);
    const section = await editor.get(`/articles?category=${first.category}`);
    expect(section.body.items.every((i: { category: string }) => i.category === first.category)).toBe(true);
  });

  it('changes an article in place: the same address, the new text only after the update', async () => {
    const [a] = (await editor.get('/articles')).body.items;
    const count = (await editor.get('/articles')).body.items.length;
    const opened = await editor.post(`/articles/${a.id}/edit`);
    expect(opened.status).toBe(200);
    const draftId = opened.body.draftId;
    const draft = (await editor.get(`/drafts/${draftId}`)).body;
    expect(draft.status).toBe('editing');
    expect(draft.publishedArticle.id).toBe(a.id);

    const bodyDoc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'גוף הכתבה אחרי התיקון של העורך. '.repeat(8) }] }] };
    expect((await editor.put(`/drafts/${draftId}/content`, { version: draft.version, title: 'כותרת מתוקנת לכתבה', subtitle: 'משנה מתוקנת', bodyDoc })).status).toBe(200);
    // Still the old text on the site, and an update without a main image is refused.
    expect(JSON.parse((await site(a.slug)).body).title).toBe(a.title);
    if (!draft.hero) {
      expect((await editor.post(`/drafts/${draftId}/update-article`)).status).toBe(422);
      await editor.patch(`/drafts/${draftId}`, { heroMediaId: await uploadHero() });
    }

    const updated = await editor.post(`/drafts/${draftId}/update-article`);
    expect(updated.status).toBe(200);
    expect(updated.body.slug).toBe(a.slug);
    const live = JSON.parse((await site(a.slug)).body);
    expect(live.id).toBe(a.id);
    expect(live.title).toBe('כותרת מתוקנת לכתבה');
    expect(live.bodyHtml).toContain('אחרי התיקון');
    expect((await editor.get('/articles')).body.items.length).toBe(count); // no second copy
    expect((await editor.get(`/drafts/${draftId}`)).body.status).toBe('published');
    // Editing it again reopens the same draft.
    expect((await editor.post(`/articles/${a.id}/edit`)).body.draftId).toBe(draftId);
  });

  it('takes an article off the site and the home page, and puts it back', async () => {
    const items = (await editor.get('/articles')).body.items;
    const a = items.find((i: { onHomepage: string | null }) => i.onHomepage) ?? items[1];
    expect((await editor.post(`/articles/${a.id}/unpublish`)).status).toBe(204);
    expect((await site(a.slug)).statusCode).toBe(404);
    const home = JSON.parse((await ctx.app.inject({ method: 'GET', url: '/api/v1/public/home' })).body);
    expect([...home.main, ...home.trending].map((x: { id: number }) => x.id)).not.toContain(a.id);
    expect((await editor.get('/articles?status=unpublished')).body.items.map((i: { id: number }) => i.id)).toContain(a.id);

    expect((await editor.post(`/articles/${a.id}/republish`)).status).toBe(204);
    expect((await site(a.slug)).statusCode).toBe(200);
  });

  it('deletes for good only an article already off the site, and only for an admin', async () => {
    const a = (await editor.get('/articles')).body.items.at(-1);
    expect((await editor.del(`/articles/${a.id}`)).status).toBe(403);
    expect((await admin.del(`/articles/${a.id}`)).status).toBe(409);
    await admin.post(`/articles/${a.id}/unpublish`);
    expect((await admin.del(`/articles/${a.id}`)).status).toBe(204);
    expect((await site(a.slug)).statusCode).toBe(404);
    expect((await admin.get('/articles?status=unpublished')).body.items.map((i: { id: number }) => i.id)).not.toContain(a.id);
  });
});
