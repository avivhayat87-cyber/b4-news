import Link from 'next/link';
import { getSite } from '@/lib/api';
import { CATEGORIES, SITE, categoryHref, socialLinks } from '@/lib/site';
import { ManageConsentButton } from './consent-banner';
import { NewsletterForm } from './newsletter-form';
import { SocialLinks } from './sidebar';
import { wrap } from './ui';

const outlineButton =
  'inline-flex h-12 items-center rounded-full border-2 border-white px-[22px] text-[15px] font-extrabold text-white hover:bg-white/10 focus-visible:outline-white';

/** Footer opens with the red app banner, as in the owner's design. Every link comes from the CMS; empty ones are hidden. */
export async function SiteFooter() {
  const site = await getSite();
  const { links } = site;
  const appLink = links.appStore || links.googlePlay;
  const hasSocial = socialLinks(links).length > 0;

  return (
    <footer className="on-dark mt-10 bg-ink text-mist">
      <section aria-labelledby="app-title" className="bg-brand text-white">
        <div className={`${wrap} flex flex-wrap items-center justify-between gap-x-8 gap-y-5 py-[30px]`}>
          <div className="flex min-w-0 flex-[1_1_420px] items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- static SVG icon */}
            <img src="/brand/b4-icon.svg" alt="" width={64} height={64} className="hidden h-16 w-16 shrink-0 rounded-[15px] shadow-[0_0_0_2px_#fff] sm:block" />
            <div className="flex min-w-0 flex-col gap-1.5">
              <h2 id="app-title" className="text-[26px] font-extrabold leading-tight md:text-[32px]">
                המבזקים של {SITE.short}, ישר אליכם
              </h2>
              <p className="text-base leading-relaxed text-white">
                {appLink ? 'הורידו את האפליקציה וקבלו התראה על כל מבזק, או הצטרפו לערוצים שלנו.' : 'הצטרפו לניוזלטר ולערוצים שלנו, ותהיו הראשונים לדעת.'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            {links.appStore ? (
              <a href={links.appStore} target="_blank" rel="noopener noreferrer" className="inline-flex h-12 items-center rounded-full bg-white px-[22px] text-[15px] font-extrabold text-ink hover:bg-brand-soft">
                {links.googlePlay ? 'App Store' : 'הורדת האפליקציה'}
              </a>
            ) : null}
            {links.googlePlay ? (
              <a href={links.googlePlay} target="_blank" rel="noopener noreferrer" className="inline-flex h-12 items-center rounded-full bg-white px-[22px] text-[15px] font-extrabold text-ink hover:bg-brand-soft">
                {links.appStore ? 'Google Play' : 'הורדת האפליקציה'}
              </a>
            ) : null}
            {links.telegram ? (
              <a href={links.telegram} target="_blank" rel="noopener noreferrer" className={outlineButton}>
                ערוץ הטלגרם
              </a>
            ) : null}
            {links.whatsapp ? (
              <a href={links.whatsapp} target="_blank" rel="noopener noreferrer" className={outlineButton}>
                ערוץ הוואטסאפ
              </a>
            ) : null}
            {!appLink && !links.telegram && !links.whatsapp ? (
              <a href="#newsletter" className="inline-flex h-12 items-center rounded-full bg-white px-[22px] text-[15px] font-extrabold text-ink hover:bg-brand-soft">
                הרשמה לניוזלטר
              </a>
            ) : null}
          </div>
        </div>
      </section>

      <div className={`${wrap} flex flex-wrap gap-x-14 gap-y-9 pb-7 pt-12`}>
        <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-3.5">
          {/* eslint-disable-next-line @next/next/no-img-element -- static SVG logo */}
          <img src="/brand/b4-logo-dark.svg" alt={SITE.name} width={180} height={67} className="block h-auto w-[180px] max-w-full" />
          <p className="max-w-[40ch] text-[15px] leading-relaxed">{SITE.description}</p>
          {hasSocial ? <SocialLinks variant="outline" links={links} /> : null}
          {site.contact.email || site.contact.phone ? (
            <p className="text-[15px]">
              {site.contact.email ? (
                <a href={`mailto:${site.contact.email}`} className="hover:text-white" dir="ltr">
                  {site.contact.email}
                </a>
              ) : null}
              {site.contact.email && site.contact.phone ? ' · ' : null}
              {site.contact.phone ? (
                <a href={`tel:${site.contact.phone.replace(/[^\d+]/g, '')}`} className="hover:text-white" dir="ltr">
                  {site.contact.phone}
                </a>
              ) : null}
            </p>
          ) : null}
        </div>

        <nav aria-label="מדורים בתחתית העמוד" className="min-w-0 flex-[1_1_260px]">
          <h2 className="mb-3 text-sm font-extrabold tracking-[.04em] text-white">מדורים</h2>
          <ul className="grid grid-cols-2 gap-x-5 gap-y-2 text-[15px]">
            {CATEGORIES.map((c) => (
              <li key={c.slug}>
                <Link href={categoryHref(c.slug)} className="hover:text-white">
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {site.pages.length > 0 ? (
          <nav aria-label="מידע" className="min-w-0 flex-[0_1_160px]">
            <h2 className="mb-3 text-sm font-extrabold tracking-[.04em] text-white">{SITE.name}</h2>
            <ul className="flex flex-col gap-2 text-[15px]">
              {site.pages.map((p) => (
                <li key={p.slug}>
                  <Link href={`/${p.slug}`} className="hover:text-white">
                    {p.title}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}

        <section id="newsletter" aria-labelledby="nl-footer-title" className="flex min-w-0 flex-[1_1_260px] scroll-mt-24 flex-col gap-2.5">
          <h2 id="nl-footer-title" className="text-sm font-extrabold tracking-[.04em] text-white">
            ניוזלטר
          </h2>
          <p className="text-[15px] leading-relaxed">הכתבות החשובות של היום, פעם ביום.</p>
          <NewsletterForm id="nl-email-footer" layout="inline" />
        </section>
      </div>
      <div className="border-t border-[#2A2A2F]">
        <div className={`${wrap} flex flex-wrap justify-between gap-x-6 gap-y-2 py-4 text-[13px] text-[#9A9AA3]`}>
          <span>
            © {new Date().getFullYear()} {SITE.name}. כל הזכויות שמורות.
          </span>
          <nav aria-label="חשבון ופרטיות" className="flex flex-wrap gap-x-4 gap-y-1">
            <Link href="/account" className="hover:text-white">
              החשבון שלי
            </Link>
            <Link href="/report" className="hover:text-white">
              דיווח על תוכן
            </Link>
            <ManageConsentButton className="hover:text-white" />
          </nav>
          <span>איורים המסומנים ״AI״ נוצרו בכלי בינה מלאכותית</span>
        </div>
      </div>
    </footer>
  );
}
