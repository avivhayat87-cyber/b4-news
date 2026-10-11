import Link from 'next/link';
import { wrap } from '@/components/ui';

export default function NotFound() {
  return (
    <div className={`${wrap} flex flex-col items-start gap-4 py-20`}>
      <span className="font-mono text-sm text-muted">404</span>
      <h1 className="text-[40px] font-extrabold leading-none">העמוד לא נמצא</h1>
      <p className="max-w-[50ch] text-lg text-ink-2">ייתכן שהכתבה הוסרה או שהקישור שגוי. אפשר לחזור לדף הבית או לחפש את הכתבה.</p>
      <div className="flex flex-wrap gap-3">
        <Link href="/" className="inline-flex h-12 items-center rounded-full bg-brand px-6 font-extrabold text-white hover:bg-brand-deep">
          לדף הבית
        </Link>
        <Link href="/search" className="inline-flex h-12 items-center rounded-full border-2 border-ink px-6 font-extrabold hover:bg-ink hover:text-white">
          חיפוש
        </Link>
      </div>
    </div>
  );
}
