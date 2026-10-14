'use client';
// The bell for signed-in readers: replies to their comments, likes and the editors' pick.
// Nothing shows for visitors; opening it marks what was seen.
import type { ReaderNotificationDto } from '@b4/shared';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { readerApi } from '@/lib/client-api';

const TEXT: Record<ReaderNotificationDto['kind'], (actor: string | null) => string> = {
  reply: (a) => `${a ?? 'מישהו'} הגיב/ה לך`,
  like: (a) => `${a ?? 'מישהו'} אהב/ה את התגובה שלך`,
  pick: () => 'התגובה שלך נבחרה ל"בחירת העורכים"',
};

export function ReaderBell({ className = '' }: { className?: string }) {
  const [state, setState] = useState<{ items: ReaderNotificationDto[]; unread: number } | null>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    readerApi
      .me()
      .then((reader) => (reader ? readerApi.notifications() : null))
      .then((n) => alive && n && setState(n))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [open]);

  if (!state) return null;
  const toggle = () => {
    setOpen(!open);
    if (!open && state.unread > 0) {
      void readerApi.markRead().catch(() => undefined);
      setState({ items: state.items.map((i) => ({ ...i, read: true })), unread: 0 });
    }
  };

  return (
    <div ref={box} className={`relative ${className}`}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-label={state.unread ? `התראות, ${state.unread} חדשות` : 'התראות'}
        className="relative flex h-11 w-11 items-center justify-center rounded-full border-[1.5px] border-line text-ink hover:border-ink"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0" />
        </svg>
        {state.unread > 0 ? (
          <span className="absolute -end-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1 text-[11px] font-extrabold text-white" aria-hidden="true">
            {state.unread > 9 ? '9+' : state.unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute end-0 top-12 z-50 w-80 max-w-[90vw] overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-line">
          <p className="border-b border-line px-4 py-3 font-extrabold">התראות</p>
          {state.items.length === 0 ? (
            <p className="px-4 py-6 text-sm text-ink-2">עוד אין התראות. כשיגיבו לתגובות שלך או יאהבו אותן, זה יופיע כאן.</p>
          ) : (
            <ul className="max-h-96 divide-y divide-line overflow-y-auto">
              {state.items.map((n) => (
                <li key={n.id}>
                  <Link href={`/article/${n.article.slug}#comments`} onClick={() => setOpen(false)} className={`block px-4 py-3 hover:bg-stone ${n.read ? '' : 'bg-[#FFF6F6]'}`}>
                    <p className="text-sm font-bold">{TEXT[n.kind](n.actor)}</p>
                    <p className="mt-0.5 line-clamp-2 text-sm text-ink-2">{n.excerpt}</p>
                    <p className="mt-1 line-clamp-1 text-xs text-muted">{n.article.title}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link href="/account" onClick={() => setOpen(false)} className="block border-t border-line px-4 py-2.5 text-center text-sm font-semibold text-ink-2 hover:bg-stone">
            הגדרות התראות
          </Link>
        </div>
      ) : null}
    </div>
  );
}
