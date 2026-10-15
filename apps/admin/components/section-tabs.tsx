'use client';
// The tabs on top of a merged menu item: each tab is its own page (its address stays, so links in
// emails keep working), and the menu shows one item for all of them (shell.tsx). The red numbers
// are the same ones the menu sums up.
import type { DashboardDto } from '@b4/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { admin } from '@/lib/api';
import { cx } from './ui';

type SectionTab = { href: string; label: string; match: (path: string) => boolean; badge?: (d: DashboardDto) => number };

const under = (prefix: string) => (path: string) => path === prefix || path.startsWith(`${prefix}/`);

export const SECTIONS = {
  /** "איתור כתבות": the Israeli and foreign scans, the past runs, and the sites they scan. */
  discovery: [
    { href: '/discovery', label: 'בישראל', match: (p) => p === '/discovery' },
    { href: '/discovery/international', label: 'מחו״ל', match: under('/discovery/international') },
    { href: '/discovery/runs', label: 'איתורים קודמים', match: under('/discovery/runs') },
    { href: '/sources', label: 'הגדרות אתרים', match: under('/sources'), badge: (d) => d.sources.waitingForDeveloper },
  ],
  /** "מנויים וגולשים": the readers and subscribers, their comments, and the requests to take something down. */
  audience: [
    { href: '/audience', label: 'מנויים וגולשים', match: under('/audience') },
    { href: '/comments', label: 'תגובות גולשים', match: under('/comments'), badge: (d) => d.comments.toReview + d.comments.reported },
    { href: '/takedowns', label: 'בקשות הסרה', match: under('/takedowns'), badge: (d) => d.takedowns.open },
  ],
} satisfies Record<string, SectionTab[]>;

export type SectionId = keyof typeof SECTIONS;

/** The paths a merged menu item stands for (the menu lights it on each of them). */
export const sectionPaths = (id: SectionId) => SECTIONS[id].map((t) => t.href);

export function SectionTabs({ section }: { section: SectionId }) {
  const pathname = usePathname();
  const dash = useQuery({ queryKey: ['dashboard'], queryFn: () => admin.get<DashboardDto>('/dashboard'), refetchInterval: 60_000 });
  const tabs: SectionTab[] = SECTIONS[section];
  return (
    // On a narrow screen the tabs wrap to a second line rather than hide behind a sideways scroll.
    <nav className="-mt-1 mb-5 border-b border-line" aria-label="לשוניות">
      <ul className="flex flex-wrap gap-x-1">
        {tabs.map((t) => {
          const current = t.match(pathname);
          const count = dash.data && t.badge ? t.badge(dash.data) : 0;
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={current ? 'page' : undefined}
                className={cx('-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 font-bold transition-colors', current ? 'border-brand text-ink' : 'border-transparent text-ink-2 hover:border-line hover:text-ink')}
              >
                {t.label}
                {count > 0 && <span className="rounded-full bg-brand px-2 py-0.5 text-[11px] font-bold text-white">{count}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
