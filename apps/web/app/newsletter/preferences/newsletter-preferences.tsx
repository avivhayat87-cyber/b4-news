'use client';

import type { DigestPrefs } from '@b4/shared';
import { useCallback } from 'react';
import { DigestForm } from '@/components/digest-form';
import { newsletterApi } from '@/lib/client-api';

export function NewsletterPreferences({ id, token }: { id: string; token: string }) {
  const load = useCallback(() => newsletterApi.prefs(id, token), [id, token]);
  const save = useCallback((p: DigestPrefs) => newsletterApi.savePrefs(id, token, p), [id, token]);
  if (!id || !token) return <p className="text-lg text-ink-2">הקישור חסר. פתחו אותו שוב מתוך אחד הגיליונות במייל.</p>;
  return <DigestForm load={load} save={save} />;
}
