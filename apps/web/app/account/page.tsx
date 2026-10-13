import type { Metadata } from 'next';
import Link from 'next/link';
import { wrap } from '@/components/ui';
import { AccountPanel } from './account-panel';

export const metadata: Metadata = { title: 'החשבון שלי', robots: { index: false } };

export default function AccountPage() {
  return (
    <div className={`${wrap} py-10`}>
      <nav aria-label="פירורי לחם" className="mb-4 text-sm text-muted">
        <Link href="/" className="hover:text-ink">
          ראשי
        </Link>
        <span aria-hidden="true"> › </span>
        <span>החשבון שלי</span>
      </nav>
      <div className="max-w-[720px]">
        <h1 className="mb-6 text-[34px] font-extrabold leading-tight md:text-[42px]">החשבון שלי</h1>
        <AccountPanel />
        <p className="mt-8 text-sm text-muted">
          מה אנחנו שומרים ולמה: <Link href="/privacy" className="font-semibold text-ink-2 underline underline-offset-2">מדיניות הפרטיות</Link>.
        </p>
      </div>
    </div>
  );
}
