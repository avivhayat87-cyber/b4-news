import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { ArticleCard } from '@/lib/types';
import { toneBackground } from '@/lib/site';
import { formatPublished } from '@/lib/format';
import { PhotoIcon } from './icons';

/** Page column: 1280px max, 16px gutter on phones, 24px from tablet up. */
export const wrap = 'mx-auto w-full max-w-[1280px] px-4 md:px-6';

/** The B4 seal in miniature: red disc, white open orbit, a point running ahead. */
export function SealDot({ size = 26, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden="true" className={`shrink-0 ${className}`}>
      <circle cx="13" cy="13" r="13" className="fill-brand" />
      <path d="M13 5.5A7.5 7.5 0 1 0 19.5 9.25" fill="none" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="16.75" cy="6.5" r="1.4" fill="#FFFFFF" />
    </svg>
  );
}

/** Rank number in a red circle (trending lists), echoing the seal. */
export function RankBadge({ n, size = 'md', className = '' }: { n: number; size?: 'sm' | 'md'; className?: string }) {
  const dims = size === 'md' ? 'h-10 w-10 text-xl' : 'h-8 w-8 text-base';
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full bg-brand font-display font-extrabold leading-none text-white ${dims} ${className}`}
    >
      {n}
    </span>
  );
}

const headerSizes = {
  lg: { seal: 26, title: 'text-[26px] md:text-[30px]' },
  md: { seal: 22, title: 'text-[23px] md:text-[26px]' },
  sm: { seal: 18, title: 'text-[20px] md:text-[22px]' },
} as const;

/** Section title, opened by the seal mark. */
export function SectionHeader({
  title,
  id,
  size = 'lg',
  href,
  subtitle,
  rule = true,
  children,
  className = '',
}: {
  title: string;
  id?: string;
  size?: keyof typeof headerSizes;
  href?: string;
  subtitle?: string;
  /** The black line that runs from the title to the far edge. */
  rule?: boolean;
  children?: ReactNode;
  className?: string;
}) {
  const s = headerSizes[size];
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <SealDot size={s.seal} />
      <h2 id={id} className={`font-display font-extrabold leading-none ${s.title}`}>
        {title}
      </h2>
      {subtitle ? <span className="hidden text-sm text-muted md:inline">{subtitle}</span> : null}
      {rule ? <span aria-hidden="true" className="h-0.5 flex-1 bg-ink" /> : null}
      {href ? (
        <Link href={href} className="whitespace-nowrap text-[13px] font-extrabold text-brand hover:text-brand-deep">
          לכל הכתבות
        </Link>
      ) : null}
      {children}
    </div>
  );
}

export function CategoryTag({ name, className = '', dark = false }: { name: string; className?: string; dark?: boolean }) {
  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-extrabold text-white ${dark ? 'bg-ink' : 'bg-brand'} ${className}`}
    >
      {name}
    </span>
  );
}

export function PublishedTime({ iso, className = '' }: { iso: string; className?: string }) {
  return (
    <time dateTime={iso} className={`font-mono ${className}`}>
      {formatPublished(iso)}
    </time>
  );
}

export function Byline({ article, className = '' }: { article: ArticleCard; className?: string }) {
  return (
    <span className={`text-[13px] text-muted ${className}`}>
      {article.author ? <>מאת {article.author.name} · </> : null}
      <PublishedTime iso={article.publishedAt} />
    </span>
  );
}

/** next/image when the article has an image; a toned placeholder otherwise. */
export function ArticleImage({
  article,
  sizes,
  priority = false,
  ratio = '16 / 9',
  iconSize = 28,
  className = '',
  children,
}: {
  article: Pick<ArticleCard, 'id' | 'image'>;
  sizes: string;
  priority?: boolean;
  ratio?: string;
  iconSize?: number;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={`relative max-w-full overflow-hidden ${className}`}
      style={{ aspectRatio: ratio, background: toneBackground(article.id) }}
    >
      {article.image ? (
        <Image
          src={article.image.url}
          alt={article.image.alt}
          fill
          sizes={sizes}
          priority={priority}
          className="object-cover"
        />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-white/30">
          <PhotoIcon size={iconSize} />
        </span>
      )}
      {children}
    </div>
  );
}

export function AdSlot({ size = '300×250' }: { size?: string }) {
  return (
    <div className="flex h-[250px] flex-col items-center justify-center gap-1 rounded-[10px] border-[1.5px] border-dashed border-[#CFCCC7] bg-[#FAF9F8] text-muted">
      <span className="text-xs font-bold tracking-[.08em]">פרסומת</span>
      <span className="font-mono text-[13px]">{size}</span>
    </div>
  );
}
