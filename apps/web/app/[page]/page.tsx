// Info pages edited in the CMS (Settings > site details): about, contact,
// advertise, accessibility, privacy, terms. Any other top-level path is a 404.
import { PAGE_SLUGS, type PageSlug } from '@b4/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AdvertiseForm } from '@/components/advertise-form';
import { wrap } from '@/components/ui';
import { getPage, getSite } from '@/lib/api';

// Not `dynamicParams = false`: under it Next 15 turns a page into "not found" the first time it
// refreshes (NoFallbackError). Other paths are turned away by isPage() instead.
export const revalidate = 600;

export function generateStaticParams() {
  return PAGE_SLUGS.map((page) => ({ page }));
}

const isPage = (page: string): page is PageSlug => (PAGE_SLUGS as readonly string[]).includes(page);

type Props = { params: Promise<{ page: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { page } = await params;
  const data = isPage(page) ? await getPage(page) : null;
  return data ? { title: data.title, alternates: { canonical: `/${page}` } } : {};
}

export default async function InfoPage({ params }: Props) {
  const { page } = await params;
  if (!isPage(page)) notFound();
  const [data, site] = await Promise.all([getPage(page), getSite()]);
  if (!data) notFound();
  const showContact = page === 'contact' || page === 'advertise';

  return (
    <div className={`${wrap} py-10`}>
      <nav aria-label="פירורי לחם" className="mb-4 text-sm text-muted">
        <Link href="/" className="hover:text-ink">
          ראשי
        </Link>
        <span aria-hidden="true"> › </span>
        <span>{data.title}</span>
      </nav>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_260px]">
        <article className="max-w-[720px]">
          <h1 className="text-[34px] font-extrabold leading-tight md:text-[42px]">{data.title}</h1>
          {/* Built on the server from a sanitized document (no raw HTML from the CMS). */}
          <div className="article-body mt-6" dangerouslySetInnerHTML={{ __html: data.bodyHtml }} />
          {showContact && (site.contact.email || site.contact.phone || site.contact.address) ? (
            <dl className="mt-8 grid gap-3 rounded-[10px] bg-stone p-5 text-[17px]">
              {site.contact.email ? (
                <div className="flex gap-3">
                  <dt className="font-bold">מייל:</dt>
                  <dd>
                    <a href={`mailto:${site.contact.email}`} className="text-brand underline" dir="ltr">
                      {site.contact.email}
                    </a>
                  </dd>
                </div>
              ) : null}
              {site.contact.phone ? (
                <div className="flex gap-3">
                  <dt className="font-bold">טלפון:</dt>
                  <dd dir="ltr">{site.contact.phone}</dd>
                </div>
              ) : null}
              {site.contact.address ? (
                <div className="flex gap-3">
                  <dt className="font-bold">כתובת:</dt>
                  <dd>{site.contact.address}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
          {page === 'advertise' ? <AdvertiseForm /> : null}
        </article>
        <aside>
          <ul className="flex flex-col gap-1 rounded-[10px] border border-line p-3 text-[15px]">
            {site.pages.map((p) => (
              <li key={p.slug}>
                <Link
                  href={`/${p.slug}`}
                  aria-current={p.slug === page ? 'page' : undefined}
                  className={`block rounded-md px-3 py-2 ${p.slug === page ? 'bg-brand-soft font-extrabold text-brand-deep' : 'hover:bg-stone'}`}
                >
                  {p.title}
                </Link>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}
