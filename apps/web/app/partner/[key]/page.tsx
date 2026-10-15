// An advertiser's private page: their campaigns' numbers and their leads, behind a signed link the
// newsroom sends them (no sign-in). Never indexed or cached; read in the browser, so the leads
// never sit in a rendered page.
import type { Metadata } from 'next';
import { PartnerReport } from '@/components/partner-report';
import { wrap } from '@/components/ui';

export const metadata: Metadata = { title: 'דוח מפרסם', robots: { index: false, follow: false } };

export default async function PartnerPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return (
    <div className={`${wrap} py-10`}>
      <PartnerReport reportKey={key} />
    </div>
  );
}
