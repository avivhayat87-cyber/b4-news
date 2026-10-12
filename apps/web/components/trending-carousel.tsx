'use client';

import Link from 'next/link';
import { useRef } from 'react';
import type { ArticleCard } from '@/lib/types';
import { articleHref } from '@/lib/site';
import { ArticleImage, RankBadge, SectionHeader, wrap } from './ui';
import { useDragScroll } from './use-drag-scroll';

/**
 * "חדשות חמות": up to 14 ranked articles in one row that scrolls freely:
 * swipe on a phone, drag with the mouse or swipe the trackpad on a computer.
 */
export function TrendingCarousel({ articles }: { articles: ArticleCard[] }) {
  const track = useRef<HTMLUListElement>(null);
  const { atEnd } = useDragScroll(track);
  if (articles.length === 0) return null;

  return (
    <section aria-labelledby="trending-title" className={`${wrap} pb-2 pt-10`}>
      <SectionHeader id="trending-title" title="חדשות חמות" subtitle="הכתבות שכולם קוראים עכשיו" className="mb-5" />

      <div className="relative">
        <ul
          ref={track}
          aria-label="חדשות חמות, אפשר לגלול הצידה"
          className="scrollbar-none flex cursor-grab snap-x snap-proximity gap-5 overflow-x-auto overscroll-x-contain pb-1.5"
        >
          {articles.slice(0, 14).map((a, i) => (
            <li key={a.id} className="w-[250px] shrink-0 snap-start">
              <Link href={articleHref(a)} draggable={false} className="group flex flex-col gap-2">
                <ArticleImage article={a} sizes="250px" className="rounded-[10px]">
                  <RankBadge n={i + 1} className="absolute bottom-2.5 right-2.5 shadow-[0_0_0_3px_#fff]" />
                </ArticleImage>
                <span className="text-xs font-extrabold text-brand">{a.category.name}</span>
                <h3 className="text-base font-bold leading-snug transition-colors group-hover:text-brand">{a.title}</h3>
              </Link>
            </li>
          ))}
        </ul>
        {/* A soft fade at the far edge says "there is more this way". */}
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-y-0 left-0 w-16 bg-linear-to-r from-white to-white/0 transition-opacity duration-300 ${atEnd ? 'opacity-0' : 'opacity-100'}`}
        />
      </div>
    </section>
  );
}
