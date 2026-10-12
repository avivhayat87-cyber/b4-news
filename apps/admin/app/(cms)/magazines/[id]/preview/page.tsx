'use client';
import { use } from 'react';
import { PublishPreviewScreen } from '@/components/publish-preview';

export default function MagazinePreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <PublishPreviewScreen target={{ magazineId: id }} backHref={`/magazines/${id}`} backLabel="חזרה למגזין" />;
}
