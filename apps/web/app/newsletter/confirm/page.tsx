import type { Metadata } from 'next';
import { ConfirmNewsletter } from './confirm-newsletter';

export const metadata: Metadata = { title: 'אישור הרשמה לניוזלטר', robots: { index: false } };

export default async function NewsletterConfirmPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <div className="mx-auto w-full max-w-[640px] px-4 py-16 md:px-6">
      <ConfirmNewsletter token={token ?? ''} />
    </div>
  );
}
