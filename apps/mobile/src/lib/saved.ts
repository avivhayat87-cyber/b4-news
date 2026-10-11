// Saved articles, stored in full on the device so they can be read offline.
import type { ArticleFull } from '@b4/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

const KEY = 'b4.saved.v1';
type SavedEntry = { article: ArticleFull; savedAt: string };

let cache: SavedEntry[] | null = null;
const listeners = new Set<(entries: SavedEntry[]) => void>();

async function load(): Promise<SavedEntry[]> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as SavedEntry[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

async function write(entries: SavedEntry[]): Promise<void> {
  cache = entries;
  listeners.forEach((fn) => fn(entries));
  await AsyncStorage.setItem(KEY, JSON.stringify(entries));
}

export async function toggleSaved(article: ArticleFull): Promise<boolean> {
  const entries = await load();
  const exists = entries.some((e) => e.article.slug === article.slug);
  await write(exists ? entries.filter((e) => e.article.slug !== article.slug) : [{ article, savedAt: new Date().toISOString() }, ...entries]);
  return !exists;
}

export async function getSavedArticle(slug: string): Promise<ArticleFull | null> {
  return (await load()).find((e) => e.article.slug === slug)?.article ?? null;
}

/** All saved entries, newest first, kept in sync across screens. */
export function useSaved() {
  const [entries, setEntries] = useState<SavedEntry[]>(cache ?? []);
  useEffect(() => {
    void load().then(setEntries);
    listeners.add(setEntries);
    return () => {
      listeners.delete(setEntries);
    };
  }, []);
  const isSaved = useCallback((slug: string) => entries.some((e) => e.article.slug === slug), [entries]);
  return { entries, isSaved };
}
