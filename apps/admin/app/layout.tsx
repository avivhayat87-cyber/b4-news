import type { Metadata } from 'next';
import { Heebo, Rubik } from 'next/font/google';
import { Providers } from './providers';
import './globals.css';

const heebo = Heebo({ subsets: ['hebrew', 'latin'], variable: '--font-heebo', display: 'swap' });
const rubik = Rubik({ subsets: ['hebrew', 'latin'], weight: ['700', '800'], variable: '--font-rubik', display: 'swap' });

export const metadata: Metadata = {
  title: { default: "מערכת ניהול · B4 NEW'S", template: "%s · מערכת ניהול B4" },
  robots: { index: false, follow: false },
  icons: { icon: '/brand/b4-mark.svg' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" className={`${heebo.variable} ${rubik.variable}`}>
      <body className="font-sans text-[15px] leading-normal antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
