'use client';
// Horizontal rows you can pull: a finger swipe on phones (native scrolling), and
// on desktop a mouse drag with a little momentum. A drag never counts as a click.
import { type RefObject, useEffect, useState } from 'react';

const DRAG_THRESHOLD = 6;

export function useDragScroll(ref: RefObject<HTMLElement | null>) {
  const [edges, setEdges] = useState({ atStart: true, atEnd: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // In RTL pages scrollLeft runs from 0 (start, on the right) to negative values.
    const updateEdges = () => {
      const travelled = Math.abs(el.scrollLeft);
      setEdges({ atStart: travelled < 2, atEnd: travelled + el.clientWidth >= el.scrollWidth - 2 });
    };
    updateEdges();

    let startX = 0;
    let startScroll = 0;
    let dragging = false;
    let pressed = false;
    let lastX = 0;
    let lastT = 0;
    let velocity = 0;
    let frame = 0;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return; // touch and pen scroll natively
      cancelAnimationFrame(frame);
      pressed = true;
      dragging = false;
      startX = lastX = e.clientX;
      startScroll = el.scrollLeft;
      lastT = performance.now();
      velocity = 0;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!pressed) return;
      const dx = e.clientX - startX;
      if (!dragging && Math.abs(dx) < DRAG_THRESHOLD) return;
      if (!dragging) {
        dragging = true;
        el.setPointerCapture(e.pointerId);
        el.style.scrollSnapType = 'none';
        el.style.cursor = 'grabbing';
        el.style.userSelect = 'none';
      }
      el.scrollLeft = startScroll - dx;
      const now = performance.now();
      velocity = (e.clientX - lastX) / Math.max(1, now - lastT);
      lastX = e.clientX;
      lastT = now;
    };

    const release = (e: PointerEvent) => {
      if (!pressed) return;
      pressed = false;
      if (!dragging) return;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      el.style.cursor = '';
      el.style.userSelect = '';
      const restoreSnap = () => {
        el.style.scrollSnapType = '';
      };
      if (reduceMotion || Math.abs(velocity) < 0.05) return restoreSnap();
      // Momentum: keep gliding and slow down (capped, so a flick moves a few cards, not the whole row),
      // stop at the edge, then let snapping settle the row on a card.
      let v = Math.max(-45, Math.min(45, velocity * 16));
      const glide = () => {
        const before = el.scrollLeft;
        el.scrollLeft -= v;
        v *= 0.92;
        if (Math.abs(v) > 0.5 && el.scrollLeft !== before) frame = requestAnimationFrame(glide);
        else restoreSnap();
      };
      frame = requestAnimationFrame(glide);
    };

    // The click that ends a drag must not open the article under the pointer.
    const onClick = (e: MouseEvent) => {
      if (dragging) {
        e.preventDefault();
        e.stopPropagation();
        dragging = false;
      }
    };
    const onDragStart = (e: DragEvent) => e.preventDefault(); // no ghost images of links/images

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('click', onClick, true);
    el.addEventListener('dragstart', onDragStart);
    el.addEventListener('scroll', updateEdges, { passive: true });
    const ro = new ResizeObserver(updateEdges);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', release);
      el.removeEventListener('pointercancel', release);
      el.removeEventListener('click', onClick, true);
      el.removeEventListener('dragstart', onDragStart);
      el.removeEventListener('scroll', updateEdges);
      ro.disconnect();
    };
  }, [ref]);

  return edges;
}
