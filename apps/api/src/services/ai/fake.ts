// Deterministic stand-ins for local development and tests: no network, no
// cost, predictable output. The CMS shows a banner while these are active.
import sharp from 'sharp';
import { illustrationSvg } from '../../dev/illustrations';
import { classifyHeadline } from '../classify';
import type { AiResult, DistillRequest, ImageAI, ImageShape, RefineRequest, RewriteRequest, SocialRequest, TextAI } from './types';
import type { DistillOutput, RefineOutput, RewriteOutput, SocialOutput } from './types';

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
}

const SECTION_ORDER = ['israeli-economy', 'global-economy', 'capital-market', 'real-estate', 'insurance', 'hi-tech', 'health', 'automotive', 'entertainment', 'consumerism', 'tourism'];

/** Section-themed illustrations (the same art as the sample articles); no text. */
export class PlaceholderImages implements ImageAI {
  readonly provider = 'placeholder';
  readonly model = 'placeholder';
  readonly live = false;

  async generate(prompt: string, opts: { count: number; shape: ImageShape }): Promise<Buffer[]> {
    const [w, h] = opts.shape === 'portrait' ? [1080, 1920] : [1600, 900];
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
}