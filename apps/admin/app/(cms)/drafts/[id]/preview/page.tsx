'use client';
import { use } from 'react';
import { PublishPreviewScreen } from '@/components/publish-preview';

export default function DraftPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <PublishPreviewScreen target={{ draftId: id }} backHref={`/drafts/${id}`} backLabel="חזרה לעריכה" />;
}
