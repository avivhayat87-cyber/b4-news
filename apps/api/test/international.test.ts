// International sites: listed and scanned apart from the Israeli ones, foreign
// headlines translated after the run, the whole original translated for the editor.
import { eq, scrapedItems, sources } from '@b4/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detectLanguage } from '../src/services/translate';
import { setup, signInStaff, staffClient } from './helpers';

let ctx: Awaited<ReturnType<typeof setup>>;
let editor: ReturnType<typeof staffClient>;

beforeAll(async () => {
  ctx = await setup();
  await ctx.seedSources(); // three Israeli sample sites + one English one
  editor = staffClient(ctx, await signInStaff(ctx, 'editor'));
});
afterAll(() => ctx.close());

describe('international sites', () => {
  it('detects the language by the script', () => {
    expect(detectLanguage('בנק ישראל הותיר את הריבית')).toBeNull();
    expect(detectLanguage('Fed holds rates steady', 'en')).toBe('en');
    expect(detectLanguage('Le marché recule', 'fr')).toBe('fr');
    expect(detectLanguage('Рынок растёт')).toBe('ru');
  });

  it('keeps the regions apart: an Israeli run never scans a site from abroad', async () => {
    const local = await editor.post('/discovery/runs', {});
    expect(local.status).toBe(202);
    await ctx.drain();
    const run = (await editor.get('/discovery/runs/latest?region=local')).body;
    expect(run.run.region).toBe('local');
    expect(run.run.sources.map((x: { name: string }) => x.name)).not.toContain('Global Markets Daily (sample)');
    expect(run.items.every((i: { language: string | null }) => i.language === null)).toBe(true);
    expect((await editor.get('/discovery/runs/latest?region=international')).body).toBeNull();
  });

  it('runs the international sites separately and translates the headlines', async () => {
    const started = await editor.post('/discovery/runs', { region: 'international' });
    expect(started.status).toBe(202);
    await ctx.drain(); // the run, then the headline translation
    const run = (await editor.get('/discovery/runs/latest?region=international')).body;
    expect(run.run.region).toBe('international');
    expect(run.isLatest).toBe(true);
    expect(run.run.sources.map((x: { name: string }) => x.name)).toEqual(['Global Markets Daily (sample)']);
    expect(run.items.length).toBeGreaterThan(5);
    for (const item of run.items) {
      expect(item.language).toBe('en');
      expect(item.titleHe).toMatch(/^\(תרגום לדוגמה\) /);
    }
    // The Israeli latest run is still the Israeli one.
    expect((await editor.get('/discovery/runs/latest?region=local')).body.run.region).toBe('local');
    const runs = (await editor.get('/discovery/runs?region=international')).body;
    expect(runs).toHaveLength(1);
  });

  it('translates the whole original for the editor, and the AI writes the new article in Hebrew', async () => {
    const run = (await editor.get('/discovery/runs/latest?region=international')).body;
    const item = run.items[0];
    const saved = await editor.post('/discovery/save', { itemIds: [item.id], mode: 'single', colorLabel: 'blue' });
    expect(saved.status).toBe(201);
    await ctx.drain();
    const draft = (await editor.get(`/drafts/${saved.body.draftIds[0]}`)).body;
    expect(draft.original.language).toBe('en');
    expect(draft.original.translation.title).toMatch(/^\(תרגום לדוגמה\) /);
    expect(draft.original.translation.bodyText).toContain('(תרגום לדוגמה)');
    expect(draft.status).toBe('editing');
    const [row] = await ctx.db.select({ bodyHe: scrapedItems.bodyHe }).from(scrapedItems).where(eq(scrapedItems.id, item.id));
    expect(row!.bodyHe).toBeTruthy();
  });

  it('adds sites from abroad to their own list', async () => {
    const res = await editor.post('/sources/bulk', { urls: ['https://www.example.com/business'], region: 'international' });
    expect(res.status).toBe(201);
    const [row] = await ctx.db.select({ region: sources.region }).from(sources).where(eq(sources.id, res.body.created[0].id));
    expect(row!.region).toBe('international');
    const list = (await editor.get('/sources')).body as { region: string; baseUrl: string }[];
    expect(list.find((x) => x.baseUrl === 'https://www.example.com/business')!.region).toBe('international');
  });
});
