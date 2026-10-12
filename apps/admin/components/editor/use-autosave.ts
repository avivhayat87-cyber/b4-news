'use client';
// Continuous autosave for the canvas: debounced, one request at a time,
// optimistic version checks, and a warning before leaving with unsaved text.
import type { DraftDetail } from '@b4/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiFailure, admin } from '@/lib/api';

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict' | 'locked';

type Content = { title: string; subtitle: string; bodyDoc: unknown };

const DEBOUNCE_MS = 1200;

export function useAutosave(draft: DraftDetail | undefined, editable: boolean) {
  const [content, setContent] = useState<Content | null>(null);
  const [state, setState] = useState<SaveState>('saved');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const version = useRef(0);
  const latest = useRef<Content | null>(null);
  const dirty = useRef(false);
  const inFlight = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [contentKey, setContentKey] = useState(0);
  const adoptedFor = useRef<string | null>(null);
  const draftId = draft?.id;

  // Adopt the server's copy on first load, and whenever it moved ahead (an AI edit) while nothing local was unsaved.
  useEffect(() => {
    if (!draft) return;
    if (adoptedFor.current !== draft.id || (draft.version > version.current && !dirty.current)) {
      adoptedFor.current = draft.id;
      version.current = draft.version;
      const c = { title: draft.title, subtitle: draft.subtitle, bodyDoc: draft.bodyDoc };
      latest.current = c;
      setContent(c);
      setContentKey((k) => k + 1);
      setState('saved');
      setMessage(null);
    }
  }, [draft]);

  const save = useCallback(
    async (checkpoint = false): Promise<boolean> => {
      if (!draftId || !latest.current) return true;
      if (inFlight.current) await inFlight.current;
      if (!dirty.current && !checkpoint) return true;
      const body = latest.current;
      dirty.current = false;
      setState('saving');
      let ok = true;
      const p = admin
        .put<{ version: number; savedAt: string }>(`/drafts/${draftId}/content`, { version: version.current, ...body, checkpoint })
        .then((res) => {
          version.current = res.version;
          setSavedAt(res.savedAt);
          setState(dirty.current ? 'dirty' : 'saved');
        })
        .catch((e: unknown) => {
          ok = false;
          dirty.current = true;
          if (e instanceof ApiFailure && e.code === 'version_conflict') setState('conflict');
          else if (e instanceof ApiFailure && ['text_locked', 'ai_busy', 'already_published', 'skipped'].includes(e.code)) setState('locked');
          else setState('error');
          setMessage(e instanceof Error ? e.message : 'השמירה נכשלה');
        });
      inFlight.current = p;
      await p;
      inFlight.current = null;
      return ok;
    },
    [draftId],
  );

  const update = useCallback(
    (patch: Partial<Content>) => {
      if (!latest.current || !editable) return;
      latest.current = { ...latest.current, ...patch };
      setContent(latest.current);
      dirty.current = true;
      setState((s) => (s === 'conflict' || s === 'locked' ? s : 'dirty'));
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void save(), DEBOUNCE_MS);
    },
    [editable, save],
  );

  // Retry after a network error.
  useEffect(() => {
    if (state !== 'error') return;
    const t = setTimeout(() => void save(), 5000);
    return () => clearTimeout(t);
  }, [state, save]);

  // Warn before closing the tab with unsaved changes.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty.current || inFlight.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  /** Throws away local edits and takes the server's version (after a conflict). */
  const reloadFromServer = useCallback((d: DraftDetail) => {
    dirty.current = false;
    version.current = d.version;
    const c = { title: d.title, subtitle: d.subtitle, bodyDoc: d.bodyDoc };
    latest.current = c;
    setContent(c);
    setContentKey((k) => k + 1);
    setState('saved');
    setMessage(null);
  }, []);

  return {
    content,
    /** Changes whenever the canvas must reload its content from content. */
    contentKey,
    state,
    savedAt,
    message,
    version: version.current,
    update,
    /** Saves now (and records a checkpoint revision). Resolves false if the save failed. */
    flush: (checkpoint = true) => {
      if (timer.current) clearTimeout(timer.current);
      return save(checkpoint);
    },
    reloadFromServer,
  };
}
