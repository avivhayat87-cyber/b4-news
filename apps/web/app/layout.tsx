import type { Metadata, Viewport } from 'next';
import { Heebo, IBM_Plex_Mono, Rubik } from 'next/font/google';
import { SiteFooter } from '@/components/footer';
import { SiteHeader } from '@/components/header';
import { SITE } from '@/lib/site';
import './globals.css';

const heebo = Heebo({ subsets: ['hebrew', 'latin'], variable: '--font-heebo', display: 'swap' });
// Headings: Rubik's rounded geometry matches the letters in the B4 seal.
const rubik = Rubik({ subsets: ['hebrew', 'latin'], weight: ['700', '800'], variable: '--font-rubik', display: 'swap' });
const plexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: '500', variable: '--font-plex-mono', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: `${SITE.name} · ${SITE.tagline}`, template: `%s · ${SITE.name}` },
  description: SITE.description,
  openGraph: { siteName: SITE.name, locale: 'he_IL', type: 'website' },
  alternates: { canonical: '/' },
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
      </body>
    </html>
  );
}
