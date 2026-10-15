// Discovery's sections: keyword guesses for economic news, and "פוליטיקה ושונות" for the
// rest, whose section the editor picks by hand.
import { scrapedItems, sources } from '@b4/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { classifyHeadline, outsideEconomy } from '../src/services/classify';
import { setup, signInStaff, staffClient } from './helpers';

describe('sections in discovery', () => {
  it('keeps general-news sections out of the economic guess', () => {
    expect(outsideEconomy('https://www.maariv.co.il/news/politics/article-1376479')).toBe(true);
    expect(outsideEconomy('https://www.israelhayom.co.il/sport/world-soccer/article/21610529')).toBe(true);
    expect(outsideEconomy('https://www.kan.org.il/content/kan-news/politic/1108684/')).toBe(true);
    expect(outsideEconomy('https://www.maariv.co.il/economy/israel/article-1376460')).toBe(false);
    expect(outsideEconomy('not a url')).toBe(false);
    // The headline alone would have been filed under economics.
    expect(classifyHeadline('טראמפ תוקף את התקציב בנאום בקונגרס')).not.toBeNull();
  });
});

describe('an item without a section', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => {
    ctx = await setup();
  });
  afterAll(() => ctx.close());

  it('gets one from the chief editor (the rewrite only suggests), and the editor may change it', async () => {
    const editor = staffClient(ctx, await signInStaff(ctx, 'editor'));
    await ctx.seedSources();
    const [source] = await ctx.db.select({ id: sources.id }).from(sources).limit(1);
    const [item] = await ctx.db
      .insert(scrapedItems)
      .values({
        sourceId: source!.id,
        url: 'https://news.example.co.il/news/politics/article-1',
        urlHash: 'politics-test-item',
        title: 'הכנסת אישרה בקריאה ראשונה את חוק הגיוס',
        intro: 'הצבעה סוערת במליאה.',
        bodyText: 'הכנסת אישרה הלילה בקריאה ראשונה את חוק הגיוס, אחרי דיון ארוך וסוער במליאה. '.repeat(6),
        categoryId: null,
      })
      .returning({ id: scrapedItems.id });

    const saved = await editor.post('/discovery/save', { itemIds: [item!.id], mode: 'single' });
    expect(saved.status).toBe(201);
    await ctx.drain();
    const draft = (await editor.get(`/drafts/${saved.body.draftIds[0]}`)).body;
    expect(draft.status).toBe('editing');
    // The chief editor placed it, and chose the section it had none of (the stand-in takes the first).
    expect(draft.category).toBe('israeli-economy');
    expect(draft.deskPlan).toMatchObject({ category: 'israeli-economy', changed: [] });
    expect(draft.missing.map((m: { key: string }) => m.key)).not.toContain('category');
    // The editor changes it: their choice wins, and the plan says so.
    expect((await editor.patch(`/drafts/${draft.id}`, { category: 'global-economy' })).status).toBe(204);
    const changed = (await editor.get(`/drafts/${draft.id}`)).body;
    expect(changed).toMatchObject({ category: 'global-economy', deskPlan: { category: 'israeli-economy', changed: ['category'] } });
    expect((await editor.post(`/drafts/${draft.id}/finalize`)).status).toBe(204);
  });
});
