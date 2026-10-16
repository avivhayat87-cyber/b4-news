'use client';
// Counts one read of an article for the newsroom (services/reads.ts in the API): once a day per
// browser, after the page has been on the screen a few seconds (a quick bounce, a tab opened and
// never looked at, or a crawler is not a read). Only the article and the kind of arrival are sent;
// the referrer's address never leaves the page, and nothing identifies the reader.
import type { ReadSource } from '@b4/shared';
import { useEffect } from 'react';
import { recordRead } from '@/lib/client-api';

const AFTER_MS = 4000;
/** Today's counted articles: { day, ids }, reset on a new day. */
const KEY = 'b4.reads';
const SEARCH = /(^|\.)(google|bing|duckduckgo|yahoo|yandex|baidu|ecosia)\./;
const SOCIAL = /(^|\.)(facebook|fb|instagram|t|x|twitter|linkedin|lnkd|telegram|whatsapp|wa|tiktok|youtube|reddit|threads)\.(com|me|co|in|net|org)$/;

/** Where the reader came from, by the referrer's host and the link's utm_medium. */
function arrival(): ReadSource {
  const medium = new URLSearchParams(window.location.search).get('utm_medium') ?? '';
  if (/social|share/.test(medium)) return 'social';
  let host = '';
  try {
    host = document.referrer ? new URL(document.referrer).hostname.replace(/^www\./, '') : '';
  } catch {
    return 'other';
  }
  if (!host) return 'direct';
  if (host === window.location.hostname.replace(/^www\./, '')) return 'internal';
  if (SEARCH.test(host)) return 'search';
  if (SOCIAL.test(host) || /^lm?\.facebook\./.test(host)) return 'social';
  return 'other';
}

function countedToday(): { day: string; ids: number[] } {
  const day = new Date().toDateString();
  try {
    const stored = JSON.parse(window.localStorage.getItem(KEY) ?? 'null') as { day?: string; ids?: number[] } | null;
    return stored?.day === day && Array.isArray(stored.ids) ? { day, ids: stored.ids } : { day, ids: [] };
  } catch {
    return { day, ids: [] };
  }
}

export function ReadCounter({ articleId }: { articleId: number }) {
  useEffect(() => {
    if (countedToday().ids.includes(articleId)) return;
    const from = arrival();
    let timer = 0;
    const count = () => {
      document.removeEventListener('visibilitychange', onVisibility);
      const today = countedToday();
      if (today.ids.includes(articleId)) return;
      try {
        window.localStorage.setItem(KEY, JSON.stringify({ day: today.day, ids: [...today.ids, articleId] }));
      } catch {
        // Storage blocked: still one read for this page view.
      }
      recordRead({ articleId, from });
    };
    // The few seconds run only while the page is on the screen.
    const onVisibility = () => {
      window.clearTimeout(timer);
      timer = document.visibilityState === 'visible' ? window.setTimeout(count, AFTER_MS) : 0;
    };
    document.addEventListener('visibilitychange', onVisibility);
    onVisibility();
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [articleId]);
  return null;
}
