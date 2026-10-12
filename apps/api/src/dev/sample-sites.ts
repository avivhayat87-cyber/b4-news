// Development only (DEV_FIXTURES): three made-up news sites served by this API,
// so discovery runs work end to end on a laptop. Each publishes a new article
// every 10 minutes, so consecutive runs show the delta fetch at work.
// One site is an RSS feed, one an HTML listing page, one a news sitemap.
import { escapeHtml } from '@b4/shared';
import type { FastifyPluginAsync } from 'fastify';

export const SAMPLE_SITES = {
  calc: { name: 'כלכלה לדוגמה', offsetMin: 0 },
  market: { name: 'שוק ובית לדוגמה', offsetMin: 3 },
  world: { name: 'עולם הכסף לדוגמה', offsetMin: 6 },
} as const;
export type SampleSite = keyof typeof SAMPLE_SITES;

const EPOCH = Date.UTC(2026, 0, 1);
const EVERY_MS = 10 * 60_000;
const LISTED = 12;

type Story = { title: string; intro: string; paragraphs: string[]; section: string };

const TOPICS: { section: string; titles: string[]; intro: string; body: string[] }[] = [
  {
    section: 'economy',
    titles: ['בנק ישראל הותיר את הריבית ללא שינוי בפעם ה-{n}', 'האינפלציה בספטמבר: עלייה של {p}% במדד המחירים'],
    intro: 'הנגיד הסביר כי הסיכונים לאינפלציה עדיין קיימים, והשוק מתמחר הורדה אפשרית ברבעון הבא.',
    body: [
      'הוועדה המוניטרית החליטה פה אחד להשאיר את הריבית ברמתה הנוכחית. לדברי הבנק, קצב האינפלציה מתקרב לגבול העליון של היעד אך עדיין לא בתוכו.',
      '## מה זה אומר עבור משקי הבית',
      'משכנתאות במסלול פריים לא יתייקרו בחודש הקרוב. עם זאת, כלכלנים מזהירים כי הורדת ריבית מהירה מדי עלולה להאיץ שוב את עליית המחירים.',
      'בשוק ההון הגיבו בעליות קלות, ותשואות האג"ח הממשלתיות ירדו ב-{p} נקודות בסיס.',
    ],
  },
  {
    section: 'realestate',
    titles: ['מחירי הדירות עלו ב-{p}% בשנה האחרונה', 'קבלנים מציעים מבצעי מימון: מה כדאי לבדוק לפני שחותמים'],
    intro: 'נתוני הלמ"ס מצביעים על התייקרות בכל המחוזות, כשהעלייה החדה ביותר נרשמה באזור המרכז.',
    body: [
      'לפי הנתונים, מספר העסקאות בשוק הדירות החדשות עלה לראשונה מזה {n} חודשים. רוכשים רבים נעזרים במבצעי מימון של הקבלנים.',
      'שמאים ממליצים לבדוק את המחיר הכולל של הדירה ולא רק את גובה התשלום החודשי, משום שהטבות המימון מגולמות לעיתים במחיר.',
      '> "השוק מתקרר בקצב איטי, אבל עדיין רחוק מירידת מחירים", אמר שמאי מקרקעין ותיק.',
      'בשכירות נרשמה עלייה מתונה יותר, של כ-{p}% בממוצע.',
    ],
  },
  {
    section: 'tech',
    titles: ['חברת סייבר ישראלית גייסה {n} מיליון דולר', 'הייטק: מספר המשרות הפתוחות עלה ב-{p}%'],
    intro: 'הגיוס הובל על ידי קרן הון סיכון אמריקאית, והכסף ישמש להרחבת פעילות המחקר והפיתוח בישראל.',
    body: [
      'החברה, שהוקמה לפני חמש שנים, מפתחת כלים להגנה על מערכות ענן של ארגונים גדולים. לדבריה, מספר הלקוחות שלה הוכפל בשנה האחרונה.',
      'לפי המנכ"ל, החברה צפויה לגייס עשרות עובדים נוספים בחודשים הקרובים, רובם בתפקידי פיתוח.',
      '## מגמה רחבה',
      'מתחילת השנה גייסו חברות הסייבר הישראליות סכום שיא, למרות ההאטה בשוקי ההון העולמיים.',
    ],
  },
  {
    section: 'consumer',
    titles: ['רשתות השיווק מעלות מחירים: המוצרים שהתייקרו', 'מבצעי החגים: איך לזהות הנחה אמיתית'],
    intro: 'סקר מחירים שנערך ב-{n} סניפים מצא פערים של עשרות אחוזים באותו סל מוצרים.',
    body: [
      'הסקר השווה סל של 40 מוצרים בסיסיים ברשתות הגדולות. הסל הזול ביותר היה זול ב-{p}% מהיקר ביותר.',
      'ארגוני הצרכנים ממליצים להשוות מחיר ליחידת מידה ולא להסתמך על שלטי המבצע בלבד.',
      '- לבדוק את המחיר ל-100 גרם',
      'בהמשך החודש צפויות עליות מחירים נוספות במוצרי חלב ובשר, לאחר אישור עדכון המחירים.',
    ],
  },
  {
    section: 'world',
    titles: ['הפד האמריקאי רומז על הורדת ריבית', 'וול סטריט: מדד נאסד"ק נסגר בשיא חדש'],
    intro: 'יו"ר הבנק המרכזי האמריקאי אמר כי הנתונים האחרונים מאפשרים "גמישות" במדיניות.',
    body: [
      'הדברים נאמרו בכנס כלכלי, יום לאחר פרסום נתוני תעסוקה חלשים מהצפוי. המשקיעים מעריכים כעת סיכוי של {p}% להורדה בפגישה הבאה.',
      'הדולר נחלש מול רוב המטבעות, ומחיר הזהב עלה לשיא של {n} שבועות.',
      'בשווקים באירופה נרשמו עליות מתונות, בהובלת מניות הבנקים.',
    ],
  },
  {
    section: 'travel',
    titles: ['חברות התעופה מוסיפות {n} קווים לחורף', 'מחירי הטיסות לחו"ל ירדו ב-{p}%'],
    intro: 'התחרות בנתב"ג מתחזקת, והנוסעים נהנים ממחירים נמוכים יותר ליעדים פופולריים באירופה.',
    body: [
      'לפי רשות שדות התעופה, מספר הנוסעים בחודש האחרון עלה לעומת התקופה המקבילה אשתקד.',
      'סוכני נסיעות ממליצים להזמין מוקדם ולבדוק את מדיניות הכבודה, שמשנה את המחיר הסופי.',
      'בתי המלון באילת מדווחים על תפוסה גבוהה לקראת החגים.',
    ],
  },
];

function fill(text: string, n: number): string {
  return text.replaceAll('{n}', String((n % 9) + 3)).replaceAll('{p}', String(((n * 7) % 9) + 1) + '.' + String(n % 10));
}

export function story(n: number): Story {
  const t = TOPICS[n % TOPICS.length]!;
  const title = fill(t.titles[Math.floor(n / TOPICS.length) % t.titles.length]!, n);
  return { title: `${title} (#${n})`, intro: fill(t.intro, n), paragraphs: t.body.map((p) => fill(p, n)), section: t.section };
}

function publishedAt(site: SampleSite, n: number): Date {
  return new Date(EPOCH + n * EVERY_MS + SAMPLE_SITES[site].offsetMin * 60_000);
}

function latestN(site: SampleSite): number {
  return Math.floor((Date.now() - EPOCH - SAMPLE_SITES[site].offsetMin * 60_000) / EVERY_MS);
}

function listed(site: SampleSite): number[] {
  const last = latestN(site);
  return Array.from({ length: LISTED }, (_, i) => last - i);
}

function articlePage(base: string, site: SampleSite, n: number): string {
  const s = story(n);
  const body = s.paragraphs
    .map((p) => (p.startsWith('## ') ? `<h2>${escapeHtml(p.slice(3))}</h2>` : p.startsWith('> ') ? `<blockquote>${escapeHtml(p.slice(2))}</blockquote>` : p.startsWith('- ') ? `<ul><li>${escapeHtml(p.slice(2))}</li></ul>` : `<p>${escapeHtml(p)}</p>`))
    .join('\n');
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<title>${escapeHtml(s.title)} | ${SAMPLE_SITES[site].name}</title>
<meta property="og:title" content="${escapeHtml(s.title)}">
<meta property="og:description" content="${escapeHtml(s.intro)}">
<meta property="og:image" content="${base}/image/${n}.svg">
<meta property="article:published_time" content="${publishedAt(site, n).toISOString()}">
</head><body>
<header><nav><a href="${base}/">ראשי</a></nav></header>
<main><article>
<h1 class="headline">${escapeHtml(s.title)}</h1>
<p class="subtitle">${escapeHtml(s.intro)}</p>
<div class="article-body">${body}<p>${escapeHtml(`דיווח מספר ${n} של ${SAMPLE_SITES[site].name}.`)}</p></div>
<aside class="related">כתבות נוספות</aside>
</article></main>
<footer>אתר לדוגמה לפיתוח מקומי. התוכן בדוי.</footer>
</body></html>`;
}

export const sampleSites: FastifyPluginAsync<{ publicApiUrl: string }> = async (app, { publicApiUrl }) => {
  const baseOf = (site: SampleSite) => `${publicApiUrl}/dev/sites/${site}`;
  const routeConfig = { config: { rateLimit: false } } as const;

  app.get<{ Params: { site: string; n: string } }>('/:site/article/:n', routeConfig, async (req, reply) => {
    const site = req.params.site as SampleSite;
    const n = Number(req.params.n);
    if (!(site in SAMPLE_SITES) || !Number.isInteger(n) || n < 0 || n > latestN(site)) return reply.status(404).send('not found');
    return reply.header('content-type', 'text/html; charset=utf-8').send(articlePage(baseOf(site), site, n));
  });

  app.get<{ Params: { site: string; n: string } }>('/:site/image/:n', routeConfig, async (req, reply) => {
    const n = Number.parseInt(req.params.n, 10) || 0;
    const hue = (n * 47) % 360;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450"><rect width="800" height="450" fill="hsl(${hue} 35% 35%)"/><circle cx="${200 + (n % 5) * 80}" cy="220" r="120" fill="hsl(${(hue + 160) % 360} 60% 55%)" opacity=".8"/></svg>`;
    return reply.header('content-type', 'image/svg+xml').header('cross-origin-resource-policy', 'cross-origin').send(svg);
  });

  // calc: RSS 2.0
  app.get('/calc/feed.xml', routeConfig, async (_req, reply) => {
    const base = baseOf('calc');
    const items = listed('calc')
      .map((n) => {
        const s = story(n);
        return `<item><title>${escapeHtml(s.title)}</title><link>${base}/article/${n}?utm_source=rss</link><guid>${base}/article/${n}</guid><description><![CDATA[<p>${escapeHtml(s.intro)}</p>]]></description><pubDate>${publishedAt('calc', n).toUTCString()}</pubDate><enclosure url="${base}/image/${n}.svg" type="image/svg+xml"/></item>`;
      })
      .join('');
    return reply
      .header('content-type', 'application/rss+xml; charset=utf-8')
      .send(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${SAMPLE_SITES.calc.name}</title><link>${base}/</link>${items}</channel></rss>`);
  });

  // market: an HTML listing page
  app.get('/market/', routeConfig, async (_req, reply) => {
    const base = baseOf('market');
    const items = listed('market')
      .map((n) => {
        const s = story(n);
        return `<li class="story"><img src="${base}/image/${n}.svg" alt=""><a class="story-link" href="/dev/sites/market/article/${n}">${escapeHtml(s.title)}</a><time datetime="${publishedAt('market', n).toISOString()}"></time></li>`;
      })
      .join('');
    return reply
      .header('content-type', 'text/html; charset=utf-8')
      .send(`<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${SAMPLE_SITES.market.name}</title></head><body><ul class="story-list">${items}</ul></body></html>`);
  });

  // world: a Google News sitemap
  app.get('/world/sitemap.xml', routeConfig, async (_req, reply) => {
    const base = baseOf('world');
    const urls = listed('world')
      .map((n) => {
        const s = story(n);
        return `<url><loc>${base}/article/${n}</loc><news:news><news:publication><news:name>${SAMPLE_SITES.world.name}</news:name><news:language>he</news:language></news:publication><news:publication_date>${publishedAt('world', n).toISOString()}</news:publication_date><news:title>${escapeHtml(s.title)}</news:title></news:news></url>`;
      })
      .join('');
    return reply
      .header('content-type', 'application/xml; charset=utf-8')
      .send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">${urls}</urlset>`);
  });
};
