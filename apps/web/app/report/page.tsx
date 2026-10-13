import type { Metadata } from 'next';
import Link from 'next/link';
import { wrap } from '@/components/ui';
import { ReportForm } from './report-form';

export const metadata: Metadata = {
  title: 'דיווח על תוכן',
  description: 'בקשה להסיר תגובה או תוכן שפוגעים בך או מפרים זכות שלך.',
  alternates: { canonical: '/report' },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ReportPage({ searchParams }: { searchParams: Promise<{ url?: string; comment?: string }> }) {
  const { url, comment } = await searchParams;
  return (
    <div className={`${wrap} py-10`}>
      <nav aria-label="פירורי לחם" className="mb-4 text-sm text-muted">
        <Link href="/" className="hover:text-ink">
          ראשי
        </Link>
        <span aria-hidden="true"> › </span>
        <span>דיווח על תוכן</span>
      </nav>
      <div className="max-w-[720px]">
        <h1 className="text-[34px] font-extrabold leading-tight md:text-[42px]">דיווח על תוכן</h1>
        <p className="mb-8 mt-3 text-lg leading-relaxed text-ink-2">
          תגובה או תוכן באתר פוגעים בך, חושפים פרטים אישיים או מפרים זכות שלך? מלאו את הטופס. כל פנייה נרשמת ונבדקת, ותקבלו תשובה למייל. לפרטים: <Link href="/comment-rules" className="font-semibold text-ink underline underline-offset-2">כללי ההשתתפות בתגובות</Link>.
        </p>
        <ReportForm url={url && /^https?:\/\//i.test(url) ? url : ''} commentId={comment && UUID.test(comment) ? comment : null} />
      </div>
    </div>
  );
}
