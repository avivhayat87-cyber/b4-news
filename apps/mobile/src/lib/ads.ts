// Ads in the app: how often this reader saw each campaign today (kept in memory, nothing sent
// about the reader), and a view counted the way advertisers count it: at least half the ad on the
// screen for one second in a row.
import type { PublicAd } from '@b4/shared';

const israelDay = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });

let day = israelDay();
const seen = new Map<string, { n: number; cap: number }>();

function today() {
  if (day !== israelDay()) {
    day = israelDay();
    seen.clear();
  }
  return seen;
}

export function countSeen(ad: PublicAd) {
  const s = today();
  s.set(ad.campaignId, { n: (s.get(ad.campaignId)?.n ?? 0) + 1, cap: ad.perReaderDaily });
}

/** Campaigns this reader already saw as often as they may today. */
export const reachedCap = () => [...today()].filter(([, c]) => c.n >= c.cap).map(([id]) => id);

/** Feed it how much of the ad is on screen (0..1); it calls onView once, after a second at half or more. */
export function viewTimer(onView: () => void) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let done = false;
  return (ratio: number) => {
    if (done) return;
    if (ratio >= 0.5) {
      timer ??= setTimeout(() => {
        done = true;
        onView();
      }, 1000);
    } else if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}
