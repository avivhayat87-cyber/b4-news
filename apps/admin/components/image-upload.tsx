'use client';
// Upload an image; the server cuts every size the site, the app and the
// networks need. Clicking the image moves the focal point the crops keep.
import type { MediaDto } from '@b4/shared';
import { useRef, useState } from 'react';
import { admin, errorMessage } from '@/lib/api';
import { Button, cx, useToast } from './ui';

export function UploadButton({ onUploaded, label = 'העלאת תמונה', variant = 'secondary' }: { onUploaded(m: MediaDto): void; label?: string; variant?: 'secondary' | 'ghost' | 'dark' }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function upload(file: File) {
    if (file.size > 15 * 1024 * 1024) return toast('הקובץ גדול מדי (עד 15MB)', 'danger');
    const form = new FormData();
    form.append('file', file);
    setBusy(true);
    try {
      onUploaded(await admin.upload<MediaDto>('/media', form));
    } catch (e) {
      toast(errorMessage(e), 'danger');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      <Button variant={variant} busy={busy} onClick={() => input.current?.click()}>
        {label}
      </Button>
    </>
  );
}

/** The image with its focal point; click to move it (all renditions are re-cut). */
export function FocalPicker({ media, onChange }: { media: MediaDto; onChange(m: MediaDto): void }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function pick(e: React.MouseEvent<HTMLButtonElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const focalX = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const focalY = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    setBusy(true);
    try {
      onChange(await admin.patch<MediaDto>(`/media/${media.id}`, { focalX: Math.round(focalX * 100) / 100, focalY: Math.round(focalY * 100) / 100 }));
    } catch (err) {
      toast(errorMessage(err), 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button type="button" onClick={pick} disabled={busy} className={cx('relative block w-full overflow-hidden rounded-lg', busy && 'opacity-60')} aria-label="בחירת נקודת המוקד של התמונה">
        {/* eslint-disable-next-line @next/next/no-img-element -- API-hosted image */}
        <img src={media.url} alt={media.alt ?? ''} className="aspect-video w-full object-cover" />
        <span
          aria-hidden
          className="absolute size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white shadow-[0_0_0_2px_rgba(0,0,0,0.5)]"
          style={{ left: `${media.focalX * 100}%`, top: `${media.focalY * 100}%` }}
        />
      </button>
      <p className="mt-1 text-xs text-muted">
        {media.width}×{media.height} · לחיצה על התמונה קובעת מה יישאר במרכז בכל החיתוכים (ראשית, כרטיס, סטורי, ריבוע).
      </p>
    </div>
  );
}
