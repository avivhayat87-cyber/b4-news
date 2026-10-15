import { AdSlot } from '@/components/ad-slot';
import { Hero } from '@/components/hero';
import { CapitalGrid, CategoryBlock, ColumnsSection, CompactCategory, PodcastBand, TourismFeature } from '@/components/sections';
import { Sidebar } from '@/components/sidebar';
import { MarketTicker } from '@/components/tradingview';
import { TrendingCarousel } from '@/components/trending-carousel';
import { wrap } from '@/components/ui';
import { getHome, getMarkets } from '@/lib/api';
import type { HomeSection } from '@/lib/types';

// Fallback refresh; publishing revalidates the "home" tag immediately.
export const revalidate = 300;

export default async function HomePage() {
  const [home, markets] = await Promise.all([getHome(), getMarkets()]);
  const bySlug = new Map(home.sections.map((s) => [s.category.slug, s]));
  const pick = (...slugs: string[]) =>
    slugs.map((slug) => bySlug.get(slug)).filter((s): s is HomeSection => Boolean(s && s.items.length));

  const economy = pick('israeli-economy', 'global-economy');
  const [capital] = pick('capital-market');
  const trio = pick('real-estate', 'insurance', 'hi-tech');
  const [tourism] = pick('tourism');
  const quad = pick('health', 'automotive', 'entertainment', 'consumerism');

  return (
    <>
      <section aria-label="מדדים מובילים" className="border-b border-line">
        <MarketTicker />
      </section>
      <Hero articles={home.main} breaking={home.breaking.length ? home.breaking : home.latest} />
      <TrendingCarousel articles={home.trending} />
      <AdSlot slot="home_top" fallback="billboard" className={`${wrap} pt-10`} />

      <div className={`${wrap} flex flex-wrap gap-10 pb-3 pt-11`}>
        <div className="grid min-w-0 flex-[999_1_620px] grid-cols-[repeat(auto-fit,minmax(min(290px,100%),1fr))] gap-10">
          {economy.map((section) => (
            <CategoryBlock key={section.category.slug} section={section} withByline />
          ))}
        </div>
        <Sidebar quotes={markets} marketOverview />
      </div>

      {capital ? <CapitalGrid section={capital} /> : null}
      <PodcastBand podcasts={home.podcasts} />

      {trio.length > 0 ? (
        <div className={`${wrap} grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-10 pb-3 pt-12`}>
          {trio.map((section) => (
            <CategoryBlock key={section.category.slug} section={section} />
          ))}
        </div>
      ) : null}

      {tourism ? <TourismFeature section={tourism} /> : null}

      <ColumnsSection consultants={bySlug.get('the-consultants')} ceo={bySlug.get('the-new-ceo')} />

      {quad.length > 0 ? (
        <div className={`${wrap} grid grid-cols-[repeat(auto-fit,minmax(min(240px,100%),1fr))] gap-8 pb-6 pt-12`}>
          {quad.map((section) => (
            <CompactCategory key={section.category.slug} section={section} />
          ))}
        </div>
      ) : null}
    </>
  );
}
