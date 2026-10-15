import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { MarketsPage } from '@/components/markets-page';
import { MARKET_TABS, marketsHref } from '@/lib/markets';

// Not `dynamicParams = false`: under it Next 15 turns a page into "not found" the first time it
// refreshes (NoFallbackError). Other tabs get notFound() below instead.
const TABS = MARKET_TABS.filter((t) => t.slug !== '');

export function generateStaticParams() {
  return TABS.map((t) => ({ tab: t.slug }));
}

type Props = { params: Promise<{ tab: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tab: slug } = await params;
  const tab = TABS.find((t) => t.slug === slug);
  return tab ? { title: `${tab.label} · שווקים`, description: tab.description, alternates: { canonical: marketsHref(tab.slug) } } : {};
}

export default async function MarketsTabPage({ params }: Props) {
  const { tab: slug } = await params;
  const tab = TABS.find((t) => t.slug === slug);
  if (!tab) notFound();
  return <MarketsPage slug={tab.slug} />;
}
