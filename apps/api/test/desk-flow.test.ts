// The editing desk (2026-10-15): the chief editor places each batch on the site (the main story,
// hot ones, the ticker, a section where there is none; untouched is approved), the breaking-news
// ticker runs what was marked for it, a magazine goes out with what is ready while the rest waits in
// "נתקעו בפרסום", and the visual agent brings a real photo of a public figure, with its credit, only
// from a source whose license allows it. No call leaves the process.
import { aiJobs, articles, eq, isNotNull } from '@b4/db';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixedAi } from '../src/services/ai';
import { FakeText, PlaceholderImages } from '../src/services/ai/fake';
import type { DeskPlanRequest } from '../src/services/ai/types';
import type { Fetcher } from '../src/services/scraper/collect';
import { setup, signInStaff, staffClient } from './helpers';

let ctx: Awaited<ReturnType<typeof setup>>;
let editor: ReturnType<typeof staffClient>;
let magazineId: string;
let draftIds: string[];

type Summary = { id: string; placement: string; ticker: boolean; missing: { key: string }[]; status: string };
const magazine = async () => (await editor.get(`/magazines/${magazineId}`)).body as { status: string; drafts: Summary[] };

/** A model that wants every article as the main story: the code keeps one. */
class EveryoneMain extends FakeText {
  override async deskPlan(req: DeskPlanRequest) {
    return {
      data: { items: req.articles.map((a, i) => ({ id: a.id, placement: 'main' as const, ticker: i === 0, section: null, rank: req.articles.length - i, reason: 'הכי חשובה' })) },
      usage: { model: 'fake', inputTokens: 0, outputTokens: 0, latencyMs: 0 },
    };
  }
}

beforeAll(async () => {
  ctx = await setup();
  editor = staffClient(ctx, await signInStaff(ctx, 'editor'));
  await ctx.seedSources();
  const run = await editor.post('/discovery/runs');
  await ctx.drain();
  const items = (await editor.get(`/discovery/runs/${run.body.runId}`)).body.items as { id: string }[];
  const saved = await editor.post('/discovery/save', { itemIds: items.slice(0, 3).map((i) => i.id), mode: 'magazine', title: 'מגזין הדסק' });
  magazineId = saved.body.magazineId;
  draftIds = saved.body.draftIds;
  await ctx.drain();
});
afterAll(() => ctx.close());

describe('the chief editor places the batch', () => {
  it('places a magazine once the AI has written it all, with a reason for each', async () => {
    const { drafts } = await magazine();
    expect(drafts.filter((d) => d.placement === 'main')).toHaveLength(1);
    for (const id of draftIds) {
      const d = (await editor.get(`/drafts/${id}`)).body;
      expect(d.deskPlan).toMatchObject({ placement: d.placement, ticker: d.ticker, changed: [] });
      expect(d.deskPlan.reason).toMatch(/[א-ת]/);
    }
    const jobs = await ctx.db.select({ promptKey: aiJobs.promptKey }).from(aiJobs).where(eq(aiJobs.type, 'desk_plan'));
    expect(jobs).toEqual([{ promptKey: 'desk.plan' }]); // one call for the whole batch
  });

  it('keeps one main story whatever the model says, and never changes what an editor chose', async () => {
    const mine = draftIds[1]!;
    expect((await editor.patch(`/drafts/${mine}`, { placement: 'none' })).status).toBe(204);
    ctx.app.services.ai = fixedAi(new EveryoneMain(), new PlaceholderImages());
    expect((await editor.post(`/magazines/${magazineId}/desk-plan`)).status).toBe(202);
    await ctx.drain();
    ctx.app.services.ai = fixedAi(new FakeText(), new PlaceholderImages());

    const byId = new Map((await magazine()).drafts.map((d) => [d.id, d]));
    // The best ranked of the untouched ones is the main story (the model ranked the last one first); the other is hot.
    expect(byId.get(draftIds[2]!)).toMatchObject({ placement: 'main' });
    expect(byId.get(draftIds[0]!)).toMatchObject({ placement: 'trending', ticker: true });
    // The editor's own choice stayed, and the plan shows it was changed.
    expect(byId.get(mine)).toMatchObject({ placement: 'none' });
    expect((await editor.get(`/drafts/${mine}`)).body.deskPlan.changed).toEqual(['placement']);
  });
});

describe('the breaking-news ticker', () => {
  it('runs the latest articles until any is marked, then only the marked ones, newest first', async () => {
    const home = async () => (await ctx.app.inject({ method: 'GET', url: '/api/v1/public/home' })).json() as { breaking: { id: number }[]; latest: { id: number }[] };
    const before = await home();
    expect(before.breaking.map((a) => a.id)).toEqual(before.latest.map((a) => a.id));

    const [older, newer] = before.latest.slice(-2);
    const admin = staffClient(ctx, await signInStaff(ctx, 'admin'));
    expect((await admin.post(`/articles/${older!.id}/ticker`, { on: true })).status).toBe(204);
    expect((await editor.post(`/articles/${newer!.id}/ticker`, { on: true })).status).toBe(204);
    expect((await home()).breaking.map((a) => a.id)).toEqual([newer!.id, older!.id]);
    const listed = (await editor.get('/articles')).body.items as { id: number; onTicker: boolean }[];
    expect(listed.find((a) => a.id === newer!.id)?.onTicker).toBe(true);

    expect((await editor.post(`/articles/${newer!.id}/ticker`, { on: false })).status).toBe(204);
    expect((await home()).breaking.map((a) => a.id)).toEqual([older!.id]);
  });

  it('shows at most 12: a new one pushes the oldest off', async () => {
    const all = await ctx.db.select({ id: articles.id }).from(articles).where(eq(articles.status, 'published'));
    const base = Date.now() - 3_600_000;
    for (const [i, a] of all.entries()) await ctx.db.update(articles).set({ tickerAt: new Date(base + i * 1000) }).where(eq(articles.id, a.id));
    const marked = await ctx.db.select({ id: articles.id }).from(articles).where(isNotNull(articles.tickerAt));
    const breaking = ((await ctx.app.inject({ method: 'GET', url: '/api/v1/public/home' })).json() as { breaking: { id: number }[] }).breaking;
    expect(breaking).toHaveLength(Math.min(12, marked.length));
    expect(breaking[0]!.id).toBe(all.at(-1)!.id);
  });
});

describe('publishing what is ready', () => {
  it('publishes the ready articles and holds back the rest in "נתקעו בפרסום"', async () => {
    const [first, second, third] = draftIds as [string, string, string];
    const before = await magazine();
    expect(before.drafts.every((d) => d.missing.some((m) => m.key === 'text'))).toBe(true);
    // The first is approved; its main image is the agent's pick, still a quick draft.
    expect((await editor.post(`/drafts/${first}/finalize`)).status).toBe(204);
    await ctx.drain();
    expect((await editor.get(`/drafts/${first}`)).body.missing).toEqual([]);

    const started = await editor.post(`/magazines/${magazineId}/publish`, { idempotencyKey: 'desk-flow-1' });
    expect(started.status).toBe(202);
    await ctx.drain();
    const job = (await editor.get(`/publish-jobs/${started.body.publishJobId}`)).body;
    expect(job).toMatchObject({ status: 'succeeded' });
    expect(job.steps[`${first}:image`]).toBe('ok');
    expect(job.steps[`${first}:site`]).toBe('ok');
    expect(job.steps[`${second}:site`]).toMatch(/^held: הטקסט עוד לא אושר/);
    expect(job.error).toContain('נתקעו');
    expect((await magazine()).status).toBe('published');

    const saved = (await editor.get('/saved')).body;
    expect(saved.stuck.map((d: { id: string }) => d.id).sort()).toEqual([second, third].sort());
    expect(saved.stuck[0].missing.map((m: { key: string }) => m.key)).toContain('text');
  });

  it('publishes a held-back article on its own once it is fixed, and it leaves the list', async () => {
    const second = draftIds[1]!;
    expect((await editor.post(`/drafts/${second}/finalize`)).status).toBe(204);
    await ctx.drain();
    const started = await editor.post(`/drafts/${second}/publish`, { idempotencyKey: 'desk-flow-2' });
    expect(started.status).toBe(202);
    await ctx.drain();
    expect((await editor.get(`/drafts/${second}`)).body).toMatchObject({ status: 'published', stuckAt: null });
    expect((await editor.get('/saved')).body.stuck.map((d: { id: string }) => d.id)).toEqual([draftIds[2]]);
  });

  it('refuses a single article that is not ready, and says what is missing', async () => {
    const res = await editor.post(`/drafts/${draftIds[2]}/publish`, { idempotencyKey: 'desk-flow-3' });
    expect(res.status).toBe(422);
    expect(res.body.message).toContain('הטקסט עוד לא אושר');
  });
});

describe('a real photo of a public figure', () => {
  const commons = (pages: unknown[]) => ({ query: { pages: Object.fromEntries(pages.map((p, i) => [String(i + 1), { index: i + 1, ...(p as object) }])) } });
  const page = (title: string, license: string, machine: string, size: [number, number] = [2000, 1500], about = 'Amir Yaron, Governor of the Bank of Israel') => ({
    title,
    imageinfo: [
      {
        thumburl: `https://upload.wikimedia.org/thumb/${encodeURIComponent(title)}.jpg`,
        url: `https://upload.wikimedia.org/${encodeURIComponent(title)}.jpg`,
        descriptionurl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title)}`,
        width: size[0],
        height: size[1],
        mime: 'image/jpeg',
        extmetadata: {
          LicenseShortName: { value: license },
          License: { value: machine },
          Artist: { value: '<a href="https://commons.wikimedia.org/wiki/User:Kobi">Kobi Gideon</a>' },
          ImageDescription: { value: about },
        },
      },
    ],
  });

  it('brings one from a free license, with its credit, and the agent may pick it', async () => {
    const photo = await sharp({ create: { width: 1200, height: 900, channels: 3, background: '#556677' } }).jpeg().toBuffer();
    const asked: string[] = [];
    const original = ctx.app.services.fetch;
    const fetchStub: Fetcher = async (url, opts) => {
      if (url.startsWith('https://commons.wikimedia.org/w/api.php')) {
        asked.push(url);
        const body = commons([
          page('File:Amir Yaron NC.jpg', 'CC BY-NC 2.0', 'cc-by-nc-2.0'),
          page('File:Amir Yaron small.jpg', 'CC BY-SA 4.0', 'cc-by-sa-4.0', [300, 200]),
          page('File:Bank of Israel building.jpg', 'CC BY-SA 4.0', 'cc-by-sa-4.0', [2000, 1500], 'The Bank of Israel building in Jerusalem'),
          page('File:Amir Yaron 2019.jpg', 'CC BY-SA 4.0', 'cc-by-sa-4.0'),
        ]);
        return { url, status: 200, contentType: 'application/json', body: Buffer.from(JSON.stringify(body)) };
      }
      if (url.startsWith('https://upload.wikimedia.org/')) {
        asked.push(url);
        return { url, status: 200, contentType: 'image/jpeg', body: photo };
      }
      return original(url, opts);
    };
    ctx.app.services.fetch = fetchStub;
    try {
      const write = await editor.post('/manual/write', {
        title: 'אמיר ירון: הריבית תישאר ללא שינוי',
        body: 'נגיד בנק ישראל, אמיר ירון, אמר היום כי הריבית צפויה להישאר ללא שינוי בחודשים הקרובים, בשל האינפלציה. '.repeat(3),
        category: 'israeli-economy',
      });
      const id = write.body.draftId as string;
      expect((await editor.post(`/drafts/${id}/images`, {})).status).toBe(202);
      await ctx.drain();

      // The non-commercial license, the small file and the photo of a building were passed over.
      expect(asked.filter((u) => u.startsWith('https://upload.wikimedia.org/'))).toEqual([expect.stringContaining('Amir%20Yaron%202019')]);
      const [batch] = (await editor.get(`/drafts/${id}/images`)).body.batches;
      expect(batch.variants.map((v: { kind: string }) => v.kind)).toEqual(['drawn', 'drawn', 'photo']);
      const real = batch.variants[2];
      expect(real).toMatchObject({ prompt: 'אמיר ירון', credit: 'צילום: Kobi Gideon / ויקישיתוף (CC BY-SA 4.0)', license: 'CC BY-SA 4.0' });
      expect(real.sourceUrl).toContain('commons.wikimedia.org/wiki/');
      // The stand-in agent prefers the real photo: it is the main image, already full size (nothing to draw at the approval).
      expect(batch.pick.mediaId).toBe(real.mediaId);
      const draft = (await editor.get(`/drafts/${id}`)).body;
      expect(draft.hero).toMatchObject({ id: real.mediaId, credit: real.credit, isAiGenerated: false });
      expect((await editor.get(`/drafts/${id}/images`)).body.heroIsDraft).toBe(false);
    } finally {
      ctx.app.services.fetch = original;
    }
  });
});
