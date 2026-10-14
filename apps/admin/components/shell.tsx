'use client';
// The CMS frame: navigation on the right (Hebrew reading order), content on the left.
import type { DashboardDto } from '@b4/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { admin, api, SITE_URL } from '@/lib/api';
import { useStaff } from '@/lib/auth';
import { ROLE } from '@/lib/labels';
import { cx } from './ui';

type NavItem = { href: string; label: string; icon: ReactNode; badge?: number };

const I = {
  home: <path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z" />,
  radar: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4" />
      <path d="M12 12l6-6" />
    </>
  ),
  history: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5M12 7v5l3 2" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3.5 9h17M3.5 15h17M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </>
  ),
  upload: <path d="M12 16V4m0 0-5 5m5-5 5 5M4 20h16" />,
  saved: <path d="M6 3h12v18l-6-4-6 4z" />,
  articles: <path d="M5 3h10l4 4v14H5zM14 3v5h5M8 12h8M8 16h8" />,
  sites: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" />
    </>
  ),
  comments: <path d="M4 5h16v11H8l-4 4z" />,
  audience: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c2 .7 3.2 2.5 3.5 5.2" />
    </>
  ),
  social: (
    <>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" />
    </>
  ),
  takedown: (
    <>
      <path d="M5 21V4h11l-1.5 4L16 12H5" />
    </>
  ),
  learn: <path d="M12 3 2 8l10 5 10-5zM6 10.5V16c3 2 9 2 12 0v-5.5" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3m0 14v3M4.2 4.2l2.1 2.1m11.4 11.4 2.1 2.1M2 12h3m14 0h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </>
  ),
  agent: (
    <>
      <path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4z" />
      <path d="M9 9.5h.01M15 9.5h.01M9.5 13c1.5 1 3.5 1 5 0" />
    </>
  ),
};

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const staff = useStaff();
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const fullBleed = /^\/drafts\/[^/]+$/.test(pathname);
  const dash = useQuery({ queryKey: ['dashboard'], queryFn: () => admin.get<DashboardDto>('/dashboard'), refetchInterval: 60_000 });

  const nav: NavItem[] = [
    { href: '/', label: 'לוח בקרה', icon: I.home },
    { href: '/agent', label: 'סוכן AI', icon: I.agent },
    { href: '/discovery', label: 'איתור כתבות', icon: I.radar },
    { href: '/discovery/international', label: 'איתור מחו״ל', icon: I.globe },
    { href: '/discovery/runs', label: 'איתורים קודמים', icon: I.history },
    { href: '/manual', label: 'העלאה ידנית', icon: I.upload },
    { href: '/saved', label: 'עריכות שמורות', icon: I.saved, badge: dash.data ? dash.data.drafts.working + dash.data.drafts.ready : undefined },
    { href: '/articles', label: 'כתבות באתר', icon: I.articles },
    { href: '/social', label: 'רשתות חברתיות', icon: I.social },
    { href: '/sources', label: 'הגדרות אתרים', icon: I.sites, badge: dash.data?.sources.waitingForDeveloper || undefined },
    { href: '/audience', label: 'מנויים וגולשים', icon: I.audience },
    { href: '/comments', label: 'תגובות גולשים', icon: I.comments, badge: dash.data ? dash.data.comments.toReview + dash.data.comments.reported || undefined : undefined },
    { href: '/takedowns', label: 'בקשות הסרה', icon: I.takedown, badge: dash.data?.takedowns.open || undefined },
    { href: '/learning', label: 'למידת ה-AI', icon: I.learn },
    { href: '/settings', label: 'הגדרות', icon: I.settings },
  ];

  const active = (href: string) =>
    href === '/'
      ? pathname === '/'
      : pathname === href || (pathname.startsWith(`${href}/`) && !(href === '/discovery' && (pathname.startsWith('/discovery/runs') || pathname.startsWith('/discovery/international'))));

  async function logout() {
    await api.post('/auth/staff/logout').catch(() => undefined);
    qc.clear();
    router.replace('/login');
  }

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-l border-line bg-white">
        <Link href="/" className="flex items-center gap-2 px-5 pb-4 pt-5" aria-label="לוח בקרה">
          {/* eslint-disable-next-line @next/next/no-img-element -- static SVG logo */}
          <img src="/brand/b4-logo.svg" alt="B4 NEW'S" width={128} height={48} />
        </Link>
        <p className="px-5 pb-2 text-xs font-bold tracking-wide text-muted">מערכת העלאות</p>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3" aria-label="ניווט ראשי">
          {nav.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active(n.href) ? 'page' : undefined}
                className={cx(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 font-semibold transition-colors',
                  active(n.href) ? 'bg-brand-soft text-brand-deep' : 'text-ink-2 hover:bg-stone hover:text-ink',
                )}
              >
                <Icon>{n.icon}</Icon>
                <span className="flex-1">{n.label}</span>
                {n.badge ? <span className="rounded-full bg-brand px-2 py-0.5 text-[11px] font-bold text-white">{n.badge}</span> : null}
              </Link>
            ))}
        </nav>
        <div className="border-t border-line-soft p-4 text-sm">
          <p className="font-bold">{staff.fullName}</p>
          <p className="text-muted">{ROLE[staff.role]}</p>
          <div className="mt-3 flex items-center gap-3">
            <a href={SITE_URL} target="_blank" rel="noopener noreferrer" className="font-semibold text-ink-2 underline-offset-2 hover:underline">
              לאתר
            </a>
            <button type="button" onClick={logout} className="font-semibold text-brand hover:underline">
              יציאה
            </button>
          </div>
        </div>
      </aside>
      <div className="flex h-screen min-w-0 flex-1 flex-col">
        {dash.data && !dash.data.ai.live && (
          <div className="bg-warn-soft px-6 py-2 text-sm font-semibold text-warn" role="note">
            ה-AI {dash.data.ai.text === 'anthropic' ? 'לכתיבה מחובר, אבל התמונות' : 'והתמונות'} עדיין במצב הדגמה.{' '}
            <Link href="/settings" className="underline">
              חברו את Claude ו-Gemini ב&quot;הגדרות&quot; ← &quot;חיבורים&quot;
            </Link>{' '}
            כדי לקבל כתיבה ותמונות אמיתיות.
          </div>
        )}
        {/* The editor is full-bleed and manages its own scrolling; every other screen is a padded page. */}
        <main className="min-h-0 flex-1 overflow-y-auto">{fullBleed ? children : <div className="mx-auto max-w-[1500px] px-6 py-6">{children}</div>}</main>
      </div>
    </div>
  );
}
