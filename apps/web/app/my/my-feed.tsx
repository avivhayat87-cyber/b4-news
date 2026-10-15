'use client';
// The reader's feed: their topics, the conversation around each article, and an invitation to
// be first where nobody commented yet. "בשבילך" mixes fresh and talked-about and changes a
// little on every visit (a new seed each time); "חדש" and "פופולרי" are steady.
import type { FeedItemDto, FeedMode, FeedPage, ReaderDto } from '@b4/shared';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { SignIn } from '@/components/comments';
import { ApiFailure, readerApi } from '@/lib/client-api';
import { CATEGORIES } from '@/lib/site';

const MODES: { id: FeedMode; label: string }[] = [
  { id: 'for-you', label: 'בשבילך' },
  { id: 'new', label: 'חדש' },
  { id: 'popular', label: 'פופולרי' },
];

const rtf = new Intl.RelativeTimeFormat('he', { numeric: 'auto' });
function ago(iso: string) {
  const minutes = Math.round((Date.parse(iso) - Date.now()) / 60_000);
  if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute');
  if (Math.abs(minutes) < 1440) return rtf.format(Math.round(minutes / 60), 'hour');
  return rtf.format(Math.round(minutes / 1440), 'day');
}

export function MyFeed() {
  const [reader, setReader] = useState<ReaderDto | null | undefined>(undefined);
  const [mode, setMode] = useState<FeedMode>('for-you');
  // A new seed on every visit: "בשבילך" looks a little different each time.
  const [seed] = useState(() => Math.floor(Math.random() * 1_000_000));
  const [page, setPage] = useState<FeedPage | null>(null);
  const [items, setItems] = useState<FeedItemDto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    readerApi.me().then(setReader).catch(() => setReader(null));
  }, []);

  const load = useCallback(
    async (cursor?: string | null) => {
      setBusy(true);
      setError(null);
      try {
        const next = await readerApi.feed(mode, cursor ?? undefined, seed);
        setPage(next);
        setItems((prev) => (cursor ? [...prev, ...next.items] : next.items));
      } catch (err) {
        setError(err instanceof ApiFailure ? err.message : 'משהו השתבש. נסו שוב.');
      } finally {
        setBusy(false);
      }
    },
    [mode, seed],
  );

  useEffect(() => {
    if (reader) void load();
  }, [reader, load]);

  if (reader === undefined) return <p className="text-ink-2">טוען…</p>;
  if (!reader) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-lg text-ink-2">כתבות מהתחומים שבחרת, עם התגובות המובילות והשיחות סביבן. התחברו כדי לראות את הפיד שלכם.</p>
        <SignIn title="התחברות לפיד שלי" heading="h2" onSignedIn={setReader} />
      </div>
    );
  }

  const topicNames = (page?.sections ?? []).map((s) => CATEGORIES.find((c) => c.slug === s)?.name ?? s);
  return (
    <div className="flex flex-col gap-5">
      <p className="text-[15px] text-ink-2">
        {topicNames.length ? `התחומים שלך: ${topicNames.join(' · ')}.` : 'כל התחומים.'}{' '}
        <Link href="/account#my-paper" className="font-semibold text-ink underline underline-offset-2 hover:text-brand">
          בחירת תחומים
        </Link>
      </p>
      <div className="inline-flex self-start rounded-full bg-stone p-1 font-bold" role="tablist" aria-label="סדר הפיד">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={mode === m.id}
            onClick={() => setMode(m.id)}
            className={`rounded-full px-5 py-2 text-[15px] ${mode === m.id ? 'bg-ink text-white' : 'text-ink-2 hover:text-ink'}`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <ul className="flex flex-col gap-5">
        {items.map((it) => (
          <li key={it.article.id} className="overflow-hidden rounded-2xl bg-white ring-1 ring-line">
            <Link href={`/article/${it.article.slug}`} className="flex gap-4 p-4 hover:bg-stone/50">
              {it.article.image ? (
                // eslint-disable-next-line @next/next/no-img-element -- our own media host, sized by the card rendition
                <img src={it.article.image.url} alt={it.article.image.alt} width={160} height={90} className="h-[90px] w-[160px] shrink-0 rounded-lg object-cover" />
              ) : null}
              <div className="min-w-0">
                <p className="text-xs font-extrabold text-brand">{it.article.category.name}</p>
                <h2 className="mt-1 text-lg font-extrabold leading-snug">{it.article.title}</h2>
                <p className="mt-1 text-xs text-muted">
                  {ago(it.article.publishedAt)} · {it.commentCount === 0 ? 'אין עדיין תגובות' : it.commentCount === 1 ? 'תגובה אחת' : `${it.commentCount} תגובות`}
                </p>
              </div>
            </Link>
            {it.topComment ? (
              <Link href={`/article/${it.article.slug}#comments`} className="block border-t border-line bg-stone/40 px-4 py-3 hover:bg-stone">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <strong>{it.topComment.author}</strong>
                  {it.topComment.picked ? <span className="rounded-full bg-brand px-2 py-0.5 text-xs font-bold text-white">בחירת העורכים</span> : null}
                  {it.topComment.likeCount ? <span className="text-muted">♥ {it.topComment.likeCount}</span> : null}
                </p>
                <p className="mt-1 line-clamp-3 text-[15px] leading-relaxed">{it.topComment.body}</p>
                <p className="mt-1 text-sm font-semibold text-ink-2">
                  {it.topComment.replies ? `${it.topComment.replies === 1 ? 'תשובה אחת' : `${it.topComment.replies} תשובות`} בשיחה · ` : ''}להצטרף לשיחה ←
                </p>
              </Link>
            ) : (
              <Link href={`/article/${it.article.slug}#comments`} className="block border-t border-line bg-brand-soft px-4 py-3 text-[15px] font-extrabold text-brand-deep hover:bg-[#ffd5d8]">
                היו הראשונים להגיב! ←
              </Link>
            )}
          </li>
        ))}
      </ul>

      {error ? (
        <p role="alert" className="text-brand-deep">
          {error}
        </p>
      ) : null}
      {!busy && !error && items.length === 0 ? <p className="text-ink-2">עוד אין כתבות חדשות בתחומים שלך. נסו &quot;חדש&quot;, או הוסיפו תחומים.</p> : null}
      {page?.nextCursor ? (
        <button type="button" onClick={() => load(page.nextCursor)} disabled={busy} className="self-center rounded-full border-2 border-ink px-6 py-2.5 font-extrabold hover:bg-ink hover:text-white disabled:opacity-60">
          {busy ? 'טוען…' : 'עוד'}
        </button>
      ) : busy ? (
        <p className="text-ink-2">טוען…</p>
      ) : null}
    </div>
  );
}
