'use client';
// An ad as readers will see it, with the "פרסומת" label the site puts on every ad, on a large
// screen or a phone.
import { AD_LABEL, AD_SIZES, type CreativeDto } from '@b4/shared';
import { cx } from '../ui';

type Previewable = Pick<CreativeDto, 'format' | 'headline' | 'body' | 'cta' | 'sponsor' | 'desktopUrl' | 'mobileUrl' | 'alt'>;

export function AdPreview({ ad, device = 'desktop', className }: { ad: Previewable; device?: 'desktop' | 'mobile'; className?: string }) {
  const label = (
    <p className="mb-1 flex items-center gap-1.5 text-[11px] font-bold text-muted">
      <span className="rounded bg-stone px-1.5 py-0.5 text-ink-2">{AD_LABEL}</span>
      {ad.sponsor && <span>בחסות {ad.sponsor}</span>}
    </p>
  );
  if (ad.format === 'native') {
    return (
      <div className={cx('w-full max-w-[320px]', className)}>
        {label}
        <div className="overflow-hidden rounded-lg bg-white ring-1 ring-line">
          {ad.desktopUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- API-hosted ad picture
            <img src={ad.desktopUrl} alt="" className="aspect-video w-full object-cover" />
          ) : (
            <div className="aspect-video w-full bg-gradient-to-br from-stone to-line" />
          )}
          <div className="space-y-1.5 p-3">
            <p className="font-display text-[15px] font-extrabold leading-snug">{ad.headline || 'כותרת המודעה'}</p>
            {ad.body && <p className="text-sm text-ink-2">{ad.body}</p>}
            {ad.cta && <span className="inline-flex rounded-full bg-ink px-3 py-1 text-xs font-bold text-white">{ad.cta}</span>}
          </div>
        </div>
      </div>
    );
  }
  const size = AD_SIZES[ad.format][device];
  const src = device === 'mobile' ? (ad.mobileUrl ?? (ad.format === 'rectangle' ? ad.desktopUrl : null)) : ad.desktopUrl;
  return (
    <div className={cx('w-full', className)} style={{ maxWidth: size.width }}>
      {label}
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- API-hosted ad picture
        <img src={src} alt={ad.alt} width={size.width} height={size.height} className="h-auto w-full rounded ring-1 ring-line" />
      ) : (
        <div className="flex items-center justify-center rounded border border-dashed border-line bg-stone text-xs text-muted" style={{ aspectRatio: `${size.width} / ${size.height}` }}>
          {device === 'mobile' ? 'אין תמונה לנייד: הבאנר לא יוצג בטלפונים' : 'אין תמונה'}
        </div>
      )}
    </div>
  );
}
