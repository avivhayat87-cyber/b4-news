'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CATEGORIES, categoryHref } from '@/lib/site';

export function SectionNav() {
  const pathname = usePathname();
  const items = [{ href: '/', label: 'ראשי' }, ...CATEGORIES.map((c) => ({ href: categoryHref(c.slug), label: c.name }))];

  return (
    <nav aria-label="מדורים" className="bg-ink">
      <div className="scrollbar-none mx-auto flex w-full max-w-[1280px] items-stretch overflow-x-auto px-2 md:px-3">
        {items.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`whitespace-nowrap border-b-4 px-3.5 pb-3 pt-3.5 text-[15px] text-white outline-offset-[-3px] hover:bg-white/10 focus-visible:outline-white ${
                active ? 'border-brand font-extrabold' : 'border-transparent font-bold'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
