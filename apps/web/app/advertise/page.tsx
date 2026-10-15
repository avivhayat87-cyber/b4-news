// "פרסמו אצלנו": the page businesses reach from the house banners. Why advertise here, the ad
// formats and where they appear, how it works, the form (it lands in the CMS and emails the
// admins), and the usual questions. Built here rather than in the CMS's info pages, because it is
// a page that sells. Every claim on it is something the ad system really does.
import { adSize } from '@b4/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { FormatMock, PageMock } from '@/components/advertise-visuals';
import { AdvertiseForm } from '@/components/advertise-form';
import { wrap } from '@/components/ui';
import { getSite } from '@/lib/api';

export const revalidate = 600;

export const metadata: Metadata = {
  title: 'פרסמו אצלנו',
  description: 'באנרים, מודעות עם טופס פניות ופרסום לפי מדור באתר ובאפליקציה של B4 NEW\'S. השאירו פרטים ונחזור אליכם עם הצעה.',
  alternates: { canonical: '/advertise' },
};

const WHY = [
  { title: 'קהל ברגע של החלטה', body: 'מי שקורא על ריבית, דירות, ביטוח או השקעות נמצא בדרך להחליט. המודעה שלכם פוגשת אותו בדיוק שם.' },
  { title: 'במדור שמתאים לכם', body: 'נדל״ן, ביטוח, שוק ההון, הייטק, רכב, צרכנות ועוד. אתם בוחרים איפה להופיע, ולא מתפזרים בכל מקום.' },
  { title: 'סביבה נקייה ומכובדת', body: 'לכל היותר שתי מודעות בעמוד, בלי חלונות קופצים ובלי מודעות שרודפות אחרי הקורא. מודעה שלא נאבקת על תשומת לב נקראת.' },
  { title: 'שקיפות מלאה', body: 'עמוד דוח אישי: צפיות שנספרות רק כשהמודעה באמת נראתה על המסך, לחיצות ופניות, בכל רגע שתרצו.' },
];

const FORMATS = [
  { kind: 'billboard', title: 'באנר רחב', where: 'בראש דף הבית ובראש כל מדור', size: `${adSize(970, 250)} במחשב · ${adSize(320, 100)} בנייד` },
  { kind: 'rectangle', title: 'מלבן בטור הצד', where: 'ליד הכתבות, ובטור הצד של דף הבית והמדורים', size: adSize(300, 250) },
  { kind: 'native', title: 'מודעה בסגנון כתבה', where: 'בסוף כתבות ובאפליקציה: תמונה, כותרת, שורה וכפתור', size: 'משתלבת בקריאה, ומסומנת בבירור' },
  { kind: 'lead', title: 'מודעה עם טופס פניות', where: 'הקורא משאיר שם וטלפון בתוך המודעה, בלי לצאת מהאתר', size: 'הפנייה מגיעה אליכם למייל ולדוח' },
] as const;

const STEPS = [
  { title: 'משאירים פרטים', body: 'שם וטלפון מספיקים. נחזור אליכם.' },
  { title: 'בונים את הקמפיין', body: 'בוחרים יחד מקום, מדורים ותאריכים, ומכינים את המודעה. אין לכם באנר? נעצב אחד בסגנון נקי שמתאים לאתר.' },
  { title: 'המודעה עולה', body: 'אחרי בדיקה ואישור שלנו, בתאריכים שקבעתם.' },
  { title: 'עוקבים בזמן אמת', body: 'קישור אישי לדוח: צפיות, לחיצות ופניות, מתעדכן כל הזמן.' },
];

const FAQ = [
  { q: 'כמה זה עולה?', a: 'המחיר נקבע לפי המקום, המדורים ומשך הקמפיין. השאירו פרטים, ונחזור עם הצעה שמתאימה לכם.' },
  { q: 'אפשר לפרסם רק במדור אחד?', a: 'כן. אפשר לבחור מדור אחד או כמה, והמודעה תופיע רק בעמודים שלהם.' },
  { q: 'המודעה מסומנת כפרסומת?', a: 'כן. כל מודעה מסומנת "פרסומת" עם שם המפרסם, כמו שהחוק מחייב. זה גם מה שבונה אמון אצל הקוראים.' },
  { q: 'מה קורה עם הפניות מהקוראים?', a: 'במודעה עם טופס, הקורא מאשר במפורש שתחזרו אליו. הפרטים מגיעים רק אליכם: במייל ובעמוד הדוח שלכם.' },
  { q: 'איך יודעים שזה עובד?', a: 'לכל מפרסם יש עמוד דוח אישי עם המספרים. צפייה נספרת רק כשלפחות חצי מהמודעה הייתה על המסך שנייה שלמה, לפי התקן המקובל בעולם.' },
];

export default async function AdvertisePage() {
  const site = await getSite();
  const { email, phone } = site.contact;

  return (
    <>
      {/* Hero */}
      <section className="on-dark overflow-hidden bg-[linear-gradient(120deg,#141417_0%,#1C1C20_55%,#3B1418_100%)] text-white">
        <div className={`${wrap} grid items-center gap-10 py-14 md:py-20 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]`}>
          <div className="flex flex-col gap-5">
            <span className="text-sm font-bold tracking-[.1em] text-[#FF5A63]">פרסום ב-B4 NEW&apos;S</span>
            <h1 className="text-balance text-[36px] font-extrabold leading-[1.1] md:text-[52px]">הגיעו לקוראים שמקבלים החלטות כלכליות</h1>
            <p className="max-w-[58ch] text-[18px] leading-relaxed text-mist">
              B4 NEW&apos;S הוא אתר ואפליקציית חדשות כלכלה בעברית. הקוראים שלנו מגיעים כדי להבין מה קורה עם הכסף שלהם: משכנתאות, השקעות, ביטוח, נדל״ן, צרכנות ועבודה. זה בדיוק הרגע לפגוש אותם.
            </p>
            <div className="flex flex-wrap gap-3 pt-1">
              <a href="#contact" className="inline-flex h-12 items-center rounded-full bg-brand px-7 font-extrabold text-white hover:bg-brand-bright">
                השאירו פרטים
              </a>
              <a href="#formats" className="inline-flex h-12 items-center rounded-full border-2 border-white/40 px-7 font-extrabold text-white hover:border-white">
                איך זה נראה
              </a>
            </div>
            <ul className="flex flex-wrap gap-x-6 gap-y-2 pt-2 text-[15px] text-mist">
              {['פרסום לפי מדור', 'טופס פניות ישירות אליכם', 'דוח אישי עם מספרים אמיתיים'].map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <span className="text-[#FF5A63]" aria-hidden="true">
                    ✓
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex justify-center lg:justify-start">
            <PageMock />
          </div>
        </div>
      </section>

      {/* Why */}
      <section aria-labelledby="why-title" className={`${wrap} py-14 md:py-20`}>
        <h2 id="why-title" className="text-[30px] font-extrabold md:text-[38px]">
          למה לפרסם אצלנו
        </h2>
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {WHY.map((w, i) => (
            <div key={w.title} className="flex flex-col gap-3 rounded-[14px] border border-line p-6">
              <span className="font-display text-[34px] font-extrabold leading-none text-brand">{String(i + 1).padStart(2, '0')}</span>
              <h3 className="text-[20px] font-extrabold">{w.title}</h3>
              <p className="text-[16px] leading-relaxed text-ink-2">{w.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Formats */}
      <section id="formats" aria-labelledby="formats-title" className="scroll-mt-20 bg-stone">
        <div className={`${wrap} py-14 md:py-20`}>
          <h2 id="formats-title" className="text-[30px] font-extrabold md:text-[38px]">
            סוגי מודעות ואיפה הן מופיעות
          </h2>
          <p className="mt-3 max-w-[60ch] text-[17px] text-ink-2">כל המקומות קבועים ושקטים, באתר ובאפליקציה. אפשר לשלב כמה סוגים באותו קמפיין, ולראות איזה מהם עובד טוב יותר.</p>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {FORMATS.map((f) => (
              <div key={f.kind} className="flex flex-col gap-4 rounded-[14px] bg-white p-6">
                <div className="flex h-28 items-center">
                  <div className="w-full">
                    <FormatMock kind={f.kind} />
                  </div>
                </div>
                <h3 className="text-[20px] font-extrabold">{f.title}</h3>
                <p className="text-[16px] leading-relaxed text-ink-2">{f.where}</p>
                <p className="mt-auto text-sm font-bold text-muted">{f.size}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section aria-labelledby="how-title" className={`${wrap} py-14 md:py-20`}>
        <h2 id="how-title" className="text-[30px] font-extrabold md:text-[38px]">
          איך זה עובד
        </h2>
        <ol className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-ink font-display text-lg font-extrabold text-white">{i + 1}</span>
              <span className="flex flex-col gap-1.5 pt-1.5">
                <span className="text-[19px] font-extrabold">{s.title}</span>
                <span className="text-[16px] leading-relaxed text-ink-2">{s.body}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      {/* Contact */}
      <section id="contact" aria-labelledby="contact-title" className="scroll-mt-20 border-y border-line bg-[linear-gradient(180deg,#FFFFFF,#F4F3F1)]">
        <div className={`${wrap} grid gap-10 py-14 md:py-20 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]`}>
          <div className="rounded-[16px] bg-white p-6 shadow-[0_10px_40px_-18px_rgba(0,0,0,.25)] ring-1 ring-line md:p-10">
            <h2 id="contact-title" className="text-[30px] font-extrabold md:text-[36px]">
              בואו נדבר על פרסום
            </h2>
            <p className="mb-7 mt-2 text-[17px] text-ink-2">שם וטלפון מספיקים כדי שנחזור אליכם. כל השאר עוזר לנו להגיע עם הצעה מדויקת.</p>
            <AdvertiseForm />
          </div>
          <aside className="flex flex-col gap-6 lg:pt-6">
            <div className="flex items-center gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element -- static SVG mark */}
              <img src="/brand/b4-mark.svg" alt="" width={56} height={56} />
              <p className="font-display text-[22px] font-extrabold leading-tight">חדשות. כלכלה. לפני כולם.</p>
            </div>
            <ul className="flex flex-col gap-3 text-[16px] text-ink-2">
              {['פרסום לפי מדור ולפי מכשיר', 'מודעות עם טופס פניות, ישירות אליכם', 'עמוד דוח אישי לכל מפרסם', 'עיצוב באנר בסגנון האתר, אם אין לכם'].map((t) => (
                <li key={t} className="flex items-start gap-2.5">
                  <span className="mt-0.5 text-brand" aria-hidden="true">
                    ✓
                  </span>
                  {t}
                </li>
              ))}
            </ul>
            {email || phone ? (
              <div className="rounded-[12px] bg-ink p-5 text-white">
                <p className="font-bold">מעדיפים לדבר ישירות?</p>
                <dl className="mt-2 space-y-1 text-[16px]">
                  {phone ? (
                    <div className="flex gap-2">
                      <dt className="text-mist">טלפון:</dt>
                      <dd dir="ltr">
                        <a href={`tel:${phone.replace(/[^\d+]/g, '')}`} className="underline underline-offset-2">
                          {phone}
                        </a>
                      </dd>
                    </div>
                  ) : null}
                  {email ? (
                    <div className="flex gap-2">
                      <dt className="text-mist">מייל:</dt>
                      <dd dir="ltr">
                        <a href={`mailto:${email}`} className="underline underline-offset-2">
                          {email}
                        </a>
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </div>
            ) : null}
          </aside>
        </div>
      </section>

      {/* Questions */}
      <section aria-labelledby="faq-title" className={`${wrap} py-14 md:py-20`}>
        <h2 id="faq-title" className="text-[30px] font-extrabold md:text-[38px]">
          שאלות נפוצות
        </h2>
        <div className="mt-6 max-w-[820px] divide-y divide-line border-y border-line">
          {FAQ.map((f) => (
            <details key={f.q} className="group py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[19px] font-extrabold">
                {f.q}
                <span className="text-2xl text-brand transition-transform group-open:rotate-45" aria-hidden="true">
                  +
                </span>
              </summary>
              <p className="mt-3 text-[17px] leading-relaxed text-ink-2">{f.a}</p>
            </details>
          ))}
        </div>
        <p className="mt-8 text-sm text-muted">
          עוד פרטים על האתר:{' '}
          <Link href="/about" className="underline underline-offset-2 hover:text-ink">
            אודות
          </Link>
          {' · '}
          <Link href="/terms" className="underline underline-offset-2 hover:text-ink">
            תנאי השימוש
          </Link>
          {' · '}
          <Link href="/privacy" className="underline underline-offset-2 hover:text-ink">
            מדיניות הפרטיות
          </Link>
        </p>
      </section>
    </>
  );
}
