// Deterministic stand-ins for local development and tests: no network, no
// cost, predictable output. The CMS shows a banner while these are active.
import sharp from 'sharp';
import { illustrationSvg } from '../../dev/illustrations';
import { classifyHeadline } from '../classify';
import type { ResearchOutput, ResearchRequest, ResearchWriteOutput, ResearchWriteRequest } from './types';
import type { AiResult, DistillRequest, LearnBatchOutput, LearnBatchRequest, ImageAI, ImageReference, ImageShape, ImageTier, RefineRequest, ReviewFixOutput, ReviewFixRequest, ReviewOutput, ReviewRequest, RewriteRequest, ShareKitRequest, SocialPlanRequest, SocialRequest, TextAI, TranslateRequest } from './types';
import type { DistillOutput, EnglishOutput, ReelPromptsOutput, ReelPromptsRequest, RefineOutput, RewriteOutput, ShareKitOutput, SocialOutput, SocialPlanOutput, TranslateOutput, VideoAI, VideoRequest } from './types';
import type { ImagePromptOutput, ImagePromptRequest, VisualAI, VisualLearnRequest } from './types';

const usage = () => ({ model: 'fake', inputTokens: null, outputTokens: null, latencyMs: 1 });
const sentences = (text: string) => text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
const blocks = (text: string) => text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);

export class FakeText implements TextAI {
  readonly provider = 'fake';
  readonly live = false;

  async rewrite(req: RewriteRequest): Promise<AiResult<RewriteOutput>> {
    const s = req.source;
    const paragraphs = blocks(s.body);
    if (paragraphs.length === 0 && s.intro) paragraphs.push(s.intro);
    if (paragraphs[0]) paragraphs[0] = `לפי דיווח שפורסם ב${s.sourceName}, ${paragraphs[0]}`;
    const title = s.title.includes(':') ? s.title.split(':').reverse().map((p) => p.trim()).join(': ') : s.title;
    return {
      data: {
        title,
        subtitle: s.intro ?? sentences(s.body)[0] ?? '',
        paragraphs: paragraphs.length ? paragraphs : ['(אין טקסט במקור)'],
        suggested_category: classifyHeadline(`${s.title} ${s.intro ?? ''}`),
        suggested_tags: s.title.split(/\s+/).filter((w) => w.length > 3).slice(0, 3),
        image_prompt: `Editorial photo illustrating: ${s.title}`,
      },
      usage: usage(),
    };
  }

  async refine(req: RefineRequest): Promise<AiResult<RefineOutput>> {
    let paragraphs = blocks(req.current.body);
    let title = req.current.title;
    let reply = 'זה ספק ה-AI לדוגמה, ולכן הטקסט לא נכתב מחדש באמת.';
    if (/קצר|תקצר|קיצור/.test(req.instruction) && paragraphs.length > 1) {
      paragraphs = paragraphs.slice(0, -1);
      reply = 'קיצרתי: הסרתי את הפסקה האחרונה (ספק לדוגמה).';
    } else if (/כותרת/.test(req.instruction)) {
      title = `${title} (נוסח חדש)`;
      reply = 'הצעתי ניסוח אחר לכותרת (ספק לדוגמה).';
    } else if (req.selection && paragraphs.some((p) => p.includes(req.selection!))) {
      paragraphs = paragraphs.map((p) => (p.includes(req.selection!) ? `${p} (עודכן לפי ההערה)` : p));
      reply = 'סימנתי את הפסקה שביקשת לתקן (ספק לדוגמה).';
    }
    return { data: { title, subtitle: req.current.subtitle, paragraphs, reply }, usage: usage() };
  }

  async social(req: SocialRequest): Promise<AiResult<SocialOutput>> {
    const two = sentences(`${req.article.subtitle} ${req.article.body}`).slice(0, 2).join(' ');
    const headline = req.article.title.length > 60 ? `${req.article.title.slice(0, 57)}…` : req.article.title;
    return {
      data: { headline, caption: two || req.article.title, image_prompt: `Bold vertical story image about: ${req.article.title}` },
      usage: usage(),
    };
  }

  async shareKit(req: ShareKitRequest): Promise<AiResult<ShareKitOutput>> {
    const a = req.article;
    const template = /מדריך|איך|כך |טיפים|זכויות|מה צריך|המדריך/.test(a.title)
      ? 'explainer'
      : /מבזק|עכשיו|הודיע|החליט|זינק|צנח|נחתך/.test(a.title)
        ? 'breaking'
        : /\d+%/.test(a.title)
          ? 'quote'
          : 'headline';
    const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, s.lastIndexOf(' ', n - 1)).replace(/[,:;.\-–]+$/, '')}…`);
    const [first = a.title, second = ''] = sentences(`${a.subtitle} ${a.body}`.replace(/\s+/g, ' ').trim());
    const short = req.instruction && /קצר|תקצר|קיצור/.test(req.instruction);
    return {
      data: {
        template: req.current ? 'headline' : template,
        kicker: template === 'breaking' ? 'מבזק' : template === 'explainer' ? 'מדריך' : a.section,
        headline: clip(a.title, 70),
        hook: clip(first, short ? 70 : 130),
        caption: `${second ? `${clip(second, 200)} ` : ''}ספרו לנו בתגובות: איך זה משפיע עליכם?`,
        hashtags: [a.section.replace(/["'״׳]/g, '').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, ''), 'כלכלה'].filter(Boolean),
      },
      usage: usage(),
    };
  }

  /** The kit above, plus simple rules: a story unless it's a guide, a reel for stories with a visual world. */
  async socialPlan(req: SocialPlanRequest): Promise<AiResult<SocialPlanOutput>> {
    const { data: kit } = await this.shareKit({ systemPrompt: req.systemPrompt, article: req.article, instruction: req.instruction });
    const a = req.article;
    const visual = /נמל|דירות|דיור|נדל"?ן|בנייה|מחירי|סופר|דלק|רכב|טיסות|תיירות/.test(`${a.title} ${a.subtitle}`);
    const story = kit.template !== 'explainer';
    return {
      data: {
        ...kit,
        template_reason: kit.template === 'breaking' ? 'חדשות שקרו עכשיו.' : kit.template === 'explainer' ? 'כתבת שירות.' : 'כתבה רגילה עם כותרת חזקה.',
        feed: true,
        story,
        formats_reason: story ? 'פוסט וסטורי: מעניין רבים ויש בו נקודה חדה.' : 'פוסט בלבד: מדריך ארוך בלי נקודה אחת לסטורי.',
        reel_recommended: visual,
        reel_reason: visual ? 'יש לסיפור עולם ויזואלי שאפשר להניע.' : 'אין בסיפור תמונה שזזה.',
        reel_idea: visual ? `תמונה רחבה של הנושא: ${a.title}. המצלמה מתקרבת לאט.` : '',
        reel_motion: 'zoom_in',
        reel_seconds: 8,
      },
      usage: usage(),
    };
  }

  /**
   * No search: the file is made from what was handed in. A link's sentences are "reported" by its
   * site ("verified" on a government site); a screenshot's note stays unverified.
   */
  async research(req: ResearchRequest): Promise<AiResult<ResearchOutput> & { searches: number; toolErrors: string[] }> {
    const url = req.input.url ?? '';
    const host = url ? new URL(url).hostname.replace(/^www\./, '') : '';
    const official = /(^|\.)gov\.il$/.test(host);
    const text = req.input.pageText ?? '';
    const lines = sentences(text.replace(/\s+/g, ' ')).slice(0, 4);
    const claims: ResearchOutput['claims'] = lines.map((line) => ({ text: line, label: official ? 'verified' : 'reported', source_urls: [url], note: '' }));
    if (req.input.note) claims.push({ text: req.input.note, label: 'unverified', source_urls: [], note: 'מההערה של העורך, לא נבדק (ספק לדוגמה).' });
    return {
      data: {
        original: { who: host || 'צילום מסך', when: '', what: lines[0] ?? req.input.note, url },
        summary: `(ספק לדוגמה) ${lines[0] ?? req.input.note ?? 'אין פרטים.'}`,
        claims,
        background: [],
        open_questions: ['(ספק לדוגמה) לא בוצע חיפוש: אין מפתח AI.'],
        response_needed: [],
        sources: url ? [{ url, title: lines[0] ?? host, publisher: host, kind: official ? 'official' : 'news', used_for: official ? 'fact' : 'lead' }] : [],
      },
      usage: usage(),
      searches: 0,
      toolErrors: [],
    };
  }

  /** The file's details become the paragraphs, as they are. */
  async researchWrite(req: ResearchWriteRequest): Promise<AiResult<ResearchWriteOutput>> {
    const lines = req.dossier.split('\n');
    const summary = lines.find((l) => l.startsWith('סיכום:'))?.slice('סיכום:'.length).trim() ?? '';
    // "- [label] text (מקורות: …) | הערה: …": what may be written, without its label and sources.
    const details = lines
      .map((l) => /^- \[(\w+)\] (.*?)(?: \(מקורות: [^)]*\))?(?: \| הערה: .*)?$/.exec(l))
      .filter((m): m is RegExpExecArray => m !== null && m[1] !== 'unverified')
      .map((m) => m[2]!);
    const title = (summary.replace(/^\(ספק לדוגמה\)\s*/, '') || details[0] || 'תחקיר לדוגמה').slice(0, 90);
    return {
      data: { title, subtitle: '', paragraphs: details.length ? details : [summary || '(אין פרטים)'], suggested_category: classifyHeadline(title), suggested_tags: [] },
      usage: usage(),
    };
  }

  /** Finds the risky sentences by a few words, so the review flow works without an AI key. */
  async review(req: ReviewRequest): Promise<AiResult<ReviewOutput>> {
    const RULES: [ReviewOutput['issues'][number]['flag'], RegExp, string][] = [
      ['private_suspect', /נחשד ב/, 'להסיר את השם ולייחס את החשד למשטרה'],
      ['minor_or_victim', /קטין בן|קטינה בת|נפגעת עבירת מין/, 'להסיר את הפרטים המזהים'],
      ['gag_order', /צו איסור פרסום/, 'לבדוק אם הותר לפרסם'],
      ['security', /מבצע צבאי/, 'להעביר לצנזורה לפני פרסום'],
      ['market_rumor', /לפי שמועות/, 'לייחס במפורש ולציין שלא אושר'],
      ['no_response', /הטעתה את הלקוחות/, 'לפנות לתגובה'],
    ];
    const a = req.article;
    const fields: [ReviewOutput['issues'][number]['where'], string][] = [
      ['title', a.title],
      ['subtitle', a.subtitle],
      ['body', a.body],
    ];
    const issues: ReviewOutput['issues'] = [];
    for (const [where, text] of fields) {
      for (const sentence of text.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean)) {
        const rule = RULES.find(([, re]) => re.test(sentence));
        if (rule && !issues.some((i) => i.quote === sentence)) issues.push({ flag: rule[0], where, quote: sentence, subject: '', why: 'נמצאה מילה שמעידה על סיכון.', advice: rule[2] });
      }
    }
    return { data: { issues }, usage: usage() };
  }

  async reviewFix(req: ReviewFixRequest): Promise<AiResult<ReviewFixOutput>> {
    return { data: { after: `לכאורה, ${req.quote.replace(/^\s+/, '')}` }, usage: usage() };
  }

  /** Marks the text instead of translating it, so the flow is visible without an AI key. */
  async translate(req: TranslateRequest): Promise<AiResult<TranslateOutput>> {
    const mark = (t: string | null | undefined) => (t ? `(תרגום לדוגמה) ${t}` : '');
    return { data: { items: req.items.map((i) => ({ id: i.id, title: mark(i.title), intro: mark(i.intro), body: mark(i.body) })) }, usage: usage() };
  }

  async distill(req: DistillRequest): Promise<AiResult<DistillOutput>> {
    const avg = req.examples.reduce((sum, e) => sum + e.editRatio, 0) / Math.max(1, req.examples.length);
    const shorter = req.examples.filter((e) => e.finalText.length < e.aiText.length * 0.9).length;
    const rules = [
      req.currentRules.trim(),
      `- (ספק לדוגמה) נלמד מ-${req.examples.length} כתבות; העורכים שינו בממוצע ${Math.round(avg * 100)}% מהטקסט.`,
      shorter > req.examples.length / 2 ? '- העורכים מקצרים את רוב הכתבות: לכתוב קצר יותר מההתחלה.' : '',
    ]
      .filter(Boolean)
      .join('\n');
    return { data: { rules }, usage: usage() };
  }

  async learnBatch(req: LearnBatchRequest): Promise<AiResult<LearnBatchOutput>> {
    const avg = req.articles.reduce((sum, a) => sum + a.editRatio, 0) / Math.max(1, req.articles.length);
    const sections = [...new Set(req.articles.map((a) => a.section))].join(', ');
    const rules = [req.currentRules.trim(), `- (ספק לדוגמה) נלמד מקבוצה של ${req.articles.length} כתבות (${sections}); העורכים שינו בממוצע ${Math.round(avg * 100)}% מהטקסט.`]
      .filter(Boolean)
      .join('\n');
    return {
      data: { rules, summary: `(ספק לדוגמה) נקראו ${req.articles.length} כתבות מהמדורים ${sections} בקריאה אחת. העורכים שינו בממוצע ${Math.round(avg * 100)}% מהטקסט.` },
      usage: usage(),
    };
  }

  /** The stand-in doesn't translate; the image stand-in only guesses a section from the words. */
  async toEnglish(texts: string[]): Promise<AiResult<EnglishOutput>> {
    return { data: { texts }, usage: usage() };
  }
}

/** The visual agent's stand-in: Hebrew prompts from templates, and a learning pass that only counts. */
export class FakeVisual implements VisualAI {
  readonly provider = 'fake';
  readonly model = 'fake';
  readonly live = false;

  async imagePrompt(req: ImagePromptRequest): Promise<AiResult<ImagePromptOutput>> {
    const idea = req.tried.length ? ` (רעיון ${req.tried.length + 1})` : '';
    return {
      data: { prompt: `צילום עיתונאי לכתבה "${req.article.title}": מקום וחפצים שקשורים לנושא, אור טבעי, בלי טקסט ובלי אנשים מזוהים.${idea}` },
      usage: usage(),
    };
  }

  async reelPrompts(req: ReelPromptsRequest): Promise<AiResult<ReelPromptsOutput>> {
    const subject = req.article.title;
    const direction = req.instruction ? ` ${req.instruction}.` : '';
    return {
      data: {
        image_prompt: `צילום חדשותי אנכי לכתבה "${subject}": מקום וחפצים שקשורים לנושא, אור טבעי רך, בלי טקסט ובלי אנשים מזוהים.${direction}`,
        video_prompt: `המצלמה מתקרבת לאט ובאופן אחיד, תנועה טבעית עדינה בסצנה, אווירה רגועה ורצינית של חדשות.${direction}`,
      },
      usage: usage(),
    };
  }

  async learn(req: VisualLearnRequest): Promise<AiResult<LearnBatchOutput>> {
    const pictures = req.cases.reduce((n, c) => n + c.images.length, 0);
    return {
      data: {
        rules: [req.currentRules.trim(), `- (ספק לדוגמה) נלמד מ-${req.cases.length} מקרים ו-${pictures} תמונות.`].filter(Boolean).join('\n'),
        summary: `(ספק לדוגמה) נקראו ${req.cases.length} מקרים בקריאה אחת, עם ${pictures} תמונות.`,
      },
      usage: usage(),
    };
  }
}

const SECTION_ORDER = ['israeli-economy', 'global-economy', 'capital-market', 'real-estate', 'insurance', 'hi-tech', 'health', 'automotive', 'entertainment', 'consumerism', 'tourism'];

/** Section-themed illustrations (the same art as the sample articles); no text. Drafts are drawn smaller. */
export class PlaceholderImages implements ImageAI {
  readonly provider = 'placeholder';
  readonly model = 'placeholder';
  readonly live = false;

  constructor(private readonly tier: ImageTier = 'final') {}

  private size(shape: ImageShape): [number, number] {
    const [w, h] = shape === 'portrait' ? [1080, 1920] : [1600, 900];
    return this.tier === 'draft' ? [Math.round(w * 0.64), Math.round(h * 0.64)] : [w, h];
  }

  async generate(prompt: string, opts: { count: number; shape: ImageShape }): Promise<Buffer[]> {
    const [w, h] = this.size(opts.shape);
    const guessed = classifyHeadline(prompt);
    const out: Buffer[] = [];
    for (let i = 0; i < opts.count; i++) {
      // The guessed section first, then neighbours, so the options differ.
      const base = guessed ? SECTION_ORDER.indexOf(guessed) : prompt.length % SECTION_ORDER.length;
      const category = SECTION_ORDER[(Math.max(0, base) + i) % SECTION_ORDER.length]!;
      const svg = illustrationSvg(category, `${prompt}#${i}#${Date.now()}`, w, h);
      out.push(await sharp(Buffer.from(svg)).png().toBuffer());
    }
    return out;
  }

  /** The same picture, enlarged: what the editor chose is what they get. */
  async finish(_prompt: string, draft: ImageReference, shape: ImageShape): Promise<Buffer> {
    const [w, h] = this.size(shape);
    return sharp(draft.data).resize(w, h, { fit: 'cover' }).png().toBuffer();
  }
}

/** No video model without a key: the reel keeps its designed first frame, and the CMS says no video was made. */
export class PlaceholderVideo implements VideoAI {
  readonly provider = 'placeholder';
  readonly model = 'placeholder';
  readonly live = false;

  async generate(_req: VideoRequest): Promise<AiResult<{ video: Buffer | null; mimeType: string }>> {
    return { data: { video: null, mimeType: 'video/mp4' }, usage: usage() };
  }
}