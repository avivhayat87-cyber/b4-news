// Sample data so the site runs before the backend exists (API_URL empty).
// Headlines are generic examples; names in [brackets] are placeholders.

import type { ArticleCard, ArticleFull, AuthorRef, HomeData, HomeSection, MarketQuote, Tone } from './types';
import { categoryBySlug } from './site';

const NEWSROOM: AuthorRef = { slug: 'newsroom', name: 'מערכת B4' };

let nextId = 1000;
const all: ArticleCard[] = [];

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function card(
  categorySlug: string,
  title: string,
  opts: { excerpt?: string; minutes?: number; tone?: Tone; author?: AuthorRef } = {},
): ArticleCard {
  const id = ++nextId;
  const category = categoryBySlug(categorySlug) ?? { slug: categorySlug, name: categorySlug };
  const article: ArticleCard = {
    id,
    slug: `article-${id}`,
    title,
    excerpt: opts.excerpt ?? null,
    category,
    publishedAt: minutesAgo(opts.minutes ?? 60),
    author: opts.author ?? NEWSROOM,
    image: null,
    tone: opts.tone,
  };
  all.push(article);
  return article;
}

const main: ArticleCard[] = [
  card('israeli-economy', 'יוקר המחיה, הריבית והשכר: המדריך המלא לתקציב המשפחתי', {
    excerpt: 'מה באמת משפיע על ההוצאות החודשיות של משק בית, איך קוראים נכון את תלוש השכר ומה כדאי לבדוק לפני שמתחייבים להלוואה חדשה.',
    minutes: 12,
    tone: 'steel',
  }),
  card('capital-market', 'המדריך למשקיע המתחיל: כך בונים תיק השקעות מאוזן', { minutes: 37, tone: 'graphite' }),
  card('real-estate', 'לקנות או לשכור? השאלות שכדאי לשאול לפני שחותמים', { minutes: 62, tone: 'sand' }),
  card('hi-tech', 'כך משנה הבינה המלאכותית את שוק העבודה בהייטק', { minutes: 81, tone: 'plum' }),
  card('insurance', 'ביטוח בריאות פרטי: מה באמת מכוסה ומה לא', { minutes: 106, tone: 'teal' }),
  card('automotive', 'רכב חשמלי ראשון: כל מה שצריך לדעת על טעינה בבית', { minutes: 126, tone: 'graphite' }),
  card('consumerism', 'איך לחסוך בחשבון החשמל בלי לוותר על נוחות', { minutes: 151, tone: 'bronze' }),
];

const trending: ArticleCard[] = (
  [
    ['real-estate', 'הריבית והמשכנתא: מה כדאי לבדוק לפני מחזור'],
    ['capital-market', 'חמש שאלות לפני שבוחרים קרן השתלמות'],
    ['capital-market', 'המדריך לקריאת דוח רבעוני של חברה ציבורית'],
    ['real-estate', 'דירה ראשונה: המסלולים שכדאי להכיר'],
    ['israeli-economy', 'איך משווים בין מסלולי חיסכון פנסיוני'],
    ['hi-tech', 'סטארט-אפ בשלב מוקדם: כך נראה סבב גיוס'],
    ['insurance', 'ביטוח נסיעות לחו״ל: על מה לא לוותר'],
    ['automotive', 'ליסינג פרטי או קנייה: מה משתלם יותר'],
    ['consumerism', 'קניות אונליין: הזכויות שלכם בביטול עסקה'],
    ['capital-market', 'השקעה במדדים: היתרונות והחסרונות'],
    ['hi-tech', 'שכר בהייטק: איך מנהלים משא ומתן'],
    ['insurance', 'מה קובע את מחיר הפוליסה לרכב'],
    ['consumerism', 'חופשה משפחתית בתקציב: טיפים לתכנון'],
    ['capital-market', 'דמי ניהול: כמה הם עולים לכם לאורך זמן'],
  ] as const
).map(([slug, title], i) => card(slug, title, { minutes: 20 + i * 17 }));

function section(slug: string, items: ArticleCard[]): HomeSection {
  return { category: categoryBySlug(slug) ?? { slug, name: slug }, items };
}

const consultant = (name: string, title: string): AuthorRef => ({ slug: 'columnist', name, title });

const sections: HomeSection[] = [
  section('israeli-economy', [
    card('israeli-economy', 'מדד המחירים לצרכן: מה עומד מאחורי המספר ואיך הוא משפיע עליכם', {
      excerpt: 'הסבר פשוט על האופן שבו נמדדת האינפלציה, למה היא חשובה למשכנתא ולחיסכון, ומה אפשר לעשות כדי להתגונן.',
      minutes: 47,
      tone: 'steel',
    }),
    card('israeli-economy', 'איך נקבעת ריבית בנק ישראל', { tone: 'graphite' }),
    card('israeli-economy', 'תקציב המדינה בשפה פשוטה', { tone: 'sand' }),
    card('israeli-economy', 'שוק העבודה: המקצועות המבוקשים', { tone: 'teal' }),
  ]),
  section('global-economy', [
    card('global-economy', 'הדולר, האירו והשקל: מה מזיז את שערי המטבע', {
      excerpt: 'ריבית, סחר וציפיות: הגורמים שמשפיעים על שער החליפין, ומה המשמעות לחופשה בחו״ל ולקניות מאתרים בינלאומיים.',
      minutes: 72,
      tone: 'plum',
    }),
    card('global-economy', 'מה המשמעות של החלטות הפד למשקיע הישראלי', { tone: 'graphite' }),
    card('global-economy', 'שרשראות אספקה גלובליות: המדריך', { tone: 'bronze' }),
    card('global-economy', 'שווקים מתעוררים: הזדמנות או סיכון', { tone: 'wine' }),
  ]),
  section('capital-market', [
    card('capital-market', 'איך בוחרים קרן נאמנות: המדריך המלא', {
      excerpt: 'דמי ניהול, מדיניות השקעה ותשואה לאורך זמן: על מה להסתכל לפני שמשקיעים.',
      minutes: 32,
      tone: 'graphite',
    }),
    card('capital-market', 'אג״ח ממשלתיות מול קונצרניות: מה ההבדל', {
      excerpt: 'סיכון, תשואה ונזילות: השוואה פשוטה בין שני סוגי האג״ח המרכזיים.',
      minutes: 57,
      tone: 'steel',
    }),
    card('capital-market', 'תעודת סל: מה זה ולמי זה מתאים', {
      excerpt: 'השקעה במדד שלם בפעולה אחת. היתרונות, החסרונות והעלויות שכדאי להכיר.',
      minutes: 87,
      tone: 'teal',
    }),
    card('capital-market', 'השקעות ESG: מגמה חולפת או שינוי עמוק', {
      excerpt: 'מה עומד מאחורי ההשקעות האחראיות ואיך בודקים אם קרן באמת עומדת בהן.',
      minutes: 122,
      tone: 'plum',
    }),
  ]),
  section('real-estate', [
    card('real-estate', 'התחדשות עירונית: מה זה אומר לבעלי הדירות', {
      excerpt: 'תמ״א, פינוי-בינוי והסכמות דיירים: המדריך לשלבים, לזכויות ולטעויות שכדאי להימנע מהן.',
      tone: 'sand',
    }),
    card('real-estate', 'מס רכישה: המדריך לרוכשי דירה', { tone: 'bronze' }),
    card('real-estate', 'שכירות ארוכת טווח: למי זה מתאים', { tone: 'graphite' }),
    card('real-estate', 'איך בודקים קבלן לפני רכישה', { tone: 'steel' }),
  ]),
  section('insurance', [
    card('insurance', 'ביטוח דירה: הכיסויים שרוב האנשים מפספסים', {
      excerpt: 'מבנה, תכולה וצד ג׳: מה כלול בפוליסה הבסיסית ואילו הרחבות שוות את הכסף.',
      tone: 'teal',
    }),
    card('insurance', 'ביטוח סיעודי: מתי כדאי להצטרף', { tone: 'plum' }),
    card('insurance', 'ביטוח חיים למשכנתא: איך משווים', { tone: 'steel' }),
    card('insurance', 'תביעה מול חברת הביטוח: צעד אחר צעד', { tone: 'graphite' }),
  ]),
  section('hi-tech', [
    card('hi-tech', 'פיתוח, מוצר או יזמות: המסלולים לקריירה בהייטק', {
      excerpt: 'מה כל תפקיד דורש, איך נראית השנה הראשונה ואילו כישורים עוזרים להתקדם.',
      tone: 'plum',
    }),
    card('hi-tech', 'אופציות לעובדים: איך הן עובדות', { tone: 'wine' }),
    card('hi-tech', 'סייבר: התחום שממשיך לגייס', { tone: 'graphite' }),
    card('hi-tech', 'עבודה היברידית: מה למדו החברות', { tone: 'teal' }),
  ]),
  section('the-consultants', [
    card('the-consultants', 'למה פיזור השקעות חשוב יותר מתזמון השוק', { author: consultant('[שם היועץ]', 'יועץ השקעות') }),
    card('the-consultants', 'שלוש טעויות נפוצות של משקיעים מתחילים', { author: consultant('[שם היועצת]', 'מתכננת פיננסית') }),
    card('the-consultants', 'איך לחשוב על סיכון כשמתקרבים לפרישה', { author: consultant('[שם היועץ]', 'יועץ פנסיוני') }),
  ]),
  section('the-new-ceo', [
    card('the-new-ceo', '100 הימים הראשונים: כך נכנסים לתפקיד מנכ״ל', {
      tone: 'graphite',
      author: consultant('[שם המנכ״ל]', '[שם החברה]'),
    }),
    card('the-new-ceo', 'לבנות צוות הנהלה מחדש: השיקולים', { author: consultant('[שם המנכ״לית]', '[שם החברה]') }),
    card('the-new-ceo', 'איך מציגים אסטרטגיה חדשה לדירקטוריון', { author: consultant('[שם המנכ״ל]', '[שם החברה]') }),
  ]),
  section('health', [
    card('health', 'שינה טובה יותר: מה אומרים המומחים', { tone: 'teal' }),
    card('health', 'תזונה נכונה בעבודה משרדית'),
    card('health', 'בדיקות תקופתיות לפי גיל'),
  ]),
  section('automotive', [
    card('automotive', 'רכב יד שנייה: הבדיקות לפני שקונים', { tone: 'graphite' }),
    card('automotive', 'טיפול שנתי: מה חובה לבדוק'),
    card('automotive', 'טעינה ציבורית: המדריך לנהגים'),
  ]),
  section('entertainment', [
    card('entertainment', 'הסדרות שכולם מדברים עליהן', { tone: 'wine' }),
    card('entertainment', 'מדריך ההופעות לסוף השבוע'),
    card('entertainment', 'הספרים של העונה'),
  ]),
  section('consumerism', [
    card('consumerism', 'השוואת מחירים חכמה בסופר', { tone: 'bronze' }),
    card('consumerism', 'ביטול עסקה: הזכויות שלכם'),
    card('consumerism', 'מבצעי מועדון: מתי זה באמת משתלם'),
  ]),
];

export const mockHome: HomeData = {
  main,
  trending,
  latest: trending.slice(0, 6),
  sections,
  podcasts: [
    { id: 'p1', show: 'שוק ההון בחצי שעה', title: 'איך מתחילים להשקיע עם סכום קטן', meta: 'פרק [מס׳] · [משך]', href: '#', tone: 'wine' },
    { id: 'p2', show: 'הכסף שלכם', title: 'משכנתא ראשונה: השאלות שאף אחד לא שואל', meta: 'פרק [מס׳] · [משך]', href: '#', tone: 'steel' },
    { id: 'p3', show: 'שיחות הייטק', title: 'מעובד ראשון ליזם: הדרך לסטארט-אפ', meta: 'פרק [מס׳] · [משך]', href: '#', tone: 'plum' },
  ],
};

export const mockMarkets: MarketQuote[] = [
  { symbol: 'TA35', name: 'ת״א 35', value: '0,000.00', change: '+0.00%', direction: 'flat' },
  { symbol: 'TA125', name: 'ת״א 125', value: '0,000.00', change: '+0.00%', direction: 'flat' },
  { symbol: 'SPX', name: 'S&P 500', value: '0,000.00', change: '+0.00%', direction: 'flat' },
  { symbol: 'IXIC', name: 'נאסד״ק', value: '00,000.00', change: '+0.00%', direction: 'flat' },
  { symbol: 'USDILS', name: 'דולר/שקל', value: '0.000', change: '+0.00%', direction: 'flat' },
  { symbol: 'EURILS', name: 'אירו/שקל', value: '0.000', change: '+0.00%', direction: 'flat' },
];

export const mockArticles: ArticleCard[] = all;

const SAMPLE_BODY = `
<p>זהו טקסט לדוגמה שמדגים את עמוד הכתבה. באתר החי יופיע כאן גוף הכתבה כפי שפורסם מה-CMS, אחרי עריכת ה-AI והעורך האנושי.</p>
<p>הטקסט מוצג בגודל 19 פיקסלים עם ריווח שורות נדיב, ברוחב של כ-68 תווים בשורה, כדי שקריאה של כתבה ארוכה תהיה נוחה גם בדסקטופ וגם בטלפון.</p>
<h2>כותרת ביניים</h2>
<p>כותרות ביניים מחלקות כתבה ארוכה לחלקים. הן נכתבות בגופן של האתר במשקל כבד, בלי צבע, כדי שהאדום יישאר שמור לקישורים ולסימני המותג.</p>
<blockquote>ציטוט מודגש נראה כך: קו אדום בצד ימין וטקסט גדול יותר.</blockquote>
<ul>
  <li>רשימות מקבלות תבליטים רגילים</li>
  <li>ו<a href="#">קישורים</a> מסומנים באדום עם קו תחתון</li>
</ul>
<p>בסוף הכתבה מופיעים התגיות, שורת המקור וכתבות קשורות מאותו נושא.</p>`;

export function mockArticle(slug: string): ArticleFull | null {
  const article = all.find((a) => a.slug === slug);
  if (!article) return null;
  return {
    ...article,
    excerpt: article.excerpt ?? 'תקציר הכתבה יופיע כאן: משפט או שניים שמסבירים לקורא מה הוא עומד לקרוא.',
    subtitle: article.excerpt ?? 'כותרת המשנה של הכתבה מופיעה כאן, משפט אחד שמרחיב את הכותרת.',
    bodyHtml: SAMPLE_BODY,
    tags: [
      { slug: article.category.slug, name: article.category.name },
      { slug: 'guide', name: 'מדריך' },
    ],
    editor: { name: '[שם העורך/ת]' },
    updatedAt: article.publishedAt,
    readingMinutes: 4,
    source: null,
  };
}

export function mockRelated(slug: string): ArticleCard[] {
  const article = all.find((a) => a.slug === slug);
  if (!article) return [];
  const same = all.filter((a) => a.slug !== slug && a.category.slug === article.category.slug);
  const others = all.filter((a) => a.slug !== slug && a.category.slug !== article.category.slug);
  return [...same, ...others].slice(0, 6);
}
