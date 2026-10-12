import Image from 'next/image';
import Link from 'next/link';
import type { ArticleCard } from '@/lib/types';
import { articleHref, toneBackground } from '@/lib/site';
import { ArticleImage, Byline, CategoryTag, PublishedTime, wrap } from './ui';

/** The 7 main articles (one lead, two beside it, four below), opened by the breaking-news ticker. */
export function Hero({ articles, latest }: { articles: ArticleCard[]; latest: ArticleCard[] }) {
  const [lead, ...rest] = articles;
  if (!lead) return null;
  const side = rest.slice(0, 2);
  const row = rest.slice(2, 6);

  return (
    <section aria-label="כתבות ראשיות" className={`${wrap} pb-2 pt-5`}>
      <BreakingTicker items={latest} />

      <div className="flex flex-wrap gap-6">
        <Link
          href={articleHref(lead)}
          className="group relative flex min-h-[420px] min-w-0 flex-[2_1_560px] flex-col justify-end overflow-hidden rounded-xl px-6 pb-7 pt-9 text-white md:min-h-[540px] md:px-8"
          style={{ background: toneBackground(lead.id) }}
        >
          {lead.image ? (
            <Image
              src={lead.image.url}
              alt={lead.image.alt}
              fill
              priority
              sizes="(min-width: 1280px) 820px, 100vw"
              className="object-cover transition-transform duration-500 group-hover:scale-[1.02] motion-reduce:transition-none"
            />
          ) : (
            <span aria-hidden="true" className="absolute left-1/2 top-[34%] -translate-x-1/2 -translate-y-1/2">
              {/* eslint-disable-next-line @next/next/no-img-element -- static SVG mark */}
              <img src="/brand/b4-mark.svg" alt="" width={120} height={120} className="h-[120px] w-[120px] opacity-25 grayscale" />
            </span>
          )}
          {/* Strong enough for any photo: the headline must stay readable over bright images. */}
          <CategoryTag name={lead.category.name} className="absolute right-5 top-5 text-[13px]" />
          <h1 className="relative max-w-[20ch] text-balance [text-shadow:0_2px_16px_rgba(0,0,0,.45)] text-[34px] font-extrabold leading-[1.08] tracking-[-0.01em] md:text-[52px]">
            {lead.title}
          </h1>
          {lead.excerpt ? <p className="relative mt-3.5 max-w-[60ch] text-[17px] leading-relaxed text-[#E6E6EB] md:text-lg">{lead.excerpt}</p> : null}
          <span className="relative mt-4 text-[13px] text-[#BEBEC7]">
            {lead.author ? <>מאת {lead.author.name} · </> : null}
            <PublishedTime iso={lead.publishedAt} />
          </span>
        </Link>

        <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-6">
          {side.map((a, i) => (
            <Link key={a.id} href={articleHref(a)} className="group flex flex-col gap-2.5">
              <ArticleImage article={a} sizes="(min-width: 1280px) 400px, (min-width: 768px) 50vw, 100vw" priority={i === 0} iconSize={32} className="rounded-[10px]">
                <CategoryTag name={a.category.name} className="absolute right-3 top-3" />
              </ArticleImage>
              <h2 className="text-balance text-[21px] font-extrabold leading-[1.3] transition-colors group-hover:text-brand">{a.title}</h2>
              <Byline article={a} />
            </Link>
          ))}
        </div>
      </div>

      {row.length > 0 ? (
        <div className="mt-7 grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-6 border-t border-line pt-6">
          {row.map((a) => (
            <Link key={a.id} href={articleHref(a)} className="group flex min-w-0 flex-col gap-2">
              <ArticleImage article={a} sizes="(min-width: 1280px) 300px, (min-width: 768px) 50vw, 100vw" className="rounded-[10px]" />
              <span className="text-[13px] font-extrabold text-brand">{a.category.name}</span>
              <h2 className="text-balance text-[17px] font-bold leading-snug transition-colors group-hover:text-brand">{a.title}</h2>
            </Link>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function BreakingTicker({ items }: { items: ArticleCard[] }) {
  if (items.length === 0) return null;
  const row = (hidden: boolean) =>
    items.map((a) => (
      <span
        key={`${hidden ? 'b' : 'a'}-${a.id}`}
        aria-hidden={hidden || undefined}
        className="inline-flex items-baseline gap-2.5 whitespace-nowrap text-sm"
      >
        <PublishedTime iso={a.publishedAt} className="text-[13px] text-brand" />
        <Link href={articleHref(a)} tabIndex={hidden ? -1 : undefined} className="font-semibold hover:text-brand">
          {a.title}
        </Link>
      </span>
    ));

  return (
    <div className="mb-5 flex items-center gap-4 border-b border-line pb-3">
      <span className="inline-flex shrink-0 items-center gap-2 rounded-full bg-brand py-[5px] pe-3.5 ps-3 text-[13px] font-extrabold text-white">
        <span aria-hidden="true" className="h-2 w-2 rounded-full bg-white" />
        מבזקים
      </span>
      <div className="group min-w-0 flex-1 overflow-hidden">
        {/* Two copies so the loop is seamless; the copy is hidden from screen readers. */}
        <div className="flex w-max gap-10 animate-ticker group-hover:[animation-play-state:paused] motion-reduce:animate-none">
          {row(false)}
          {row(true)}
        </div>
      </div>
    </div>
  );
}
