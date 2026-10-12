import Image from 'next/image';
import Link from 'next/link';
import type { HomeSection, Podcast } from '@/lib/types';
import { articleHref, categoryHref, toneBackground } from '@/lib/site';
import { PersonIcon, PlayIcon } from './icons';
import { ArticleImage, Byline, CategoryTag, SectionHeader, wrap } from './ui';

/** Lead story with excerpt + three thumbnail rows. Used for the economy pair and the trio. */
export function CategoryBlock({ section, withByline = false }: { section: HomeSection; withByline?: boolean }) {
  const [lead, ...list] = section.items;
  if (!lead) return null;
  return (
    <section className="flex min-w-0 flex-col gap-4" aria-label={section.category.name}>
      <SectionHeader title={section.category.name} size="md" href={categoryHref(section.category.slug)} />
      <Link href={articleHref(lead)} className="group flex flex-col gap-2.5">
        <ArticleImage article={lead} sizes="(min-width: 1280px) 420px, (min-width: 768px) 50vw, 100vw" iconSize={32} className="rounded-[10px]" />
        <h3 className="text-balance text-[21px] font-extrabold leading-[1.3] transition-colors group-hover:text-brand md:text-[22px]">
          {lead.title}
        </h3>
        {lead.excerpt ? <p className="text-[15px] leading-relaxed text-ink-2">{lead.excerpt}</p> : null}
        {withByline ? <Byline article={lead} /> : null}
      </Link>
      <ul className="flex flex-col">
        {list.slice(0, 3).map((a) => (
          <li key={a.id} className="border-t border-line py-3">
            <Link href={articleHref(a)} className="group flex items-center gap-3.5">
              <ArticleImage article={a} sizes="96px" ratio="3 / 2" iconSize={18} className="w-[88px] shrink-0 rounded md:w-24" />
              <h4 className="text-[15px] font-bold leading-snug transition-colors group-hover:text-brand md:text-base">{a.title}</h4>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** שוק ההון: four cards with excerpts. */
export function CapitalGrid({ section }: { section: HomeSection }) {
  return (
    <section aria-labelledby="capital-title" className={`${wrap} pb-3 pt-10`}>
      <SectionHeader id="capital-title" title={section.category.name} href={categoryHref(section.category.slug)} className="mb-5" />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-7">
        {section.items.slice(0, 4).map((a) => (
          <Link key={a.id} href={articleHref(a)} className="group flex min-w-0 flex-col gap-2.5">
            <ArticleImage article={a} sizes="(min-width: 1280px) 300px, (min-width: 768px) 50vw, 100vw" className="rounded-[10px]" />
            <h3 className="text-balance text-lg font-extrabold leading-[1.35] transition-colors group-hover:text-brand">{a.title}</h3>
            {a.excerpt ? <p className="text-sm leading-relaxed text-ink-2">{a.excerpt}</p> : null}
            <Byline article={a} />
          </Link>
        ))}
      </div>
    </section>
  );
}

/** תיירות: a wide travel feature (big lead image) beside a list. */
export function TourismFeature({ section }: { section: HomeSection }) {
  const [lead, ...rest] = section.items;
  if (!lead) return null;
  return (
    <section aria-labelledby="tourism-title" className={`${wrap} pb-3 pt-12`}>
      <SectionHeader id="tourism-title" title={section.category.name} href={categoryHref(section.category.slug)} className="mb-5" />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Link
          href={articleHref(lead)}
          className="group relative flex min-h-[340px] flex-col justify-end overflow-hidden rounded-xl p-6 text-white md:min-h-[400px] md:p-8"
          style={{ background: toneBackground(lead.id) }}
        >
          {lead.image ? (
            <Image src={lead.image.url} alt={lead.image.alt} fill sizes="(min-width: 1280px) 760px, 100vw" className="object-cover" />
          ) : (
            <span aria-hidden="true" className="absolute left-1/2 top-[38%] -translate-x-1/2 -translate-y-1/2">
              {/* eslint-disable-next-line @next/next/no-img-element -- static SVG mark */}
              <img src="/brand/b4-mark.svg" alt="" width={100} height={100} className="h-[100px] w-[100px] opacity-25 grayscale" />
            </span>
          )}
          <span aria-hidden="true" className="absolute inset-0 bg-linear-to-b from-ink/10 from-15% via-ink/60 via-50% to-ink/95" />
          <h3 className="relative max-w-[24ch] text-balance text-[26px] font-extrabold leading-[1.15] md:text-[32px]">{lead.title}</h3>
          {lead.excerpt ? <p className="relative mt-3 max-w-[56ch] text-base leading-relaxed text-[#E6E6EB]">{lead.excerpt}</p> : null}
        </Link>
        <ul className="flex flex-col">
          {rest.slice(0, 4).map((a) => (
            <li key={a.id} className="border-b border-line py-3.5 first:pt-0">
              <Link href={articleHref(a)} className="group flex items-center gap-4">
                <ArticleImage article={a} sizes="120px" ratio="4 / 3" iconSize={20} className="w-28 shrink-0 rounded-lg" />
                <div className="flex min-w-0 flex-col gap-1">
                  <h4 className="text-base font-bold leading-snug transition-colors group-hover:text-brand md:text-[17px]">{a.title}</h4>
                  <Byline article={a} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** בריאות / רכב / בידור / צרכנות: one image and two headlines each. */
export function CompactCategory({ section }: { section: HomeSection }) {
  const [lead, ...list] = section.items;
  if (!lead) return null;
  return (
    <section className="flex min-w-0 flex-col gap-3.5" aria-label={section.category.name}>
      <Link href={categoryHref(section.category.slug)} className="hover:text-brand">
        <SectionHeader title={section.category.name} size="sm" />
      </Link>
      <Link href={articleHref(lead)} className="group flex flex-col gap-2.5">
        <ArticleImage article={lead} sizes="(min-width: 1280px) 300px, (min-width: 768px) 50vw, 100vw" className="rounded-[10px]" />
        <h3 className="text-balance text-lg font-extrabold leading-[1.35] transition-colors group-hover:text-brand">{lead.title}</h3>
      </Link>
      <ul className="flex flex-col">
        {list.slice(0, 2).map((a) => (
          <li key={a.id} className="border-t border-line py-2.5">
            <Link href={articleHref(a)} className="text-[15px] font-semibold leading-snug hover:text-brand">
              {a.title}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** B4 TALK podcast band (dark). */
export function PodcastBand({ podcasts }: { podcasts: Podcast[] }) {
  if (podcasts.length === 0) return null;
  return (
    <section aria-labelledby="talk-title" className="on-dark mt-10 bg-ink text-white">
      <div className={`${wrap} py-11`}>
        <div className="mb-6 flex flex-wrap items-end gap-x-4 gap-y-2">
          <h2 id="talk-title" dir="ltr" className="flex items-center gap-2.5 text-[28px] font-extrabold leading-none">
            {/* eslint-disable-next-line @next/next/no-img-element -- static SVG seal */}
            <img src="/brand/b4-mark.svg" alt="B4" width={40} height={40} className="h-10 w-10" />
            <span>TALK</span>
          </h2>
          <span className="text-[15px] text-mist">פודקאסטים ושיחות עם האנשים שמזיזים את הכלכלה</span>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-5">
          {podcasts.map((p, i) => (
            <a key={p.id} href={p.href} className="group flex items-center gap-4 rounded-lg bg-night p-3.5 hover:bg-[#232328]">
              <div className="relative h-28 w-28 shrink-0 rounded-[10px]" style={{ background: toneBackground(i + 4) }}>
                <span className="absolute bottom-2 left-2 flex h-10 w-10 items-center justify-center rounded-full bg-brand text-white">
                  <PlayIcon size={16} />
                </span>
              </div>
              <div className="flex min-w-0 flex-col gap-1.5">
                <span className="text-xs font-extrabold text-[#FF5A63]">{p.show}</span>
                <h3 className="text-[17px] font-bold leading-snug text-white">{p.title}</h3>
                <span className="text-[13px] text-[#9A9AA3]">{p.meta}</span>
              </div>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

/** "היועצים" (opinion cards) beside "המנכ״ל החדש" (interview lead + two). */
export function ColumnsSection({ consultants, ceo }: { consultants?: HomeSection; ceo?: HomeSection }) {
  if (!consultants && !ceo) return null;
  return (
    <section aria-label="מדורים קבועים" className="mt-10 bg-stone">
      <div className={`${wrap} grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] gap-10 py-12`}>
        {consultants ? (
          <div className="flex min-w-0 flex-col gap-4">
            <ColumnHeader section={consultants} subtitle="מדור היועצים של שוק ההון: דעה, ניתוח והמלצה" />
            {consultants.items.slice(0, 3).map((a) => (
              <Link key={a.id} href={articleHref(a)} className="group flex items-start gap-4 rounded-lg bg-white p-[18px]">
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#E9E7E4] text-[#8C8A86] shadow-[0_0_0_3px_#fff,0_0_0_5px_var(--color-brand)]">
                  <PersonIcon size={28} />
                </span>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <h3 className="text-[19px] font-extrabold leading-[1.35] transition-colors group-hover:text-brand">
                    <span aria-hidden="true" className="me-1 align-[-6px] font-display text-[30px] leading-[0] text-brand">
                      ״
                    </span>
                    {a.title}
                  </h3>
                  {a.author ? (
                    <span className="text-sm text-ink-2">
                      <strong className="font-bold text-ink">{a.author.name}</strong>
                      {a.author.title ? <> · {a.author.title}</> : null}
                    </span>
                  ) : null}
                </div>
              </Link>
            ))}
          </div>
        ) : null}

        {ceo && ceo.items[0] ? (
          <div className="flex min-w-0 flex-col gap-4">
            <ColumnHeader section={ceo} subtitle="ראיונות עם מנהלים בחודשים הראשונים בתפקיד" />
            <Link href={articleHref(ceo.items[0])} className="group flex flex-col overflow-hidden rounded-lg bg-white">
              <ArticleImage article={ceo.items[0]} sizes="(min-width: 1280px) 600px, 100vw" iconSize={32}>
                <CategoryTag name="ראיון" dark className="absolute right-3 top-3" />
              </ArticleImage>
              <div className="flex flex-col gap-1.5 px-[18px] pb-[18px] pt-4">
                <h3 className="text-balance text-[21px] font-extrabold leading-[1.3] transition-colors group-hover:text-brand">
                  {ceo.items[0].title}
                </h3>
                <AuthorLine section={ceo} index={0} />
              </div>
            </Link>
            {ceo.items.slice(1, 3).map((a, i) => (
              <Link key={a.id} href={articleHref(a)} className="group flex items-center gap-3.5 rounded-lg bg-white px-[18px] py-3.5">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#E9E7E4] text-[#8C8A86]">
                  <PersonIcon size={24} />
                </span>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <h3 className="text-[17px] font-bold leading-[1.35] transition-colors group-hover:text-brand">{a.title}</h3>
                  <AuthorLine section={ceo} index={i + 1} small />
                </div>
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ColumnHeader({ section, subtitle }: { section: HomeSection; subtitle: string }) {
  return (
    <div className="flex flex-col gap-1">
      <Link href={categoryHref(section.category.slug)} className="hover:text-brand">
        <SectionHeader title={section.category.name} size="lg" />
      </Link>
      <span className="ps-[22px] text-sm text-muted">{subtitle}</span>
    </div>
  );
}

function AuthorLine({ section, index, small = false }: { section: HomeSection; index: number; small?: boolean }) {
  const author = section.items[index]?.author;
  if (!author) return null;
  return (
    <span className={`${small ? 'text-[13px]' : 'text-sm'} text-ink-2`}>
      <strong className="font-bold text-ink">{author.name}</strong>
      {author.title ? <> · {author.title}</> : null}
    </span>
  );
}
