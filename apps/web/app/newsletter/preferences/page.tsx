import type { Metadata } from 'next';
import { NewsletterPreferences } from './newsletter-preferences';

export const metadata: Metadata = { title: 'העיתון שלי: העדפות', robots: { index: false } };

/** From the "change topics and time" link in every issue (no sign-in needed). */
export default async function NewsletterPreferencesPage({ searchParams }: { searchParams: Promise<{ id?: string; token?: string }> }) {
  const { id, token } = await searchParams;
  return (
    <div className="mx-auto w-full max-w-[640px] px-4 py-16 md:px-6">
      <h1 className="mb-2 text-[32px] font-extrabold leading-tight">העיתון שלי</h1>
      <p className="mb-8 text-lg text-ink-2">מה יגיע אליך ומתי.</p>
      <NewsletterPreferences id={id ?? ''} token={token ?? ''} />
    </div>
  );
}
