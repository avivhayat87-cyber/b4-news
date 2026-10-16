import type { Metadata, Viewport } from 'next';
import { Heebo, IBM_Plex_Mono, Rubik } from 'next/font/google';
import Script from 'next/script';
import { ConsentBanner } from '@/components/consent-banner';
import { SiteFooter } from '@/components/footer';
import { SiteHeader } from '@/components/header';
import { getSite } from '@/lib/api';
import { SITE } from '@/lib/site';
import './globals.css';

const heebo = Heebo({ subsets: ['hebrew', 'latin'], variable: '--font-heebo', display: 'swap' });
// Headings: Rubik's rounded geometry matches the letters in the B4 seal.
const rubik = Rubik({ subsets: ['hebrew', 'latin'], weight: ['700', '800'], variable: '--font-rubik', display: 'swap' });
const plexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: '500', variable: '--font-plex-mono', display: 'swap' });

// The share picture of pages without their own (the home page, sections) is app/opengraph-image.jpg.
export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: `${SITE.name} · ${SITE.tagline}`, template: `%s · ${SITE.name}` },
  description: SITE.description,
  openGraph: { siteName: SITE.name, locale: 'he_IL', type: 'website' },
  twitter: { card: 'summary_large_image' },
  alternates: { canonical: '/', types: { 'application/rss+xml': [{ url: '/rss.xml', title: SITE.name }] } },
};

export const viewport: Viewport = {
  themeColor: '#D9121F',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" className={`${heebo.variable} ${rubik.variable} ${plexMono.variable}`}>
      <body className="font-sans text-base leading-normal antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:right-4 focus:top-4 focus:z-50 focus:rounded focus:bg-ink focus:px-4 focus:py-2 focus:text-white"
        >
          דילוג לתוכן
        </a>
        <SiteHeader />
        <main id="main">{children}</main>
        <SiteFooter />
        <Consent />
        <CloudflareAnalytics />
      </body>
    </html>
  );
}

async function Consent() {
  const { consent } = await getSite();
  return <ConsentBanner version={consent.version} adsCookies={consent.adsCookies} />;
}

/** Cloudflare Web Analytics, once its token is set in the CMS: visits to the whole site, cookie-free (no consent needed). */
async function CloudflareAnalytics() {
  const { analytics } = await getSite();
  if (!analytics?.cloudflareToken) return null;
  return <Script src="https://static.cloudflareinsights.com/beacon.min.js" strategy="afterInteractive" data-cf-beacon={JSON.stringify({ token: analytics.cloudflareToken })} />;
}
