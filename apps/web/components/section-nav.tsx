'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CATEGORIES, categoryHref } from '@/lib/site';

/** Section links in brand red; the current section in ink with a red underline. */
export function SectionNav() {
  const pathname = usePathname();
  const items = [{ href: '/', label: 'ראשי' }, ...CATEGORIES.map((c) => ({ href: categoryHref(c.slug), label: c.name }))];

  return (
    <nav aria-label="מדורים" className="min-w-0 flex-1">
      <ul className="scrollbar-none flex items-stretch overflow-x-auto">
        {items.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`block whitespace-nowrap border-b-4 px-2.5 pb-2.5 pt-3 text-[15px] outline-offset-[-3px] ${
                  active ? 'border-brand font-extrabold text-ink' : 'border-transparent font-bold text-brand hover:border-brand/30 hover:text-brand-deep'
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
