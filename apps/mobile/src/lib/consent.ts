// The terms on the device: accepted on the welcome screen at first launch, and again
// whenever the newsroom publishes a new version. Kept in AsyncStorage and recorded by
// the API under a random id that isn't linked to the reader.
import { LEGAL_VERSION_DEFAULT } from '@b4/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

const KEY = 'b4.consent';
type Stored = { visitorId: string; version: string; at: string };

/** Random v4 id; it only has to be unique, not secret. */
function newId(): string {
  const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16));
  hex[12] = '4';
  hex[16] = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const h = hex.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

async function read(): Promise<Stored | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    return null;
  }
}

/**
 * Whether the welcome screen has to be shown. The current version comes from the
 * API; offline on a first launch, the built-in version is asked for instead.
 */
export function useConsentGate() {
  const site = useQuery({ queryKey: ['site'], queryFn: api.site, staleTime: 10 * 60_000 });
  const [stored, setStored] = useState<Stored | null | undefined>(undefined);
  useEffect(() => {
    void read().then(setStored);
  }, []);

  const version = site.data?.consent.version ?? (site.isError ? LEGAL_VERSION_DEFAULT : null);
  const accept = useCallback(async () => {
    const v = version ?? LEGAL_VERSION_DEFAULT;
    const next: Stored = { visitorId: stored?.visitorId ?? newId(), version: v, at: new Date().toISOString() };
    await AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => undefined);
    setStored(next);
    // Evidence, not a gate: the app opens even if the API can't be reached right now.
    void api.recordConsent(next.visitorId, v).catch(() => undefined);
  }, [stored, version]);

  // A returning reader isn't held up by the network: the check runs once the version arrives.
  // Offline, any earlier acceptance still counts.
  const loading = stored === undefined || (stored === null && version === null);
  const needed = !loading && version !== null && stored?.version !== version && !(site.isError && stored);
  return { loading, needed, accept };
}
