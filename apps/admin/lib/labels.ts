// Hebrew labels for everything the CMS shows.
import {
  type AgentId,
  type ARTICLE_LENGTHS,
  type AudienceSetupKey,
  CATEGORIES,
  type ClaimLabel,
  type Divergence,
  type DraftColor,
  type DraftStatus,
  type Placement,
  type PlanState,
  type PromptAuthor,
  type PublishedArticleDto,
  type ReelMotion,
  type ReelStage,
  type ResearchDepth,
  type ResearchStatus,
  type ReviewAction,
  type ReviewState,
  type ReviewWhere,
  type ShareFilter,
  type ShareFormat,
  type ShareTemplate,
  type SocialPlatform,
  type SourceKind,
  type SourceStatus,
  type SubscriberStatus,
  type VisualAgentOverview,
} from '@b4/shared';

export const categoryName = (slug: string | null | undefined) => CATEGORIES.find((c) => c.slug === slug)?.name ?? 'ללא קטגוריה';

/** Discovery's folder for items without an economic section (politics, sport, general news…). */
export const MISC_FOLDER = { name: 'פוליטיקה ושונות', hint: 'כתבות שלא שויכו לתחום כלכלי. בוחרים אותן כרגיל, והתחום נקבע ידנית בעורך.' };

export const DRAFT_STATUS: Record<DraftStatus, { label: string; tone: Tone }> = {
  queued_ai: { label: 'ממתין ל-AI', tone: 'info' },
  ai_processing: { label: 'ה-AI כותב', tone: 'info' },
  ai_failed: { label: 'ה-AI נכשל', tone: 'danger' },
  editing: { label: 'בעריכה', tone: 'warn' },
  text_final: { label: 'טקסט סופי', tone: 'ok' },
  ready: { label: 'מוכן', tone: 'ok' },
  skipped: { label: 'לא לפרסום', tone: 'muted' },
  published: { label: 'פורסם', tone: 'ink' },
};

export const SOURCE_STATUS: Record<SourceStatus, { label: string; tone: Tone }> = {
  pending_dev: { label: 'ממתין למפתח', tone: 'warn' },
  in_development: { label: 'בפיתוח', tone: 'info' },
  active: { label: 'פעיל', tone: 'ok' },
  paused: { label: 'מושהה', tone: 'muted' },
  broken: { label: 'תקול', tone: 'danger' },
  archived: { label: 'בארכיון', tone: 'muted' },
};

export const RUN_STATUS: Record<string, { label: string; tone: Tone }> = {
  queued: { label: 'בתור', tone: 'info' },
  running: { label: 'רץ עכשיו', tone: 'info' },
  succeeded: { label: 'הושלם', tone: 'ok' },
  partial: { label: 'הושלם חלקית', tone: 'warn' },
  failed: { label: 'נכשל', tone: 'danger' },
  cancelled: { label: 'בוטל', tone: 'muted' },
};

export const MAGAZINE_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: 'טיוטה', tone: 'muted' },
  editing: { label: 'בעריכה', tone: 'warn' },
  ready: { label: 'מוכן', tone: 'ok' },
  publishing: { label: 'מתפרסם', tone: 'info' },
  published: { label: 'פורסם', tone: 'ink' },
  partially_failed: { label: 'פורסם חלקית', tone: 'danger' },
  archived: { label: 'בארכיון', tone: 'muted' },
};

export const PLACEMENT: Record<Placement, string> = { main: 'כתבה ראשית', trending: 'חדשות חמות', none: 'קטגוריה בלבד' };

/** The reel's steps, as the editor sees them. */
export const REEL_STAGE: Record<ReelStage, { label: string; tone: Tone }> = {
  prompts: { label: 'הנחיות מוכנות לאישור', tone: 'info' },
  image: { label: 'תמונה מחכה לאישור', tone: 'warn' },
  video: { label: 'סרטון מחכה לאישור', tone: 'warn' },
  approved: { label: 'מאושר לפרסום', tone: 'ok' },
};

/** The agent team: who each agent is, in one line and in a few. */
export const AGENT: Record<AgentId, { name: string; role: string; about: string }> = {
  chief: {
    name: 'העורך הראשי',
    role: 'מקבל פקודות בצ\'אט ומפעיל את כל הסוכנים',
    about: 'הצ\'אט בדף "סוכן AI" ובאפליקציית Claude. קורא את מצב המערכת ומפעיל את שאר הסוכנים דרך הכלים. כל שינוי מחכה לאישור שלכם.',
  },
  reporter: {
    name: 'הכתב-החוקר',
    role: 'חוקר דיווח מקישור או מצילום מסך, וכותב ממנו כתבה',
    about: 'מקבל קישור או צילומי מסך (טלגרם, X, וואטסאפ), מחפש את המקור הרשמי לכל פרט ומסמן אותו: עובדה, דיווח, טענה, הערכה, חשד ("לכאורה"), לא מאומת או הופרך. עובדה רק ממקור רשמי, אף פעם לא מאתר חדשות. בונה תיק תחקיר, שומר עותק וצילום של כל מקור כהוכחה, וכותב רק מהתיק. בסוף הכתבה: שמות המקורות, בלי קישורים.',
  },
  rewrite: {
    name: 'עורך השכתוב',
    role: 'כותב את הכתבה מהמקור ומתקן לפי ההערות',
    about: 'כותב כתבה חדשה מכל מקור שנשמר לעריכה, ומבצע את ההערות שלכם בעורך ("תקצר", "כותרת חדה יותר"). לומד את סגנון הבית מהתיקונים שלכם אחרי כל פרסום.',
  },
  reviewer: {
    name: 'הבודק המשפטי',
    role: 'עוצר כתבה שיש בה סיכון, עד שתחליטו',
    about: 'קורא כל כתבה כשהטקסט מסומן כסופי, ומחפש סיכונים: חשד נגד אדם פרטי בשמו, קטינים או נפגעי עבירות מין, צו איסור פרסום, מידע ביטחוני, שמועה על חברה בבורסה, והאשמה בלי תגובה. כתבה עם סיכון לא מתפרסמת עד שמישהו מחליט, והמנהלים מקבלים מייל. זו רשת ביטחון, לא תחליף לעורך דין.',
  },
  social: {
    name: 'עורך הרשתות',
    role: 'מחליט איך כל כתבה עולה לרשתות',
    about: 'כשהטקסט סופי: מסגרת עיצוב, פוסט, סטורי, והמלצה על ריל, עם הטקסטים והנימוקים. לומד מהשינויים שלכם בדוח תוכנית ההפצה.',
  },
  visual: {
    name: 'סוכן התמונות והווידאו',
    role: 'מתאר תמונות וריילים, בשביל כל הסוכנים',
    about: 'רץ על Google Gemini. כותב בעברית את התיאור לתמונה הראשית ואת שתי ההנחיות לריל, ומודל התמונות והווידאו מצייר מהן. אחד, משותף לכל הסוכנים, ולומד מהבחירות שלכם.',
  },
  translator: {
    name: 'המתרגם',
    role: 'מתרגם כתבות מחו״ל לעברית',
    about: 'מתרגם את הכותרות של כתבות מחו״ל אחרי האיתור, ואת הכתבה כולה כשהיא נשמרת לעריכה. מתרגם גם לאנגלית את ההנחיות שאישרתם למודל התמונות.',
  },
  learning: {
    name: 'הלמידה',
    role: 'לומד מהתיקונים שלכם אחרי כל פרסום',
    about: 'אחרי כל פרסום קורא בבת אחת מה שיניתם בטיוטות, ומעדכן את כללי סגנון הבית של עורך השכתוב. כותב לכם דוח קצר על מה שלמד.',
  },
};

/** Every skill: its name, and what it is used for. */
export const SKILL: Record<string, { name: string; use: string }> = {
  'agent.system': { name: 'הנחיות העורך הראשי', use: 'איך הוא עונה בצ\'אט ומפעיל את הכלים' },
  'research.system': { name: 'התחקיר', use: 'איך חוקרים דיווח: סדר העבודה, אילו מקורות מותרים, ואיך מסמנים כל פרט' },
  'research.write': { name: 'כתיבה מתיק התחקיר', use: 'איך כל פרט נכתב בכתבה לפי הסימון שלו' },
  'rewrite.system': { name: 'כתיבת כתבה מהמקור', use: 'כל כתבה חדשה. במקום הסימון {{style_rules}} המערכת מכניסה את סגנון הבית שנלמד ואת ההגדרות שלכם.' },
  'refine.system': { name: 'תיקון לפי הערה', use: 'ההערות בעורך: "תקצר", "כותרת חדה יותר"' },
  'review.system': { name: 'הבדיקה המשפטית', use: 'אילו סיכונים מחפשים בכל כתבה, ומה מסמנים' },
  'review.fix': { name: 'ניסוח זהיר', use: '"פרסום בזהירות מוגברת": איך מנסחים מחדש קטע עם סיכון' },
  'social.plan': { name: 'תוכנית הפצה', use: 'כשהטקסט סופי: מסגרת, פוסט, סטורי, ריל והטקסטים' },
  'social.kit': { name: 'פוסט וסטורי לכתבה שבאתר', use: 'דף הרשתות: "הכנה עם AI" לכתבות שכבר פורסמו' },
  'social.caption': { name: 'חבילת הרשתות הישנה', use: 'רק לכתבות שהוכנו לפני תוכנית ההפצה' },
  'visual.image': { name: 'תיאור התמונה הראשית', use: 'מה מודל התמונות מצייר לכל כתבה' },
  'reel.prompts': { name: 'ההנחיות לריל', use: 'שתי ההנחיות בעברית: התמונה והסרטון' },
  'visual.learn': { name: 'למידה מהבחירות שלכם', use: 'כל כמה מקרים: מה העדפתם בתמונות ובריילים' },
  'reel.image': { name: 'תבנית לתמונת הריל', use: 'נשלחת למודל התמונות. באנגלית בכוונה: המודל מקבל אנגלית.' },
  'reel.video': { name: 'תבנית לסרטון הריל', use: 'נשלחת למודל הווידאו. באנגלית בכוונה: המודל מקבל אנגלית.' },
  'translate.system': { name: 'תרגום לעברית', use: 'כותרות אחרי האיתור, וכתבה מלאה לעורך' },
  'learning.batch': { name: 'למידה אחרי פרסום', use: 'מעדכן את כללי סגנון הבית ומסכם מה נלמד' },
  'newsroom.rules': { name: 'נהלי המערכת', use: 'כל סוכן שכותב קורא אותם אחרי הסקיל שלו' },
};

/** A model id as people say it ("Claude Sonnet 5.5"); other ids stay as they are. */
export function modelName(id: string): string {
  return id
    .split(' / ')
    .map((m) => {
      const c = /^claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d+))?/.exec(m);
      return c ? `Claude ${c[1]![0]!.toUpperCase()}${c[1]!.slice(1)} ${c[2]}${c[3] ? `.${c[3]}` : ''}` : m;
    })
    .join(' / ');
}

/** Where an article's legal review stands. */
export const REVIEW_STATE: Record<ReviewState, { label: string; tone: Tone }> = {
  checking: { label: 'בבדיקה משפטית', tone: 'info' },
  clear: { label: 'לא נמצאו סיכונים', tone: 'ok' },
  flagged: { label: 'נעצרה לבדיקה', tone: 'danger' },
  resolved: { label: 'כל הסוגיות הוכרעו', tone: 'ok' },
  failed: { label: 'הבדיקה לא הושלמה', tone: 'warn' },
  waived: { label: 'אושרה בלי בדיקה', tone: 'muted' },
};

/** What was decided on a risk. */
export const REVIEW_ACTION: Record<ReviewAction, string> = {
  approve: 'אושר לפרסום כמו שזה',
  caution: 'פורסם בזהירות מוגברת (הנוסח תוקן)',
  awaiting_response: 'ממתין לתגובה',
  response_added: 'התגובה נוספה לכתבה',
  no_response: 'נכתב שלא התקבלה תגובה',
  reject: 'הוחלט לא לפרסם',
};

export const REVIEW_WHERE_LABEL: Record<ReviewWhere, string> = { title: 'בכותרת', subtitle: 'בכותרת המשנה', body: 'בגוף הכתבה' };

// --- The research reporter ------------------------------------------------------------
export const RESEARCH_DEPTH: Record<ResearchDepth, { name: string; about: string; cost: string }> = {
  quick: { name: 'מהיר', about: 'עד 3 חיפושים. מספיק לרוב הדיווחים.', cost: 'בערך 10–30 סנט' },
  regular: { name: 'רגיל', about: 'עד 8 חיפושים, ובדיקה של כל פרט.', cost: 'בערך 30–80 סנט' },
  deep: { name: 'מעמיק', about: 'עד 15 חיפושים, במודל החזק ביותר. לסיפור גדול.', cost: 'בערך 1–3 דולר' },
};

export const RESEARCH_STATUS: Record<ResearchStatus, { label: string; tone: Tone }> = {
  queued: { label: 'ממתין', tone: 'info' },
  researching: { label: 'חוקר', tone: 'info' },
  writing: { label: 'כותב', tone: 'info' },
  done: { label: 'מוכן לעריכה', tone: 'ok' },
  failed: { label: 'נכשל', tone: 'danger' },
};

/** How each detail of a research file is marked, and how it is written in the article. */
export const CLAIM_LABEL: Record<ClaimLabel, { name: string; tone: Tone; how: string }> = {
  verified: { name: 'עובדה מאומתת', tone: 'ok', how: 'מקור רשמי אומר זאת. נכתב כעובדה, עם ייחוס.' },
  reported: { name: 'דיווח', tone: 'info', how: 'רק דיווח, לא אומת במקור רשמי. "לפי דיווח ב..."' },
  claimed: { name: 'טענה', tone: 'info', how: 'מישהו אמר זאת. "לדבריו", "לטענתו"' },
  estimate: { name: 'הערכה', tone: 'muted', how: 'תחזית או ניתוח. "ההערכה היא", לעולם לא כעובדה' },
  suspicion: { name: 'חשד (לכאורה)', tone: 'warn', how: 'חשד עם מקור רשמי. "לכאורה", "על פי החשד"' },
  unverified: { name: 'לא מאומת', tone: 'danger', how: 'לא נמצא מקור. לא נכנס לכתבה.' },
  debunked: { name: 'הופרך', tone: 'danger', how: 'נבדק ונמצא לא נכון. נכנס רק כהפרכה.' },
};

export const SOURCE_KIND: Record<SourceKind, string> = {
  official: 'רשמי',
  company: 'החברה עצמה',
  person: 'האדם עצמו',
  social: 'רשת חברתית',
  news: 'אתר חדשות (רק רמז)',
  wiki: 'ויקיפדיה (רקע)',
  other: 'אחר',
};

/** Where an article's distribution plan stands. */
export const PLAN_STATE: Record<PlanState, { label: string; tone: Tone }> = {
  none: { label: 'אין עדיין תוכנית', tone: 'muted' },
  writing: { label: 'עורך הרשתות כותב', tone: 'info' },
  ready: { label: 'תעלה עם הכתבה', tone: 'ok' },
  stale: { label: 'הטקסט השתנה', tone: 'warn' },
  failed: { label: 'נכשל', tone: 'danger' },
  off: { label: 'לא לרשתות', tone: 'muted' },
  published: { label: 'פורסמה', tone: 'ink' },
};

/** The visual agent's learning cases. */
export const VISUAL_CASE: Record<VisualAgentOverview['recent'][number]['kind'], string> = { article_image: 'תמונה לכתבה', reel: 'ריל' };
export const VISUAL_CASE_STATUS: Record<VisualAgentOverview['recent'][number]['status'], { label: string; tone: Tone }> = {
  pending: { label: 'ממתין ללמידה', tone: 'warn' },
  distilled: { label: 'נלמד', tone: 'ok' },
  excluded: { label: 'לא נלמד', tone: 'muted' },
};
/** Who wrote an image description. */
export const PROMPT_BY: Record<PromptAuthor, string> = { agent: 'נכתב ע״י סוכן התמונות', editor: 'נכתב ע״י העורך' };

// --- Audience -----------------------------------------------------------------------
export const SUBSCRIBER_STATUS: Record<SubscriberStatus, { label: string; tone: Tone }> = {
  active: { label: 'מנוי פעיל', tone: 'ok' },
  pending: { label: 'ממתין לאישור במייל', tone: 'warn' },
  unsubscribed: { label: 'הוסר מהרשימה', tone: 'muted' },
};
/** What the readers' and subscribers' flows need, and where it is set. */
export const AUDIENCE_SETUP_LABEL: Record<AudienceSetupKey, { title: string; why: string }> = {
  mail: {
    title: 'דואר יוצא מחובר',
    why: 'בלעדיו גולשים לא מקבלים קוד כניסה ומנויים לא מקבלים מייל אישור. מגדירים ב"הגדרות" > "חיבורים" > "דואר יוצא".',
  },
  sender: {
    title: 'כתובת שולח מהדומיין של האתר',
    why: 'למשל no-reply@b4news.co.il, עם רשומות SPF ו-DKIM אצל ספק הדומיין, כדי שהמיילים לא ייפלו לספאם. מגדירים באותו מקום, בשדה "שולח".',
  },
  company: {
    title: 'פרטי החברה מלאים',
    why: 'שם, ח.פ., כתובת ומייל לפניות פרטיות. הם מופיעים בתנאי השימוש, במדיניות הפרטיות ובכל ניוזלטר, כפי שהחוק דורש. מגדירים ב"הגדרות" > "פרטי האתר".',
  },
  https: {
    title: 'האתר בכתובת מאובטחת (https)',
    why: 'עוגיית ההתחברות של הגולשים נשלחת רק בחיבור מאובטח. מתקיים כשהאתר עולה לדומיין האמיתי.',
  },
};

export const ARTICLE_STATUS: Record<PublishedArticleDto['status'], { label: string; tone: Tone }> = {
  published: { label: 'באתר', tone: 'ok' },
  scheduled: { label: 'מתוזמנת', tone: 'info' },
  unpublished: { label: 'הוסרה מהאתר', tone: 'muted' },
};

export const COLOR: Record<DraftColor, string> = {
  red: 'אדום',
  orange: 'כתום',
  yellow: 'צהוב',
  green: 'ירוק',
  blue: 'כחול',
  purple: 'סגול',
  gray: 'אפור',
};

export const PLATFORM: Record<SocialPlatform, string> = {
  facebook: 'פייסבוק',
  instagram: 'אינסטגרם',
  telegram: 'טלגרם',
  whatsapp: 'וואטסאפ',
  x: 'X',
  tiktok: 'טיקטוק',
};

// --- Social page -------------------------------------------------------------------
export const SHARE_TEMPLATE: Record<ShareTemplate, { name: string; use: string }> = {
  headline: { name: 'כותרת על תמונה', use: 'ברירת המחדל לרוב הכתבות: תמונה מלאה וכותרת חזקה' },
  breaking: { name: 'מבזק', use: 'חדשות שקרו עכשיו: החלטות, נתונים, תזוזות חדות' },
  quote: { name: 'משפט מפתח', use: 'כשמשפט אחד או מספר אחד מחזיקים את הסיפור' },
  explainer: { name: 'מדריך', use: 'כתבות שירות, הסברים ו"מה צריך לדעת"' },
};
export const SHARE_FORMAT: Record<ShareFormat, { name: string; size: string }> = {
  feed: { name: 'פוסט', size: '4:5 · 1080×1350' },
  story: { name: 'סטורי', size: '9:16 · 1080×1920' },
  reel: { name: 'ריל', size: 'סרטון 9:16' },
};
export const REEL_MOTION: Record<ReelMotion, string> = {
  zoom_in: 'זום-אין איטי',
  zoom_out: 'זום-אאוט איטי',
  pan: 'תנועה איטית לצד',
  parallax: 'עומק עדין (פרלקסה)',
};
/** The Veo models offered by default; any other model id can be set in Settings. */
export const VIDEO_MODEL: Record<string, string> = {
  'veo-3.1-fast-generate-preview': 'Veo 3.1 Fast (מומלץ)',
  'veo-3.1-lite-generate-preview': 'Veo 3.1 Lite (זול)',
  'veo-3.1-generate-preview': 'Veo 3.1 (הכי איכותי, יקר)',
};
export const SHARE_FILTER: Record<ShareFilter, string> = { pending: 'ממתינות לרשתות', shared: 'פורסמו ברשתות', all: 'כל הכתבות' };
export const SOCIAL_POST_STATUS: Record<string, { label: string; tone: Tone }> = {
  posted: { label: 'פורסם', tone: 'ok' },
  skipped: { label: 'מוכן לפרסום ידני', tone: 'warn' },
  failed: { label: 'נכשל', tone: 'danger' },
  queued: { label: 'בתור', tone: 'info' },
  posting: { label: 'מתפרסם', tone: 'info' },
  draft: { label: 'טיוטה', tone: 'muted' },
  comment_failed: { label: 'פורסם, התגובה נכשלה', tone: 'warn' },
};

// --- Editor agent -------------------------------------------------------------------
export const DIVERGENCE_LABEL: Record<Divergence, { name: string; description: string }> = {
  light: { name: 'קרוב למקור', description: 'אותו מבנה וסדר, ניסוח חדש בלבד' },
  medium: { name: 'שכתוב מלא', description: 'ניסוח ומבנה חדשים, אותה זווית' },
  strong: { name: 'כתבה אחרת', description: 'זווית, פתיחה ומבנה חדשים לגמרי, עם כל הנתונים של המקור' },
};
export const ARTICLE_LENGTH: Record<(typeof ARTICLE_LENGTHS)[number], string> = { shorter: 'קצר מהמקור', same: 'כמו המקור', longer: 'ארוך מהמקור' };

export const ROLE: Record<string, string> = { admin: 'מנהל/ת', editor: 'עורך/ת', developer: 'מפתח/ת', viewer: 'צפייה בלבד' };

export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'muted' | 'ink';

const dateFmt = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric', year: '2-digit', hour: '2-digit', minute: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' });

export const formatDateTime = (iso: string | null | undefined) => (iso ? dateFmt.format(new Date(iso)) : '—');
export const formatTime = (iso: string | null | undefined) => (iso ? timeFmt.format(new Date(iso)) : '—');

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return 'עכשיו';
  if (min < 60) return `לפני ${min} דק׳`;
  const h = Math.round(min / 60);
  if (h < 24) return `לפני ${h} שע׳`;
  return formatDateTime(iso);
}
