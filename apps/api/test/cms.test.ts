// The newsroom process end to end: site settings -> discovery -> magazine ->
// AI draft -> editing -> social -> preview -> publish -> learning loop.
import { articleSharePosts, articles, eq, homepageSlots, socialPosts, styleFeedback, styleProfiles } from '@b4/db';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGIN, setup, signInStaff, staffClient } from './helpers';

let ctx: Awaited<ReturnType<typeof setup>>;
let editor: ReturnType<typeof staffClient>;
let developer: ReturnType<typeof staffClient>;

beforeAll(async () => {
  ctx = await setup();
  editor = staffClient(ctx, await signInStaff(ctx, 'editor'));
  developer = staffClient(ctx, await signInStaff(ctx, 'developer'));
});
afterAll(() => ctx.close());

async function png(width: number, height: number, color = '#3366aa'): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();
}

async function upload(buffer: Buffer) {
  const boundary = '----b4test';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="alt"\r\n\r\nתמונה לבדיקה\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`),
    buffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const cookie = (await signInStaff(ctx, 'editor')).toString();
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/admin/media',
    headers: { cookie, origin: ORIGIN, 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: body,
  });
  return { status: res.statusCode, body: JSON.parse(res.body) };
}

describe('access control', () => {
  it('requires a staff session and blocks writes for viewers', async () => {
    const anon = await ctx.app.inject({ method: 'GET', url: '/api/v1/admin/dashboard' });
    expect(anon.statusCode).toBe(401);
    const viewer = staffClient(ctx, await signInStaff(ctx, 'viewer'));
    expect((await viewer.get('/dashboard')).status).toBe(200);
    expect((await viewer.post('/discovery/runs')).status).toBe(403);
  });

  it('refuses cookie writes from other origins', async () => {
    const cookie = await signInStaff(ctx, 'editor');
    const res = await ctx.app.inject({ method: 'POST', url: '/api/v1/admin/discovery/runs', headers: { cookie, origin: 'https://evil.example' } });
    expect(res.statusCode).toBe(403);
  });
});

describe('site settings: request, developer trigger, approval', () => {
  it('lets an editor request a site and only a developer activate it', async () => {
    const created = await editor.post('/sources', { name: 'אתר בדיקה', baseUrl: 'http://api.test/requested-site/' });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('pending_dev');
    expect(ctx.mailer.lastTo('developer@newsroom.test')?.subject).toContain('אתר בדיקה');

    const config = {
      method: 'rss',
      listUrls: ['http://api.test/dev/sites/calc/feed.xml'],
      selectorConfig: { article: { title: 'h1.headline', body: '.article-body', intro: '.subtitle' } },
      defaultCategory: null,
    };
    expect((await editor.put(`/sources/${created.body.id}/config`, config)).status).toBe(403);
    expect((await developer.put(`/sources/${created.body.id}/config`, config)).status).toBe(200);
    expect((await developer.post(`/sources/${created.body.id}/approve`)).status).toBe(409); // not tested yet

    const test = await developer.post(`/sources/${created.body.id}/test`, config);
    expect(test.status).toBe(200);
    expect(test.body.ok).toBe(true);
    expect(test.body.items.length).toBeGreaterThan(5);
    expect(test.body.article.bodyText.length).toBeGreaterThan(200);

    const approved = await developer.post(`/sources/${created.body.id}/approve`);
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('active');
    // Park it again so the discovery test below counts only the sample sources.
    expect((await developer.post(`/sources/${created.body.id}/status`, { status: 'archived' })).status).toBe(200);
  });
});

describe('the editorial process', () => {
  let runId: string;
  let magazineId: string;
  let draftId: string;

  it('discovers only new articles on each run (delta fetch)', async () => {
    await ctx.seedSources();
    const started = await editor.post('/discovery/runs');
    expect(started.status).toBe(202);
    runId = started.body.runId;
    await ctx.drain();

    const detail = await editor.get(`/discovery/runs/${runId}`);
    expect(detail.body.run.status).toBe('succeeded');
    expect(detail.body.run.itemsNew).toBe(36); // 3 sample sites x 12 listed articles
    expect(detail.body.items[0]).toMatchObject({ source: { name: expect.any(String) }, title: expect.any(String) });
    expect(detail.body.items.every((i: { category: string | null }) => i.category)).toBe(true);

    const again = await editor.post('/discovery/runs');
    await ctx.drain();
    const second = await editor.get(`/discovery/runs/${again.body.runId}`);
    expect(second.body.run.itemsNew).toBe(0);
    expect(second.body.isLatest).toBe(true);
  });

  it('pulls an article from an older run into the latest one', async () => {
    const old = await editor.get(`/discovery/runs/${runId}`);
    const item = old.body.items[0];
    const pulled = await editor.post(`/discovery/items/${item.id}/pull`);
    expect(pulled.status).toBe(200);
    const latest = await editor.get('/discovery/runs/latest');
    expect(latest.body.items.find((i: { id: string }) => i.id === item.id)?.origin).toBe('pulled');
  });

  it('saves a selection as a magazine and the AI writes the first drafts with 3 image drafts', async () => {
    const run = await editor.get(`/discovery/runs/${runId}`);
    const picked = run.body.items.slice(0, 3).map((i: { id: string }) => i.id);
    const saved = await editor.post('/discovery/save', { itemIds: picked, mode: 'magazine', title: 'מגזין בדיקה' });
    expect(saved.status).toBe(201);
    magazineId = saved.body.magazineId;
    draftId = saved.body.draftIds[0];

    // The same articles can't be saved twice.
    expect((await editor.post('/discovery/save', { itemIds: picked })).status).toBe(409);

    await ctx.drain();
    const draft = await editor.get(`/drafts/${draftId}`);
    expect(draft.body.status).toBe('editing');
    expect(draft.body.hasAiBaseline).toBe(true);
    expect(draft.body.original.bodyText.length).toBeGreaterThan(100);
    expect(draft.body.category).toBeTruthy();
    expect(draft.body.nav).toMatchObject({ index: 0, total: 3 });

    const images = await editor.get(`/drafts/${draftId}/images`);
    expect(images.body.batches[0].images).toHaveLength(3);

    const savedEdits = await editor.get('/saved');
    expect(savedEdits.body.magazines.find((m: { id: string }) => m.id === magazineId)?.counts.total).toBe(3);
  });

  it('autosaves with optimistic locking and rejects malformed documents', async () => {
    const draft = (await editor.get(`/drafts/${draftId}`)).body;
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'פסקה שהעורך כתב מחדש לגמרי, עם ניסוח אחר ומשפטים קצרים יותר מאשר בטיוטה של ה-AI.' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'פסקה נוספת שמוסיפה הקשר לקורא, כדי שהכתבה תהיה ארוכה מספיק לפרסום באתר.' }] },
        { type: 'codeBlock', content: [{ type: 'text', text: 'dropped' }] },
      ],
    };
    const ok = await editor.put(`/drafts/${draftId}/content`, { version: draft.version, title: 'כותרת שהעורך ניסח', subtitle: 'משנה', bodyDoc: doc });
    expect(ok.status).toBe(200);
    expect(ok.body.version).toBe(draft.version + 1);

    const stale = await editor.put(`/drafts/${draftId}/content`, { version: draft.version, title: 'x', subtitle: '', bodyDoc: doc });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('version_conflict');

    const bad = await editor.put(`/drafts/${draftId}/content`, { version: ok.body.version, title: 'x', subtitle: '', bodyDoc: '<p>hi</p>' });
    expect(bad.status).toBe(400);

    const after = (await editor.get(`/drafts/${draftId}`)).body;
    expect(JSON.stringify(after.bodyDoc)).not.toContain('codeBlock');
  });

  it('applies an editor comment through the AI and answers in the chat', async () => {
    const before = (await editor.get(`/drafts/${draftId}`)).body;
    const queued = await editor.post(`/drafts/${draftId}/refine`, { instruction: 'תקצר את הכתבה' });
    expect(queued.status).toBe(202);
    expect((await editor.post(`/drafts/${draftId}/refine`, { instruction: 'עוד בקשה' })).status).toBe(409);
    await ctx.drain();
    const after = (await editor.get(`/drafts/${draftId}`)).body;
    expect(after.version).toBe(before.version + 1);
    const chat = await editor.get(`/drafts/${draftId}/chat`);
    expect(chat.body.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant']);
  });

  it('opens the social module only after the text is final, and keeps the story image distinct', async () => {
    expect((await editor.get(`/drafts/${draftId}/social`)).status).toBe(409);
    // Put the text back to a publishable length (the refine above shortened it).
    const d = (await editor.get(`/drafts/${draftId}`)).body;
    const body = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'טקסט סופי של הכתבה. '.repeat(12) }] }] };
    await editor.put(`/drafts/${draftId}/content`, { version: d.version, title: 'כותרת סופית לכתבה', subtitle: 'משנה סופית', bodyDoc: body });
    expect((await editor.post(`/drafts/${draftId}/finalize`)).status).toBe(204);
    expect((await editor.put(`/drafts/${draftId}/content`, { version: d.version + 1, title: 'x', subtitle: '', bodyDoc: body })).body.code).toBe('text_locked');

    const generated = await editor.post(`/drafts/${draftId}/social/generate`, { what: 'both' });
    expect(generated.status).toBe(202);
    await ctx.drain();
    const pkg = (await editor.get(`/drafts/${draftId}/social`)).body;
    expect(pkg.caption.length).toBeGreaterThan(5);
    expect(pkg.batches[0].images.length).toBe(2);
    expect(pkg.posts.length).toBe(4); // the sample accounts

    const images = (await editor.get(`/drafts/${draftId}/images`)).body.batches[0].images;
    await editor.patch(`/drafts/${draftId}`, { heroMediaId: images[0].id, placement: 'main', tags: ['ריבית', 'בנק ישראל'], disclosure: 'לכותב אין החזקות בחברות הנזכרות.' });
    const same = await editor.put(`/drafts/${draftId}/social`, { version: pkg.version, headline: pkg.headline, caption: pkg.caption, imageMediaId: images[0].id });
    expect(same.status).toBe(422);
    // The chosen draft is redrawn at full quality and takes its place as the main image.
    await ctx.drain();
    const chosen = (await editor.get(`/drafts/${draftId}/images`)).body;
    expect(chosen).toMatchObject({ chosenId: images[0].id, upgrade: null });
    expect(chosen.heroId).not.toBe(images[0].id);
    const story = pkg.batches[0].images[0].id;
    const updated = await editor.put(`/drafts/${draftId}/social`, { version: pkg.version, headline: pkg.headline, caption: 'משפט ראשון. משפט שני. משפט שלישי.', imageMediaId: story });
    expect(updated.status).toBe(200);
    expect((await editor.post(`/drafts/${draftId}/social/approve`)).status).toBe(422); // three sentences
    await editor.put(`/drafts/${draftId}/social`, { version: updated.body.version, headline: pkg.headline, caption: 'משפט ראשון. משפט שני.' });
    expect((await editor.post(`/drafts/${draftId}/social/approve`)).status).toBe(204);
  });

  it('shows what is missing in the preview, then publishes the site first and social after', async () => {
    const mag = (await editor.get(`/magazines/${magazineId}`)).body;
    const [, second, third] = mag.drafts;
    await editor.post(`/drafts/${third.id}/skip`, { reason: 'לא רלוונטי' });

    const preview = (await editor.get(`/magazines/${magazineId}/preview`)).body;
    expect(preview.editorName).toBe('Test editor');
    expect(preview.items.find((i: { draft: { id: string } }) => i.draft.id === second.id).problems).toContain('הטקסט עוד לא סומן כסופי');
    expect(preview.items.every((i: { warnings: string[] }) => Array.isArray(i.warnings))).toBe(true);
    const similarity = (await editor.get(`/drafts/${second.id}/similarity`)).body;
    expect(['ok', 'warn', 'high']).toContain(similarity.level);
    expect((await editor.post(`/magazines/${magazineId}/publish`, { idempotencyKey: 'publish-test-1' })).status).toBe(422);

    // Finish the second article: final text + an uploaded hero image.
    const tooSmall = await upload(await png(200, 100));
    expect(tooSmall.status).toBe(422);
    const hero = await upload(await png(1200, 800));
    expect(hero.status).toBe(201);
    expect(ctx.storage.files.size).toBeGreaterThan(6);
    await editor.patch(`/drafts/${second.id}`, { heroMediaId: hero.body.id, placement: 'trending' });
    expect((await editor.post(`/drafts/${second.id}/finalize`)).status).toBe(204);

    const started = await editor.post(`/magazines/${magazineId}/publish`, { idempotencyKey: 'publish-test-2' });
    expect(started.status).toBe(202);
    const repeat = await editor.post(`/magazines/${magazineId}/publish`, { idempotencyKey: 'publish-test-2' });
    expect(repeat.body.publishJobId).toBe(started.body.publishJobId);
    await ctx.drain();

    const job = (await editor.get(`/publish-jobs/${started.body.publishJobId}`)).body;
    expect(job.status).toBe('succeeded');
    expect(job.steps[`${draftId}:site`]).toBe('ok');
    expect(job.steps[`${second.id}:site`]).toBe('ok');
    expect(job.steps[`${third.id}:site`]).toBeUndefined();

    const [article] = await ctx.db.select().from(articles).where(eq(articles.draftId, draftId));
    expect(article!.bodyHtml).toContain('<p>');
    expect(article!.editorId).toBeTruthy();
    const full = await ctx.app.inject({ method: 'GET', url: `/api/v1/public/articles/${article!.slug}` });
    expect(full.json().disclosure).toBe('לכותב אין החזקות בחברות הנזכרות.');
    const main = await ctx.db.select().from(homepageSlots).where(eq(homepageSlots.zone, 'main'));
    expect(main.find((m) => m.position === 1)?.articleId).toBe(article!.id);

    const home = await ctx.app.inject({ method: 'GET', url: '/api/v1/public/home' });
    expect(JSON.parse(home.body).main[0].title).toBe('כותרת סופית לכתבה');

    // Marking the text final wrote a distribution plan, and the plan is what went out (not the older
    // social package). No tokens in tests: posts are prepared for manual posting, not sent.
    expect(job.steps[`${draftId}:social`]).toMatch(/^plan: \d+ posts/);
    const planned = await ctx.db.select().from(articleSharePosts).where(eq(articleSharePosts.articleId, article!.id));
    expect(planned.length).toBeGreaterThan(0);
    expect(planned.every((p) => p.status === 'skipped' && p.lastError)).toBe(true);
    const packaged = await ctx.db.select().from(socialPosts).where(eq(socialPosts.draftId, draftId));
    expect(packaged.every((p) => p.status === 'draft')).toBe(true);

    expect((await editor.get(`/magazines/${magazineId}`)).body.status).toBe('published');
  });

  it('feeds the editors\' corrections back to the AI', async () => {
    const feedback = await ctx.db.select().from(styleFeedback);
    expect(feedback.length).toBeGreaterThanOrEqual(1);
    expect(Math.max(...feedback.map((f) => f.editRatio))).toBeGreaterThan(0.1);
    // The publish batch was learned from in one pass, with a report for the newsroom.
    const reports = (await editor.get('/agent/learning-reports')).body;
    // (an article the editor left almost untouched has nothing to teach and is excluded)
    expect(reports[0]).toMatchObject({ status: 'succeeded', articleCount: feedback.filter((f) => f.status !== 'excluded').length });
    expect(reports[0].summary).toContain('בקריאה אחת');
    const queued = await editor.post('/learning/distill');
    expect(queued.status).toBe(202);
    await ctx.drain();
    const [profile] = await ctx.db.select().from(styleProfiles).where(eq(styleProfiles.isActive, true));
    expect(profile?.rules).toContain('נלמד');
    const overview = (await editor.get('/learning')).body;
    expect(overview.distilled).toBeGreaterThanOrEqual(1);
  });
});

describe('manual entry', () => {
  it('creates a draft from the editor\'s own text', async () => {
    const res = await editor.post('/manual/write', {
      title: 'כתבה שנכתבה ידנית',
      body: 'פסקה ראשונה של הכתבה הידנית.\n\n## כותרת ביניים\n\nפסקה שנייה.',
      category: 'tourism',
      tags: ['תיירות'],
    });
    expect(res.status).toBe(201);
    const draft = (await editor.get(`/drafts/${res.body.draftId}`)).body;
    expect(draft).toMatchObject({ status: 'editing', origin: 'manual_write', category: 'tourism', colorLabel: 'green' });
    expect(draft.bodyDoc.content[1]).toMatchObject({ type: 'heading' });
  });

  it('refuses links to private addresses (SSRF)', async () => {
    const guarded = await setup({ fetch: (await import('../src/services/context')).createFetcher(ctx.config) });
    const client = staffClient(guarded, await signInStaff(guarded, 'editor'));
    for (const url of ['http://127.0.0.1:4000/health', 'http://169.254.169.254/latest/meta-data/', 'http://localhost/']) {
      const res = await client.post('/manual/url', { url });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('fetch_failed');
    }
    await guarded.close();
  });
});
