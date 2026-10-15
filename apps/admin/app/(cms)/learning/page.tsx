'use client';
// "למידת ה-AI" lives in "הגדרות" > "צוות הסוכנים" > "הלמידה" since the menu was merged; the old
// address (emails, bookmarks) still leads there.
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Loading } from '@/components/ui';

export default function LearningPage() {
  const router = useRouter();
  useEffect(() => router.replace('/settings?tab=agents&agent=learning'), [router]);
  return <Loading />;
}
