import type { Metadata } from 'next';
import { UnsubscribeNewsletter } from './unsubscribe-newsletter';

export const metadata: Metadata = { title: 'הסרה מהניוזלטר', robots: { index: false } };

export default async function NewsletterUnsubscribePage({ searchParams }: { searchParams: Promise<{ id?: string; token?: string }> }) {
  const { id, token } = await searchParams;
  return (
    <div className="mx-auto w-full max-w-[640px] px-4 py-16 md:px-6">
      <UnsubscribeNewsletter id={id ?? ''} token={token ?? ''} />
    </div>
  );
}
