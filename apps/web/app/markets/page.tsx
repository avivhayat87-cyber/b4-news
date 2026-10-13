import type { Metadata } from 'next';
import { MarketsPage } from '@/components/markets-page';

export const revalidate = 300;

export const metadata: Metadata = {
  title: 'שווקים: מדדים, מניות ומטבעות',
  description: 'מדדי הבורסה בתל אביב ובעולם, מפת חום של מניות, סורק מניות, גרפים ויומן כלכלי.',
  alternates: { canonical: '/markets' },
};

export default function MarketsOverviewPage() {
  return <MarketsPage slug="" />;
}
