import Link from 'next/link';
import { CATEGORIES, CHANNELS, SITE, categoryHref } from '@/lib/site';
import { NewsletterForm } from './newsletter-form';
import { SocialLinks } from './sidebar';
import { wrap } from './ui';

export function AppCta() {
  return (
    <section aria-labelledby="app-title" className="mt-8 bg-brand text-white">
      <div className={`${wrap} flex flex-wrap items-center justify-between gap-x-8 gap-y-5 py-[34px]`}>
        <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-1.5">
          <h2 id="app-title" className="text-[26px] font-extrabold leading-tight md:text-[32px]">
            המבזקים של {SITE.short}, ישר לטלפון
          </h2>
          <p className="text-base leading-relaxed text-brand-soft">הורידו את האפליקציה וקבלו התראה על כל מבזק, או הצטרפו לערוצים שלנו.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <a href={CHANNELS.app} className="inline-flex h-12 items-center rounded-full bg-white px-[22px] text-[15px] font-extrabold text-ink hover:bg-brand-soft">
            הורדת האפליקציה
          </a>
          <a href={CHANNELS.telegram} className="inline-flex h-12 items-center rounded-full border-2 border-white px-[22px] text-[15px] font-extrabold text-white hover:bg-white/10 focus-visible:outline-white">
            ערוץ הטלגרם
          </a>
          <a href={CHANNELS.whatsapp} className="inline-flex h-12 items-center rounded-full border-2 border-white px-[22px] text-[15px] font-extrabold text-white hover:bg-white/10 focus-visible:outline-white">
            ערוץ הוואטסאפ
          </a>
        </div>
      </div>
    </section>
  );
}

export function SiteFooter() {
  return (
    <footer className="on-dark bg-ink text-mist">
      <div className={`${wrap} flex flex-wrap gap-x-14 gap-y-9 pb-7 pt-12`}>
        <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-3.5">
          {/* eslint-disable-next-line @next/next/no-img-element -- static SVG logo */}
          <img src="/brand/b4-logo-dark.svg" alt={SITE.name} width={180} height={67} className="block h-auto w-[180px] max-w-full" />
          <p className="max-w-[40ch] text-[15px] leading-relaxed">{SITE.description}</p>
          <SocialLinks variant="outline" />
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

        <nav aria-label="מידע" className="min-w-0 flex-[0_1_160px]">
          <h2 className="mb-3 text-sm font-extrabold tracking-[.04em] text-white">{SITE.name}</h2>
          <ul className="flex flex-col gap-2 text-[15px]">
            {[
              ['/about', 'אודות'],
              ['/contact', 'צור קשר'],
              ['/advertise', 'פרסמו אצלנו'],
              ['/accessibility', 'הצהרת נגישות'],
              ['/privacy', 'מדיניות פרטיות'],
              ['/terms', 'תנאי שימוש'],
            ].map(([href, label]) => (
              <li key={href}>
                <Link href={href} className="hover:text-white">
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <section id="newsletter" aria-labelledby="nl-footer-title" className="flex min-w-0 flex-[1_1_260px] flex-col gap-2.5">
          <h2 id="nl-footer-title" className="text-sm font-extrabold tracking-[.04em] text-white">
            ניוזלטר
          </h2>
          <p className="text-[15px] leading-relaxed">הכתבות החשובות של היום, פעם ביום.</p>
          <NewsletterForm id="nl-email-footer" layout="inline" />
        </section>
      </div>
      <div className="border-t border-[#2A2A2F]">
        <div className={`${wrap} flex flex-wrap justify-between gap-x-6 gap-y-2 py-4 text-[13px] text-[#9A9AA3]`}>
          <span>© {new Date().getFullYear()} {SITE.name}. כל הזכויות שמורות.</span>
          <span>איורים המסומנים ״בינה מלאכותית״ נוצרו בכלי AI</span>
        </div>
      </div>
    </footer>
  );
}
