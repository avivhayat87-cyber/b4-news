'use client';
// The big rotating image of the main articles: a new story every few seconds with
// a slide and a slow zoom, swipe on phones, drag on desktop, dots to jump,
// and a pause button (auto-rotation pauses on hover, on focus and when the tab is hidden).
import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { articleHref, toneBackground } from '@/lib/site';
import type { ArticleCard } from '@/lib/types';
import { CategoryTag, PublishedTime } from './ui';

const INTERVAL_MS = 6000;

export function HeroCarousel({ articles }: { articles: ArticleCard[] }) {
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [hovering, setHovering] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [reduced, setReduced] = useState(false);
  const count = articles.length;
  const running = count > 1 && !paused && !hovering && !keyboardFocus && !hidden && !reduced;

  // In RTL the first slide is on the right and later ones are at negative scrollLeft.
  // Snapping is switched off while the slide moves (it would stop a jump across several
  // stories, or halt the animation halfway) and back on once the slide has arrived.
  const goTo = useCallback(
    (i: number, smooth = true) => {
      const el = track.current;
      if (!el || count === 0) return;
      const target = ((i % count) + count) % count;
      const left = (getComputedStyle(el).direction === 'rtl' ? -1 : 1) * target * el.clientWidth;
      el.style.scrollSnapType = 'none';
      el.scrollTo({ left, behavior: smooth && !reduced ? 'smooth' : 'auto' });
      const began = performance.now();
      const settle = () => {
        if (Math.abs(el.scrollLeft - left) < 2 || performance.now() - began > 1500) el.style.scrollSnapType = '';
        else requestAnimationFrame(settle);
      };
      requestAnimationFrame(settle);
    },
    [count, reduced],
  );

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    const onVisibility = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      mq.removeEventListener('change', sync);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // Which slide is showing, from the scroll position (works for swipes, drags and dots alike).
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setIndex(Math.round(Math.abs(el.scrollLeft) / Math.max(1, el.clientWidth))));
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('scroll', onScroll);
    };
  }, []);

  // Auto-advance; any manual change of slide restarts the countdown.
  useEffect(() => {
    if (!running) return;
    const t = setTimeout(() => goTo(index + 1), INTERVAL_MS);
    return () => clearTimeout(t);
  }, [running, index, goTo]);

  // Desktop mouse drag: one slide per drag, in the direction pulled.
  useEffect(() => {
    const el = track.current;
    if (!el || count < 2) return;
    let startX = 0;
    let startScroll = 0;
    let startIndex = 0;
    let pressed = false;
    let dragged = false;
    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      pressed = true;
      dragged = false;
      startX = e.clientX;
      startScroll = el.scrollLeft;
      startIndex = Math.round(Math.abs(el.scrollLeft) / el.clientWidth);
    };
    const move = (e: PointerEvent) => {
      if (!pressed) return;
      const dx = e.clientX - startX;
      if (!dragged && Math.abs(dx) < 6) return;
      if (!dragged) {
        dragged = true;
        el.setPointerCapture(e.pointerId);
        el.style.scrollSnapType = 'none';
        el.style.cursor = 'grabbing';
      }
      el.scrollLeft = startScroll - dx;
    };
    const up = (e: PointerEvent) => {
      if (!pressed) return;
      pressed = false;
      if (!dragged) return;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      el.style.cursor = '';
      const dx = e.clientX - startX;
      const rtl = getComputedStyle(el).direction === 'rtl';
      // Pulling toward the end of the row (left in RTL) shows the next story.
      const forward = rtl ? dx > 0 : dx < 0;
      goTo(Math.max(0, Math.min(count - 1, Math.abs(dx) > 50 ? startIndex + (forward ? 1 : -1) : startIndex)));
    };
    const click = (e: MouseEvent) => {
      if (dragged) {
        e.preventDefault();
        e.stopPropagation();
        dragged = false;
      }
    };
    const noGhost = (e: DragEvent) => e.preventDefault();
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('click', click, true);
    el.addEventListener('dragstart', noGhost);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('click', click, true);
      el.removeEventListener('dragstart', noGhost);
    };
  }, [count, goTo]);

  if (count === 0) return null;

  return (
    <div
      role="region"
      aria-roledescription="קרוסלה"
      aria-label="כתבות ראשיות"
      className="group/hero relative min-w-0 overflow-hidden rounded-xl"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      // Keyboard users get a still slide while they are inside; a mouse click on a dot doesn't freeze it.
      onFocus={(e) => setKeyboardFocus((e.target as HTMLElement).matches(':focus-visible'))}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setKeyboardFocus(false);
      }}
    >
      <div ref={track} className="scrollbar-none flex h-[460px] cursor-grab snap-x snap-mandatory overflow-x-auto overscroll-x-contain md:h-[560px]">
        {articles.map((a, i) => {
          const active = i === index;
          return (
            <div
              key={a.id}
              role="group"
              aria-roledescription="שקופית"
              aria-label={`${i + 1} מתוך ${count}`}
              aria-hidden={!active || undefined}
              className="relative h-full w-full shrink-0 snap-start"
            >
              <Link
                href={articleHref(a)}
                tabIndex={active ? undefined : -1}
                draggable={false}
                className="flex h-full flex-col justify-end overflow-hidden px-6 pb-14 pt-9 text-white md:px-10 md:pb-16"
                style={{ background: toneBackground(a.id) }}
              >
                {a.image ? (
                  <Image
                    src={a.image.url}
                    alt={a.image.alt}
                    fill
                    priority={i === 0}
                    sizes="(min-width: 1280px) 830px, (min-width: 1024px) 66vw, 100vw"
                    draggable={false}
                    className={`object-cover transition-transform ease-out ${active && !reduced ? 'scale-[1.07] duration-[7000ms]' : 'scale-100 duration-700'}`}
                  />
                ) : null}
                <span aria-hidden="true" className="absolute inset-0 bg-linear-to-b from-ink/10 from-15% via-ink/60 via-50% to-ink/95" />
                <CategoryTag name={a.category.name} className="absolute right-5 top-5 text-[13px]" />
                <div className={`relative transition-all duration-700 ${active ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'}`}>
                  {i === 0 ? (
                    <h1 className="max-w-[20ch] text-balance text-[32px] font-extrabold leading-[1.08] tracking-[-0.01em] [text-shadow:0_2px_16px_rgba(0,0,0,.45)] md:text-[50px]">
                      {a.title}
                    </h1>
                  ) : (
                    <h2 className="max-w-[20ch] text-balance text-[32px] font-extrabold leading-[1.08] tracking-[-0.01em] [text-shadow:0_2px_16px_rgba(0,0,0,.45)] md:text-[50px]">
                      {a.title}
                    </h2>
                  )}
                  {a.excerpt ? <p className="mt-3 line-clamp-2 max-w-[60ch] text-[16px] leading-relaxed text-[#E6E6EB] md:text-lg">{a.excerpt}</p> : null}
                  <span className="mt-3 block text-[13px] text-[#BEBEC7]">
                    {a.author ? <>מאת {a.author.name} · </> : null}
                    <PublishedTime iso={a.publishedAt} />
                  </span>
                </div>
              </Link>
            </div>
          );
        })}
      </div>

      {count > 1 ? (
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 px-6 pb-5 md:px-10">
          <div className="flex flex-1 items-center gap-1.5" role="group" aria-label="בחירת כתבה">
            {articles.map((a, i) => (
              <button
                key={a.id}
                type="button"
                aria-current={i === index ? 'true' : undefined}
                aria-label={`כתבה ${i + 1}: ${a.title}`}
                onClick={() => goTo(i)}
                className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/30 hover:bg-white/50"
              >
                {/* The active dot fills up until the next story. */}
                <span
                  key={`${i}-${index}-${running}`}
                  className={`absolute inset-y-0 right-0 rounded-full bg-white ${i < index ? 'w-full' : 'w-0'}`}
                  style={i === index ? { width: running ? undefined : '100%', animation: running ? `hero-progress ${INTERVAL_MS}ms linear forwards` : undefined } : undefined}
                />
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            aria-label={paused ? 'הפעלת החלפה אוטומטית' : 'עצירת החלפה אוטומטית'}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/20 text-white hover:bg-white/35"
          >
            {paused ? (
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
                <path d="M7 4.5v15l12-7.5z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
                <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
              </svg>
            )}
          </button>
        </div>
      ) : null}
    </div>
  );
}
