'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { marketsHref } from '@/lib/markets';
import { CATEGORIES, categoryHref } from '@/lib/site';
import { RowArrows } from './row-arrows';
import { useDragScroll } from './use-drag-scroll';

const items = [
  { href: '/', label: 'ראשי' },
  { href: marketsHref(), label: 'שווקים' },
  ...CATEGORIES.map((c) => ({ href: categoryHref(c.slug), label: c.name })),
];

const linkClass = (active: boolean) =>
  `block whitespace-nowrap border-b-4 px-2.5 pb-2 pt-2.5 text-[15px] outline-offset-[-3px] md:pb-2.5 md:pt-3 ${
    active ? 'border-brand font-extrabold text-ink' : 'border-transparent font-bold text-brand hover:border-brand/30 hover:text-brand-deep'
  }`;

/**
 * Section links in brand red; the current section in ink with a red underline.
 * Phones and tablets scroll the row sideways (a swipe, a mouse drag or the arrows at its ends);
 * wider screens show what fits and move the rest into "עוד".
 */
export function SectionNav() {
  const pathname = usePathname();
  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));
  const navRef = useRef<HTMLElement>(null);
  const measureRef = useRef<HTMLUListElement>(null);
  const rowRef = useRef<HTMLUListElement>(null);
  const edges = useDragScroll(rowRef);
  const [fit, setFit] = useState(items.length);
  const [open, setOpen] = useState(false);
  const [desktop, setDesktop] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const update = () => setDesktop(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  useLayoutEffect(() => {
    if (!desktop) return setFit(items.length);
    const nav = navRef.current;
    const measure = measureRef.current;
    if (!nav || !measure) return;
    const compute = () => {
      const widths = [...measure.children].map((li) => (li as HTMLElement).offsetWidth);
      const more = widths[widths.length - 1] ?? 70; // the last measured item is the "עוד" button
      const available = nav.clientWidth;
      let used = 0;
      let count = 0;
      for (let i = 0; i < items.length; i++) {
        const needsMore = i < items.length - 1;
        if (used + widths[i]! + (needsMore ? more : 0) > available) break;
        used += widths[i]!;
        count++;
      }
      setFit(Math.max(1, count));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(nav);
    return () => ro.disconnect();
  }, [desktop]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !navRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  useEffect(() => setOpen(false), [pathname]);

  const shown = desktop ? items.slice(0, fit) : items;
  const hidden = desktop ? items.slice(fit) : [];
  const hiddenActive = hidden.some((i) => isActive(i.href));

  return (
    <nav ref={navRef} aria-label="מדורים" className="relative min-w-0 flex-1">
      {/* Off-screen copy used only to measure each link's width */}
      <ul ref={measureRef} aria-hidden="true" className="pointer-events-none invisible absolute flex" style={{ insetInlineStart: -9999 }}>
        {items.map((item) => (
          <li key={item.href} className="shrink-0">
            <span className={linkClass(false)}>{item.label}</span>
          </li>
        ))}
        <li className="shrink-0">
          <span className={linkClass(false)}>עוד ▾</span>
        </li>
      </ul>

      <ul ref={rowRef} className={`flex items-stretch ${desktop ? '' : 'scrollbar-none overflow-x-auto overscroll-x-contain'}`}>
        {shown.map((item) => (
          <li key={item.href} className="shrink-0">
            <Link href={item.href} draggable={false} aria-current={isActive(item.href) ? 'page' : undefined} className={linkClass(isActive(item.href))}>
              {item.label}
            </Link>
          </li>
        ))}
        {hidden.length > 0 ? (
          <li className="relative shrink-0">
            <button type="button" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((o) => !o)} className={`${linkClass(hiddenActive)} cursor-pointer`}>
              עוד ▾
            </button>
            {open ? (
              <ul className="absolute end-0 top-full z-40 mt-1 min-w-48 rounded-lg border border-line bg-white py-1.5 shadow-lg">
                {hidden.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={isActive(item.href) ? 'page' : undefined}
                      className={`block px-4 py-2 text-[15px] ${isActive(item.href) ? 'font-extrabold text-ink' : 'font-bold text-brand hover:bg-stone'}`}
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ) : null}
      </ul>
      {desktop ? null : <RowArrows track={rowRef} atStart={edges.atStart} atEnd={edges.atEnd} name="מדורים" />}
    </nav>
  );
}
