'use client';
// A view, as advertisers count it (the MRC standard): at least half the ad on the screen, in a
// visible tab, for one second in a row (30% for a large banner). Counted once per ad shown.
import { useEffect, useRef, type RefObject } from 'react';

const LARGE_PX = 242_000;

export function useAdView(ref: RefObject<HTMLElement | null>, token: string | null, onView: (token: string) => void) {
  const counted = useRef<string | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !token || counted.current === token || typeof IntersectionObserver === 'undefined') return;
    const rect = el.getBoundingClientRect();
    const needed = rect.width * rect.height >= LARGE_PX ? 0.3 : 0.5;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inView = false;
    const stop = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    const start = () => {
      if (timer || !inView || document.visibilityState !== 'visible') return;
      timer = setTimeout(() => {
        counted.current = token;
        onView(token);
        observer.disconnect();
        document.removeEventListener('visibilitychange', onVisibility);
      }, 1000);
    };
    const onVisibility = () => (document.visibilityState === 'visible' ? start() : stop());
    const observer = new IntersectionObserver(
      ([entry]) => {
        inView = Boolean(entry && entry.intersectionRatio >= needed);
        if (inView) start();
        else stop();
      },
      { threshold: [0, 0.3, 0.5, 1] },
    );
    observer.observe(el);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [ref, token, onView]);
}
