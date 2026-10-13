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

  it('reaches the editor without one: the AI only suggests, the editor decides', async () => {
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
    expect(draft.category).toBeNull();
    expect((await editor.post(`/drafts/${draft.id}/finalize`)).body.message).toContain('קטגוריה');
    // The editor picks the section, and the text can be finished.
    expect((await editor.patch(`/drafts/${draft.id}`, { category: 'israeli-economy' })).status).toBe(204);
    expect((await editor.post(`/drafts/${draft.id}/finalize`)).status).toBe(204);
  });
});
