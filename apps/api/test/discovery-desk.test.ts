// The discovery desk: articles about the same story grouped for free (with "separate"), the chief
// editor's picks after every run, saving from any run, and a group written as ONE article.
import { createHash } from 'node:crypto';
import { aiJobs, articleDrafts, categories, eq, scrapeRunItems, scrapeRuns, scrapedItems } from '@b4/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { groupByTopic } from '../src/lib/similarity';
import { type Story, getPickSettings, queuePicks, settlePicks } from '../src/services/scraper/picks';
import { setup, signInStaff, staffClient } from './helpers';

type Item = { id: string; title: string; category: string | null; storyId: string | null; separated: boolean; status: string; pick: { score: number; reason: string } | null };

let ctx: Awaited<ReturnType<typeof setup>>;
let editor: ReturnType<typeof staffClient>;
let admin: ReturnType<typeof staffClient>;

beforeAll(async () => {
  ctx = await setup();
  editor = staffClient(ctx, await signInStaff(ctx, 'editor'));
  admin = staffClient(ctx, await signInStaff(ctx, 'admin'));
});
afterAll(() => ctx.close());

describe('grouping and the owner rules for picks (no database)', () => {
  it('groups headlines about the same story, and never an article the editor set apart', () => {
    const rows = [
      { t: 'בנק ישראל הותיר את הריבית ללא שינוי ברמה של 4.5%', at: 3, alone: false },
      { t: 'הריבית ללא שינוי: בנק ישראל הותיר את הריבית על 4.5%', at: 2, alone: false },
      { t: 'בנק ישראל הותיר את הריבית ללא שינוי, והנגיד מזהיר', at: 1, alone: true },
      { t: 'רשת הסופרמרקטים תפתח עשרה סניפים חדשים בצפון', at: 0, alone: false },
    ];
    const groups = groupByTopic(rows, { title: (r) => r.t, at: (r) => r.at, alone: (r) => r.alone });
    expect(groups.map((g) => g.length)).toEqual([2, 1, 1]);
  });

  it('never groups a one-word headline by its word with and without a prefix letter', () => {
    // "משפט" was counted as two shared words ("משפט" and "שפט"), and a site's section page joined a story.
    const rows = [
      { t: 'המתקפה ששינתה את כלכלת גרמניה: נפתח משפט "נורד סטרים" בהמבורג', at: 1 },
      { t: 'משפט', at: 0 },
    ];
    expect(groupByTopic(rows, { title: (r) => r.t, at: (r) => r.at }).map((g) => g.length)).toEqual([1, 1]);
  });

  it('keeps every section, keeps leisure small and the count, whatever the model answered', () => {
    const story = (leadId: string, category: string | null, sites = 1): Story => ({ leadId, category, sites, at: 0, items: [] });
    const stories = [story('a', 'israeli-economy', 3), story('b', 'israeli-economy', 2), story('c', 'capital-market'), story('d', 'entertainment'), story('e', 'entertainment'), story('f', 'tourism'), story('g', null)];
    const picks = settlePicks(
      [
        { leadId: 'a', score: 140, reason: ' החלטת ריבית ' },
        { leadId: 'a', score: 50, reason: 'שוב' },
        { leadId: 'invented', score: 99, reason: 'לא קיים' },
        { leadId: 'd', score: 90, reason: 'בידור' },
        { leadId: 'e', score: 85, reason: 'עוד בידור' },
        { leadId: 'b', score: 60, reason: 'עוד ריבית' },
      ],
      stories,
      { count: 4, leisure: ['entertainment', 'tourism'] },
    );
    // Capital market and tourism had no pick: each gets its story; a second leisure story and the
    // weakest pick of a section with two make way for them.
    expect(picks.map((p) => p.itemId)).toEqual(['a', 'd', 'c', 'f']);
    expect(picks[0]).toEqual({ itemId: 'a', score: 100, reason: 'החלטת ריבית' });
    expect(picks.find((p) => p.itemId === 'c')?.reason).toBe('הסיפור הבולט במדור');
  });
});

describe('the chief editor picks after every run', () => {
  let firstRun: string;

  it('recommends stories after a run that found articles, at least one from every section', async () => {
    await ctx.seedSources();
    firstRun = (await editor.post('/discovery/runs')).body.runId;
    await ctx.drain();
    const detail = (await editor.get(`/discovery/runs/${firstRun}`)).body as { picks: { status: string; count: number }; items: Item[] };
    expect(detail.picks.status).toBe('ready');
    // A story stands in its lead's section, as the board shows it.
    const sections = new Set(detail.items.filter((i) => i.storyId === null || i.storyId === i.id).map((i) => i.category).filter(Boolean));
    expect(detail.picks.count).toBeGreaterThan(0);
    expect(detail.picks.count).toBeLessThanOrEqual(Math.max(20, sections.size));
    const picked = new Set(detail.items.filter((i) => i.pick).map((i) => i.category));
    for (const s of sections) expect(picked.has(s)).toBe(true);
    const [job] = await ctx.db.select().from(aiJobs).where(eq(aiJobs.type, 'discovery_pick'));
    expect(job).toMatchObject({ status: 'succeeded', promptKey: 'discovery.pick' });
  });

  it('saves articles from an older run, not only from the latest', async () => {
    const second = (await editor.post('/discovery/runs')).body.runId;
    await ctx.drain();
    const latest = (await editor.get(`/discovery/runs/${second}`)).body;
    // Nothing new, so nothing to recommend.
    expect(latest.picks.status).toBe('none');
    const old = (await editor.get(`/discovery/runs/${firstRun}`)).body;
    expect(old.isLatest).toBe(false);
    const saved = await editor.post('/discovery/save', { itemIds: [old.items[0].id], mode: 'single' });
    expect(saved.status).toBe(201);
    expect(saved.body.draftIds).toHaveLength(1);
  });

  it('lets only an admin change how many it recommends and which sections are leisure', async () => {
    expect((await editor.put('/agent/pick-settings', { on: true, count: 10, leisure: [] })).status).toBe(403);
    const saved = await admin.put('/agent/pick-settings', { on: false, count: 12, leisure: ['entertainment'] });
    expect(saved.status).toBe(200);
    expect((await editor.get('/agent/pick-settings')).body).toEqual({ on: false, count: 12, leisure: ['entertainment'] });
    // Off: no picks after a run; an editor can still ask for them.
    expect(await queuePicks(ctx.app.services, firstRun, null)).toBe(false);
    expect((await getPickSettings(ctx.db)).count).toBe(12);
    await admin.put('/agent/pick-settings', { on: true, count: 20, leisure: ['entertainment', 'tourism', 'automotive', 'health'] });
  });
});

describe('the same story from several sites', () => {
  const STORY = [
    ['https://www.globes.co.il/news/r1', 'בנק ישראל הותיר את הריבית ללא שינוי ברמה של 4.5%', 'israeli-economy', 3],
    ['https://www.calcalist.co.il/news/r2', 'הריבית ללא שינוי: בנק ישראל הותיר את הריבית על 4.5%', 'israeli-economy', 1],
    ['https://www.themarker.com/news/r3', 'בנק ישראל הותיר את הריבית ללא שינוי, והנגיד מזהיר', 'capital-market', 2],
    ['https://www.ynet.co.il/economy/d1', 'מחירי הדירות עלו ב-0.8% בחודש האחרון', 'real-estate', 1],
    ['https://www.bizportal.co.il/d2', 'מחירי הדירות עלו שוב: עלייה של 0.8% בחודש', 'real-estate', 1],
    ['https://www.maariv.co.il/s1', 'רשת הסופרמרקטים תפתח עשרה סניפים חדשים בצפון', 'consumerism', 1],
  ] as const;
  let runId: string;
  const ids: string[] = [];
  const items = async () => (await editor.get(`/discovery/runs/${runId}`)).body.items as Item[];

  beforeAll(async () => {
    const slugs = new Map((await ctx.db.select({ id: categories.id, slug: categories.slug }).from(categories)).map((c) => [c.slug, c.id]));
    const [run] = await ctx.db.insert(scrapeRuns).values({ trigger: 'manual', region: 'local', status: 'succeeded', itemsNew: STORY.length, finishedAt: new Date() }).returning({ id: scrapeRuns.id });
    runId = run!.id;
    for (const [i, [url, title, slug, paragraphs]] of STORY.entries()) {
      const host = new URL(url).hostname;
      const bodyText = Array.from({ length: paragraphs }, (_, n) => `${title}. פרט מספר ${n + 1} שדווח באתר ${host}, עם עוד כמה מילים כדי שהפסקה תהיה ארוכה מספיק.`).join('\n\n');
      const [row] = await ctx.db
        .insert(scrapedItems)
        .values({ url, urlHash: createHash('sha256').update(url).digest('hex'), title, bodyText, categoryId: slugs.get(slug), publishedAt: new Date(Date.now() - (i + 1) * 60_000), firstRunId: runId })
        .returning({ id: scrapedItems.id });
      ids.push(row!.id);
      await ctx.db.insert(scrapeRunItems).values({ runId, itemId: row!.id });
    }
  });

  it('groups them for free, the fullest report first', async () => {
    const list = await items();
    const story = (id: string) => list.find((i) => i.id === id)!.storyId;
    expect(story(ids[0]!)).toBe(ids[0]);
    expect(story(ids[1]!)).toBe(ids[0]);
    expect(story(ids[2]!)).toBe(ids[0]);
    expect(story(ids[3]!)).toBe(story(ids[4]!));
    expect(story(ids[3]!)).not.toBeNull();
    expect(story(ids[5]!)).toBeNull();
    // A group's reports come together, its lead first.
    const at = list.findIndex((i) => i.id === ids[0]);
    expect(list.slice(at, at + 3).map((i) => i.storyId)).toEqual([ids[0], ids[0], ids[0]]);
  });

  it('separates an article from its group, and puts it back', async () => {
    const apart = await editor.post(`/discovery/runs/${runId}/items/${ids[1]}/separate`, { separated: true });
    expect(apart.status).toBe(200);
    const after = apart.body.items as Item[];
    expect(after.find((i) => i.id === ids[1])).toMatchObject({ storyId: null, separated: true });
    expect(after.filter((i) => i.storyId === ids[0])).toHaveLength(2);
    const back = (await editor.post(`/discovery/runs/${runId}/items/${ids[1]}/separate`, { separated: false })).body.items as Item[];
    expect(back.filter((i) => i.storyId === ids[0])).toHaveLength(3);
    expect((await editor.post(`/discovery/runs/${runId}/items/00000000-0000-4000-8000-000000000000/separate`, { separated: true })).status).toBe(404);
    const viewer = staffClient(ctx, await signInStaff(ctx, 'viewer'));
    expect((await viewer.post(`/discovery/runs/${runId}/items/${ids[1]}/separate`, { separated: true })).status).toBe(403);
  });

  it('asks the chief editor for picks on request, once at a time', async () => {
    const asked = await editor.post(`/discovery/runs/${runId}/picks`);
    expect(asked.status).toBe(202);
    expect(asked.body.picks.status).toBe('pending');
    expect((await editor.post(`/discovery/runs/${runId}/picks`)).body.picks.status).toBe('pending');
    await ctx.drain();
    const detail = (await editor.get(`/discovery/runs/${runId}`)).body;
    expect(detail.picks).toMatchObject({ status: 'ready', count: 3 });
    const lead = (detail.items as Item[]).find((i) => i.id === ids[0])!;
    expect(lead.pick?.reason).toContain('3 אתרים');
  });

  it('writes a chosen group as ONE article from all its reports', async () => {
    const saved = await editor.post('/discovery/save', { itemIds: [ids[0], ids[1], ids[2], ids[5]], stories: [[ids[0], ids[1], ids[2]]], mode: 'magazine' });
    expect(saved.status).toBe(201);
    expect(saved.body.draftIds).toHaveLength(2);
    await ctx.drain();

    const [combinedId, singleId] = saved.body.draftIds as string[];
    const combined = (await editor.get(`/drafts/${combinedId}`)).body;
    expect(combined.status).toBe('editing');
    expect(combined.original.sourceName).toBe('globes.co.il');
    expect(combined.extraSources.map((x: { sourceName: string }) => x.sourceName)).toEqual(['calcalist.co.il', 'themarker.com']);
    expect(combined.nav).toMatchObject({ index: 0, total: 2 });
    const [row] = await ctx.db.select({ text: articleDrafts.bodyText }).from(articleDrafts).where(eq(articleDrafts.id, combinedId!));
    expect(row!.text).toContain('על הדיווח כתבו גם: calcalist.co.il, themarker.com');
    // Each paragraph once, though three sites reported the story.
    const first = 'פרט מספר 1 שדווח באתר www.globes.co.il';
    expect(row!.text.split(first).length - 1).toBe(1);

    const jobs = await ctx.db.select({ draftId: aiJobs.draftId, promptKey: aiJobs.promptKey }).from(aiJobs).where(eq(aiJobs.type, 'rewrite'));
    expect(jobs.find((j) => j.draftId === combinedId)?.promptKey).toBe('rewrite.combine');
    expect(jobs.find((j) => j.draftId === singleId)?.promptKey).toBe('rewrite.system');
    expect((await editor.get(`/drafts/${singleId}`)).body.extraSources).toEqual([]);

    // Every report of the group is taken now.
    const taken = (await items()).filter((i) => [ids[0], ids[1], ids[2]].includes(i.id));
    expect(taken.every((i) => i.status === 'in_draft')).toBe(true);
  });

  it('writes a group with one report left as a single article', async () => {
    // ids[3] and ids[4] are one story; ids[4] alone is chosen with a "story" that has an article already taken.
    const saved = await editor.post('/discovery/save', { itemIds: [ids[4]], stories: [[ids[4], ids[0]]], mode: 'single' });
    expect(saved.status).toBe(201);
    const [draft] = await ctx.db.select({ extra: articleDrafts.extraItemIds }).from(articleDrafts).where(eq(articleDrafts.id, saved.body.draftIds[0]));
    expect(draft!.extra).toEqual([]);
  });
});
