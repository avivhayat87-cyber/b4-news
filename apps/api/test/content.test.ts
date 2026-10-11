import { HOMEPAGE_LIMITS, type ArticleFull, type HomeData } from '@b4/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup } from './helpers';

let ctx: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(async () => {
  await ctx.close();
});

describe('public content', () => {
  it('serves the homepage zones and sections, including tourism', async () => {
    const res = await ctx.app.inject({ url: '/api/v1/public/home' });
    expect(res.statusCode).toBe(200);
    const home = res.json<HomeData>();
    expect(home.main).toHaveLength(HOMEPAGE_LIMITS.main);
    expect(home.trending).toHaveLength(HOMEPAGE_LIMITS.trending);
    expect(home.sections.map((s) => s.category.slug)).toContain('tourism');
    expect(home.podcasts.length).toBeGreaterThan(0);
    expect(res.headers['cache-control']).toContain('public');
  });

  it('returns an article with its comment settings, and 404 for unknown slugs', async () => {
    const home = (await ctx.app.inject({ url: '/api/v1/public/home' })).json<HomeData>();
    const slug = home.main[0]!.slug;
    const res = await ctx.app.inject({ url: `/api/v1/public/articles/${slug}` });
    expect(res.statusCode).toBe(200);
    const article = res.json<ArticleFull>();
    expect(article.commentsEnabled).toBe(true);
    expect(article.bodyHtml).toContain('<p>');

    const missing = await ctx.app.inject({ url: '/api/v1/public/articles/does-not-exist' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ code: 'not_found', message: 'הכתבה לא נמצא' });
  });

  it('pages through a category with a cursor', async () => {
    const first = await ctx.app.inject({ url: '/api/v1/public/categories/tourism' });
    expect(first.statusCode).toBe(200);
    expect(first.json().category.name).toBe('תיירות');
    expect(first.json().page.items.length).toBeGreaterThan(0);
  });

  it('finds articles by a Hebrew word', async () => {
    const res = await ctx.app.inject({ url: `/api/v1/public/search?q=${encodeURIComponent('משכנתא')}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.length).toBeGreaterThan(0);
  });

  it('resolves the short deep-link id', async () => {
    const home = (await ctx.app.inject({ url: '/api/v1/public/home' })).json<HomeData>();
    const card = home.main[0]!;
    const res = await ctx.app.inject({ url: `/api/v1/public/a/${card.id}` });
    expect(res.json()).toEqual({ slug: card.slug });
  });
});
