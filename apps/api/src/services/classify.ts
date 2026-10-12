// Fast keyword classification of a headline into a site section. Used by the
// scraper when a source has no rule for an item; the AI rewrite refines it.
import type { CategorySlug } from '@b4/shared';

const RULES: [CategorySlug, RegExp][] = [
  ['tourism', /תייר|טיס|מלון|חופש|נתב"ג|נתב״ג|חו"ל|חו״ל|יעד|אל על|מטוס/],
  ['automotive', /רכב|מכונית|חשמלית|טסלה|יבואן|כביש|דלק|תחבורה/],
  ['real-estate', /דיר|נדל"ן|נדל״ן|משכנת|קבלן|שכירות|בנייה|מגורים|קרקע/],
  ['insurance', /ביטוח|פוליס|מבטח|פנסי/],
  ['health', /בריאות|רפוא|בית חולים|בית החולים|קופת חולים|תרופ|רופא|מחלה|חיסון/],
  ['hi-tech', /הייטק|סטארט|AI|בינה מלאכותית|סייבר|אקזיט|גיוס הון|טכנולוגי|שבב|אפליקצי/],
  ['capital-market', /בורסה|מניה|מניות|מדד ת"א|מדד ת״א|אג"ח|אג״ח|תשואה|קרן נאמנות|משקיעים|דיבידנד|הנפקה/],
  ['entertainment', /סדרה|סרט|זמר|הופעה|טלוויזיה|ריאליטי|נטפליקס|פסטיבל|שחקן/],
  ['consumerism', /צרכנ|מחירים|סופרמרקט|הנחה|מבצע|רשת השיווק|יוקר המחיה|צרכן/],
  ['global-economy', /פד"|פד״|וול סטריט|ארה"ב|ארה״ב|סין|אירופה|הבנק המרכזי האירופי|דולר|נפט|טראמפ/],
  ['israeli-economy', /בנק ישראל|ריבית|אינפלציה|תקציב|האוצר|מס |מיסים|שכר|תעסוקה|הלמ"ס|הלמ״ס|גירעון/],
];

export function classifyHeadline(text: string): CategorySlug | null {
  for (const [slug, re] of RULES) if (re.test(text)) return slug;
  return null;
}
