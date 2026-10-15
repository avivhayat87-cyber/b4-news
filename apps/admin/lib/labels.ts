// Hebrew labels for everything the CMS shows.
import {
  AD_SLOT_NAMES,
  AD_SLOTS,
  adSize,
  type AdDevice,
  type AdFormat,
  type AdGoal,
  type AdReviewDto,
  type AdSlot,
  type AdStatus,
  type BannerTheme,
  type AgentId,
  type ARTICLE_LENGTHS,
  type AudienceSetupKey,
  type AccountStatus,
  CATEGORIES,
  type ClaimLabel,
  type Divergence,
  type DraftColor,
  type DraftStatus,
  type MissingKey,
  type Placement,
  type PlanState,
  type PromptAuthor,
  type PublishedArticleDto,
  type ReelMotion,
  type MeetingStatus,
  type OfficialPlatform,
  type OrgKind,
  type PitchStatus,
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
  type UsagePeriod,
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

/** The steps to publishing an article, in the order the editor does them: what each is, and what fixes it. */
export const MISSING_STEP: Record<MissingKey, { label: string; fix: string }> = {
  title: { label: 'כותרת', fix: 'לכתוב כותרת (5 אותיות לפחות)' },
  body: { label: 'גוף הכתבה', fix: 'להשלים את גוף הכתבה (100 תווים לפחות)' },
  category: { label: 'מדור', fix: 'לבחור מדור' },
  image: { label: 'תמונה ראשית', fix: 'לבחור תמונה ראשית' },
  text: { label: 'אישור הטקסט', fix: 'לקרוא ולאשר את הטקסט' },
  review: { label: 'בדיקה משפטית', fix: 'להחליט על הבדיקה המשפטית' },
};

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
    role: 'מקבל פקודות בצ\'אט, מפעיל את הסוכנים, ממליץ על כתבות בכל איתור, מסדר אותן באתר ומנהל את ישיבת המערכת',
    about: 'הצ\'אט בדף "סוכן AI" ובאפליקציית Claude: קורא את מצב המערכת ומפעיל את שאר הסוכנים דרך הכלים, וכל שינוי מחכה לאישור שלכם. בסוף כל איתור (בישראל ומחו״ל) הוא ממליץ אילו סיפורים לקחת קודם, עם ציון חשיבות וסיבה, ולפחות סיפור אחד מכל מדור. כשה-AI מסיים לכתוב את הכתבות שבחרתם, הוא מחליט לכל אחת: כתבה ראשית (אחת לכל היותר), חדשות חמות או קטגוריה בלבד, אם היא עולה לפס המבזקים, ומדור כשאין לה. אם לא שיניתם, הבחירה מאושרת. בישיבת המערכת ("העלאה ידנית" > "ישיבת מערכת") מציע כתבות מקוריות ממה שהאיתור מצא; רק מה שתאשרו עובר לכתב-החוקר.',
  },
  reporter: {
    name: 'הכתב-החוקר',
    role: 'חוקר דיווח או רעיון, וכותב ממנו כתבה',
    about: 'מקבל קישור, צילומי מסך (טלגרם, X, וואטסאפ) או רעיון של המערכת, מחפש את המקור הרשמי לכל פרט ומסמן אותו: עובדה, דיווח, טענה, הערכה, חשד ("לכאורה"), לא מאומת או הופרך. עובדה רק ממקור רשמי, אף פעם לא מאתר חדשות. בונה תיק תחקיר, שומר עותק וצילום של כל מקור כהוכחה, וכותב רק מהתיק. בסוף הכתבה: שמות המקורות, בלי קישורים.',
  },
  rewrite: {
    name: 'עורך השכתוב',
    role: 'כותב את הכתבה מהמקור ומתקן לפי ההערות',
    about: 'כותב כתבה חדשה מכל מקור שנשמר לעריכה, וכשבוחרים קבוצה של אותו סיפור מכמה אתרים, כתבה אחת מכולם בלי לחזור על אותו פרט. מבצע את ההערות שלכם בעורך ("תקצר", "כותרת חדה יותר"), ולומד את סגנון הבית מהתיקונים שלכם אחרי כל פרסום.',
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
    role: 'מתאר תמונות וריילים ובוחר תמונה לכל כתבה',
    about: 'רץ על Google Gemini. לכל כתבה כותב בעברית שלושה תיאורים שונים, אחד לכל סגנון שבהגדרות שלו, ומודל התמונות מצייר מכל תיאור תמונה. כשהכתבה על אישיות ציבורית, אחת משלוש האפשרויות היא צילום אמיתי שלה ממקור שמותר להשתמש בו עם קרדיט. אחר כך הוא מסתכל על האפשרויות ובוחר אחת; אפשר להחליף בלי עלות, והתמונה נוצרת באיכות מלאה רק באישור הסופי. כותב גם את שתי ההנחיות לריל. אחד, משותף לכל הסוכנים, ולומד מהבחירות שלכם.',
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
  ads: {
    name: 'סוכן הפרסום',
    role: 'מציע קמפיינים למפרסמים ובודק מודעות',
    about: 'מקבל תיאור קצר של עסק (ואת האתר שלו), ומציע קמפיין שלם: כותרות, טקסט, כפתור, מקומות ומדורים, טופס לידים ותיאור לתמונה. לפני שמודעה עולה הוא בודק אותה: הבטחות מטעות, פרסום פיננסי בלי גילוי, ומודעה שמתחפשת לכתבה. בסוף קמפיין הוא כותב למפרסם סיכום של המספרים. הוא רק מציע: אתם יוצרים את הקמפיין ומאשרים אותו.',
  },
};

/** The periods the agents' costs are shown for: the filter button, and the words after "עלות" / "עבודות". */
export const USAGE_PERIOD: Record<UsagePeriod, { label: string; when: string }> = {
  all: { label: 'כללי', when: 'מההתחלה' },
  day: { label: 'היום', when: 'היום' },
  month: { label: 'החודש', when: 'החודש' },
  year: { label: 'השנה', when: 'השנה' },
  custom: { label: 'התאמה אישית', when: 'בטווח' },
};

/** Every skill: its name, and what it is used for. */
export const SKILL: Record<string, { name: string; use: string }> = {
  'agent.system': { name: 'הנחיות העורך הראשי', use: 'איך הוא עונה בצ\'אט ומפעיל את הכלים' },
  'meeting.pitch': { name: 'ישיבת מערכת', use: 'איך מציעים כתבות מקוריות ממה שהאיתור מצא: הזווית, מה לבדוק ובאילו מקורות' },
  'discovery.pick': { name: 'המלצות באיתור', use: 'בסוף כל איתור: אילו סיפורים לקחת קודם, איזה ציון לתת ולמה. כמה המלצות ואילו מדורים הם פנאי קובעים ב"הגדרות ולמידה".' },
  'desk.plan': { name: 'סידור הכתבות באתר', use: 'כשה-AI מסיים לכתוב את הכתבות שנבחרו: מה כתבה ראשית, מה חדשות חמות, מה עולה לפס המבזקים, ומדור לכתבה שאין לה' },
  'research.system': { name: 'התחקיר', use: 'איך חוקרים דיווח או רעיון: סדר העבודה, אילו מקורות מותרים, ואיך מסמנים כל פרט' },
  'research.write': { name: 'כתיבה מתיק התחקיר', use: 'איך כל פרט נכתב בכתבה לפי הסימון שלו' },
  'research.update': { name: 'עדכון לכתבה קיימת', use: 'כשכבר כתבנו על הסיפור: רק מה שחדש, בפסקאות שנכנסות לראש הכתבה אחרי שהעורך מאשר' },
  'research.accounts': { name: 'חיפוש חשבונות רשמיים', use: 'הבדיקה השבועית של מאגר המקורות הרשמיים: איך מוצאים חשבונות שהאתר הרשמי לא מקשר אליהם בעמוד הבית' },
  'rewrite.system': { name: 'כתיבת כתבה מהמקור', use: 'כל כתבה חדשה. במקום הסימון {{style_rules}} המערכת מכניסה את סגנון הבית שנלמד ואת ההגדרות שלכם.' },
  'rewrite.combine': { name: 'כתבה אחת מכמה מקורות', use: 'כשבוחרים באיתור קבוצה של אותו סיפור מכמה אתרים: כתבה אחת, כל עובדה פעם אחת. במקום הסימון {{style_rules}} המערכת מכניסה את סגנון הבית ואת ההגדרות שלכם.' },
  'refine.system': { name: 'תיקון לפי הערה', use: 'ההערות בעורך: "תקצר", "כותרת חדה יותר"' },
  'review.system': { name: 'הבדיקה המשפטית', use: 'אילו סיכונים מחפשים בכל כתבה, ומה מסמנים' },
  'review.fix': { name: 'ניסוח זהיר', use: '"פרסום בזהירות מוגברת": איך מנסחים מחדש קטע עם סיכון' },
  'social.plan': { name: 'תוכנית הפצה', use: 'כשהטקסט סופי: מסגרת, פוסט, סטורי, ריל והטקסטים' },
  'social.kit': { name: 'פוסט וסטורי לכתבה שבאתר', use: 'דף הרשתות: "הכנה עם AI" לכתבות שכבר פורסמו' },
  'social.caption': { name: 'חבילת הרשתות הישנה', use: 'רק לכתבות שהוכנו לפני תוכנית ההפצה' },
  'visual.image': { name: 'תיאורי התמונה הראשית', use: 'שלושה תיאורים שונים לכל כתבה, אחד לכל סגנון בהגדרות: מה מודל התמונות מצייר' },
  'visual.pick': { name: 'בחירת התמונה', use: 'איך הסוכן בוחר אחת מהאפשרויות לתמונה הראשית' },
  'reel.prompts': { name: 'ההנחיות לריל', use: 'שתי ההנחיות בעברית: התמונה והסרטון' },
  'visual.learn': { name: 'למידה מהבחירות שלכם', use: 'כל כמה מקרים: מה העדפתם בתמונות ובריילים' },
  'reel.image': { name: 'תבנית לתמונת הריל', use: 'נשלחת למודל התמונות. באנגלית בכוונה: המודל מקבל אנגלית.' },
  'reel.video': { name: 'תבנית לסרטון הריל', use: 'נשלחת למודל הווידאו. באנגלית בכוונה: המודל מקבל אנגלית.' },
  'translate.system': { name: 'תרגום לעברית', use: 'כותרות אחרי האיתור, וכתבה מלאה לעורך' },
  'learning.batch': { name: 'למידה אחרי פרסום', use: 'מעדכן את כללי סגנון הבית ומסכם מה נלמד' },
  'newsroom.rules': { name: 'נהלי המערכת', use: 'כל סוכן שכותב קורא אותם אחרי הסקיל שלו' },
  'ads.brief': { name: 'הצעת קמפיין', use: '"פרסום" > "סוכן הפרסום": מה מציעים לעסק, ואיך מודעה טובה אצלנו נראית' },
  'ads.review': { name: 'בדיקת מודעה', use: 'לפני שמודעה עולה: מה בודקים בטקסט ובתמונה' },
  'ads.report': { name: 'סיכום למפרסם', use: 'הסיכום בעמוד הדוח של המפרסם, מהמספרים של הקמפיין' },
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

export const MEETING_STATUS: Record<MeetingStatus, { label: string; tone: Tone }> = {
  queued: { label: 'מתכנסת', tone: 'info' },
  thinking: { label: 'העורך הראשי חושב', tone: 'info' },
  ready: { label: 'ההצעות מוכנות', tone: 'ok' },
  failed: { label: 'לא הצליחה', tone: 'danger' },
};

export const PITCH_STATUS: Record<PitchStatus, { label: string; tone: Tone }> = {
  pending: { label: 'ממתינה להחלטה', tone: 'warn' },
  approved: { label: 'אושרה ונחקרת', tone: 'ok' },
  rejected: { label: 'לא עכשיו', tone: 'muted' },
};

export const ORG_KIND: Record<OrgKind, string> = {
  government: 'משרד ממשלתי',
  regulator: 'רגולטור',
  central_bank: 'בנק מרכזי',
  statistics: 'סטטיסטיקה',
  parliament: 'כנסת',
  court: 'בית משפט',
  municipality: 'רשות מקומית',
  exchange: 'בורסה',
  international: 'גוף בין-לאומי',
  company: 'חברה',
  other: 'אחר',
};

export const OFFICIAL_PLATFORM: Record<OfficialPlatform, string> = {
  x: 'X',
  telegram: 'טלגרם',
  facebook: 'פייסבוק',
  instagram: 'אינסטגרם',
  youtube: 'יוטיוב',
  linkedin: 'לינקדאין',
  tiktok: 'טיקטוק',
  threads: 'Threads',
};

export const ACCOUNT_STATUS: Record<AccountStatus, { label: string; tone: Tone }> = {
  verified: { label: 'מאומת', tone: 'ok' },
  pending: { label: 'ממתין לאישור', tone: 'warn' },
  missing: { label: 'האתר כבר לא מקשר', tone: 'muted' },
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
  'veo-3.1-lite-generate-preview': 'Veo 3.1 Lite (זול, ברירת המחדל)',
  'veo-3.1-fast-generate-preview': 'Veo 3.1 Fast (חד יותר, יקר יותר)',
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

// --- Advertising ------------------------------------------------------------------------------
const SLOT_WHERE: Record<AdSlot, string> = {
  home_top: 'מתחת לכתבות הראשיות בדף הבית',
  category_top: 'בראש כל עמוד מדור, מעל הכתבות',
  sidebar: 'בטור הצד של דף הבית ושל המדורים',
  article_side: 'בטור הצד של כתבה (במחשב)',
  article_end: 'אחרי הטקסט של הכתבה, לפני התגובות',
  app_feed: 'בין הכתבות בדף הבית של האפליקציה',
  app_article: 'אחרי כתבה באפליקציה',
};
export const AD_SLOT = Object.fromEntries(AD_SLOTS.map((s) => [s, { name: AD_SLOT_NAMES[s], where: SLOT_WHERE[s] }])) as Record<AdSlot, { name: string; where: string }>;

export const AD_FORMAT: Record<AdFormat, { name: string; size: string }> = {
  billboard: { name: 'באנר רחב', size: `מחשב ${adSize(970, 90)}, נייד ${adSize(320, 50)}` },
  rectangle: { name: 'מלבן', size: adSize(300, 250) },
  native: { name: 'בסגנון כתבה', size: 'תמונה 16:9, כותרת, שורה וכפתור' },
};

export const AD_STATUS: Record<AdStatus, { label: string; tone: Tone }> = {
  draft: { label: 'ממתין לאישור', tone: 'warn' },
  active: { label: 'רץ באתר', tone: 'ok' },
  paused: { label: 'מושהה', tone: 'muted' },
  ended: { label: 'הסתיים', tone: 'ink' },
};

export const AD_DEVICE: Record<AdDevice, string> = { all: 'מחשב ונייד', desktop: 'מחשב בלבד', mobile: 'נייד בלבד' };

/** How long an ad stays in a rotating place. */
export const AD_ROTATE: Record<number, string> = { 0: 'אחת בכל כניסה לעמוד', 15: 'כל 15 שניות', 20: 'כל 20 שניות', 30: 'כל 30 שניות', 60: 'כל דקה' };

/** A campaign's share of a place, as a seller says it: "רבע", "חצי", "כל השטח". */
export function adShare(share: number, positions: number): string {
  const n = Math.min(share, positions);
  if (n >= positions) return 'כל השטח';
  const words: Record<string, string> = { '1/2': 'חצי', '1/3': 'שליש', '2/3': 'שני שלישים', '1/4': 'רבע', '3/4': 'שלושה רבעים' };
  const g = (a: number, b: number): number => (b ? g(b, a % b) : a);
  const d = g(n, positions);
  return words[`${n / d}/${positions / d}`] ?? `${n} מתוך ${positions}`;
}
export const AD_GOAL: Record<AdGoal, string> = { leads: 'פניות (לידים)', traffic: 'כניסות לאתר שלהם', awareness: 'חשיפה' };
export const BANNER_THEME: Record<BannerTheme, string> = { dark: 'כהה', light: 'בהיר', brand: 'אדום', custom: 'הצבע של המפרסם' };
export const AD_VERDICT: Record<AdReviewDto['verdict'], { label: string; tone: Tone }> = {
  ok: { label: 'תקינה', tone: 'ok' },
  fix: { label: 'צריך תיקון', tone: 'warn' },
  block: { label: 'אסור לפרסם', tone: 'danger' },
};

/** Click rate, as advertisers say it ("0.42%"). */
export const ctr = (clicks: number, views: number) => (views ? `${((clicks / views) * 100).toFixed(2)}%` : '—');

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
