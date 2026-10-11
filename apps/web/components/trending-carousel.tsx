'use client';

import Link from 'next/link';
import { useRef } from 'react';
import type { ArticleCard } from '@/lib/types';
import { articleHref } from '@/lib/site';
import { ChevronLeft, ChevronRight } from './icons';
import { ArticleImage, RankBadge, SectionHeader, wrap } from './ui';

/** "חדשות חמות": up to 14 ranked articles in a horizontal, snap-scrolling row. */
export function TrendingCarousel({ articles }: { articles: ArticleCard[] }) {
  const track = useRef<HTMLDivElement>(null);
  if (articles.length === 0) return null;

  // The page is RTL: later items sit to the left, so "next" scrolls toward negative x.
  const scroll = (direction: 'next' | 'prev') => {
    const el = track.current;
    if (!el) return;
    const step = Math.max(el.clientWidth * 0.8, 270);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: direction === 'next' ? -step : step, behavior: reduce ? 'auto' : 'smooth' });
  };

  return (
    <section aria-labelledby="trending-title" className={`${wrap} pb-2 pt-10`}>
      <SectionHeader id="trending-title" title="חדשות חמות" subtitle="הכתבות שכולם קוראים עכשיו" className="mb-5">
        <button
          type="button"
          aria-label="הקודם"
          onClick={() => scroll('prev')}
          className="flex h-10 w-10 items-center justify-center rounded-full border-[1.5px] border-ink bg-white hover:bg-stone"
        >
          <ChevronRight size={18} />
        </button>
        <button
          type="button"
          aria-label="הבא"
          onClick={() => scroll('next')}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-ink text-white hover:bg-black"
        >
          <ChevronLeft size={18} />
        </button>
      </SectionHeader>

      <div ref={track} className="scrollbar-none flex snap-x snap-mandatory gap-5 overflow-x-auto pb-1.5">
        {articles.slice(0, 14).map((a, i) => (
          <Link key={a.id} href={articleHref(a)} className="group flex w-[250px] shrink-0 snap-start flex-col gap-2">
            <ArticleImage article={a} sizes="250px" className="rounded-[10px]">
              <RankBadge n={i + 1} className="absolute bottom-2.5 right-2.5 shadow-[0_0_0_3px_#fff]" />
            </ArticleImage>
            <span className="text-xs font-extrabold text-brand">{a.category.name}</span>
            <h3 className="text-base font-bold leading-snug transition-colors group-hover:text-brand">{a.title}</h3>
          </Link>
        ))}
      </div>
    </section>
  );
}
