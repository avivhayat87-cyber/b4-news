import type { SocialKey } from '@/lib/site';
import { CopyLinkButton } from './copy-link-button';
import { SocialIcon } from './icons';

export function ShareBar({ url, title }: { url: string; title: string }) {
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(title);
  const targets: { key: SocialKey; label: string; href: string }[] = [
    { key: 'whatsapp', label: 'שיתוף בוואטסאפ', href: `https://wa.me/?text=${t}%20${u}` },
    { key: 'facebook', label: 'שיתוף בפייסבוק', href: `https://www.facebook.com/sharer/sharer.php?u=${u}` },
    { key: 'telegram', label: 'שיתוף בטלגרם', href: `https://t.me/share/url?url=${u}&text=${t}` },
    { key: 'x', label: 'שיתוף ב-X', href: `https://x.com/intent/tweet?url=${u}&text=${t}` },
  ];

  return (
    <ul className="flex flex-wrap items-center gap-2" aria-label="שיתוף הכתבה">
      {targets.map((s) => (
        <li key={s.key}>
          <a
            href={s.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={s.label}
            className="flex h-10 w-10 items-center justify-center rounded-full border-[1.5px] border-line text-ink hover:border-brand hover:text-brand"
          >
            <SocialIcon name={s.key} size={18} />
          </a>
        </li>
      ))}
      <li>
        <CopyLinkButton url={url} />
      </li>
    </ul>
  );
}
