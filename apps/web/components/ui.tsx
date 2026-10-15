import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { ArticleCard } from '@/lib/types';
import { toneBackground } from '@/lib/site';
import { formatPublished } from '@/lib/format';

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

/** Said after a link that opens a new window, for screen readers (in aria-label, or via NewWindowHint). */
export const NEW_WINDOW = ' (נפתח בחלון חדש)';

export function NewWindowHint() {
  return <span className="sr-only">{NEW_WINDOW}</span>;
}

/** Section title, opened by the seal mark. */
export function SectionHeader({
  title,
  id,
  size = 'lg',
  href,
  subtitle,
  rule = true,
  as: Heading = 'h2',
  children,
  className = '',
}: {
  title: string;
  id?: string;
  /** h1 where the section is the page itself (a category, search). */
  as?: 'h1' | 'h2';
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
      <Heading id={id} className={`font-display font-extrabold leading-none ${s.title}`}>
        {title}
      </Heading>
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
          // The page's main picture: fetched first (Next 16's `priority` only preloads, at low priority).
          loading={priority ? 'eager' : undefined}
          fetchPriority={priority ? 'high' : undefined}
          className="object-cover"
        />
      ) : (
        // No image yet: the brand seal as a quiet watermark, so the card still looks intentional.
        <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- static SVG mark */}
          <img src="/brand/b4-mark.svg" alt="" width={iconSize * 2.4} height={iconSize * 2.4} className="opacity-25 grayscale" style={{ width: `${iconSize * 2.4}px`, height: 'auto' }} />
        </span>
      )}
      {children}
    </div>
  );
}

/**
 * A wide ad place with no campaign in it (the home page, the top of a section): a thin house strip
 * at most the size of a leaderboard (970x90), inviting businesses to advertise, in the section's
 * words on a section page. It never pushes the news down more than a real ad would: on a phone
 * it keeps to one short line, close to a 320x50 banner.
 */
export function HouseBillboard({ section }: { section?: { slug: string; name: string } }) {
  // The phone gets a shorter line (measured to fit a 375px screen with the longest section name).
  const [short, full] = section
    ? [`מפרסמים בתחום ${section.name}?`, `מפרסמים בתחום ${section.name}? זה המקום שלכם.`]
    : ['רוצים להגיע לקוראים שלנו?', 'הקוראים שלנו מקבלים החלטות כלכליות. הגיעו אליהם.'];
  return (
    <Link
      href={section ? `/advertise?section=${section.slug}#contact` : '/advertise'}
      className="on-dark group relative mx-auto flex max-w-[970px] items-center justify-between gap-2.5 overflow-hidden rounded-[10px] bg-[linear-gradient(115deg,#1C1C20_0%,#26262C_55%,#3B1418_100%)] px-3 py-2 text-white sm:px-4 md:min-h-[90px] md:gap-4 md:px-7 md:py-3"
    >
      <div className="flex items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- static SVG mark */}
        <img src="/brand/b4-mark.svg" alt="" width={40} height={40} className="hidden h-10 w-10 shrink-0 md:block" />
        <div className="flex flex-col md:gap-0.5">
          <span className="text-[10px] font-bold tracking-[.08em] text-[#FF5A63] md:text-[11px]">פרסום ב-B4 NEW&apos;S</span>
          <span className="text-balance font-display text-[14px] font-extrabold leading-tight sm:text-[15px] md:text-[19px]">
            <span className="sm:hidden">{short}</span>
            <span className="hidden sm:inline">{full}</span>
          </span>
        </div>
      </div>
      <span className="inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-full bg-white px-3 text-[13px] font-extrabold text-ink transition-colors group-hover:bg-brand group-hover:text-white md:h-9 md:px-4 md:text-sm">
        לפרטים ←
      </span>
    </Link>
  );
}

/** A side ad place with no campaign in it (AdSlot's fallback): a small house card for advertisers. */
export function HousePromo() {
  return (
    <Link href="/advertise" className="on-dark group flex items-center gap-4 rounded-[10px] bg-[linear-gradient(135deg,#1C1C20_0%,#3A3A40_100%)] p-4 text-white">
      {/* eslint-disable-next-line @next/next/no-img-element -- static SVG mark */}
      <img src="/brand/b4-mark.svg" alt="" width={40} height={40} className="h-10 w-10 shrink-0" />
      <div className="flex flex-col gap-1">
        <span className="font-display text-[17px] font-extrabold leading-tight">רוצים להגיע לקוראים של B4?</span>
        <span className="text-sm font-bold text-[#FF5A63] group-hover:underline">לפרטים על פרסום באתר ←</span>
      </div>
    </Link>
  );
}