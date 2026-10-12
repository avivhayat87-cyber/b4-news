// Deterministic stand-ins for local development and tests: no network, no
// cost, predictable output. The CMS shows a banner while these are active.
import sharp from 'sharp';
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

function hash(text: string): number {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}

const PALETTES = [
  ['#2B3B50', '#D9121F', '#F4F3F1'],
  ['#40354F', '#E8A33D', '#FFFFFF'],
  ['#2A4844', '#7FC8A9', '#F4F3F1'],
  ['#4D3E31', '#D9121F', '#EFEDEA'],
  ['#121214', '#3D7BD9', '#FFFFFF'],
  ['#5E5139', '#F2C94C', '#FFFFFF'],
];

/** Abstract, on-brand placeholder artwork (rings and shapes; no text). */
export class PlaceholderImages implements ImageAI {
  readonly provider = 'placeholder';
  readonly model = 'placeholder';
  readonly live = false;

  async generate(prompt: string, opts: { count: number; shape: ImageShape }): Promise<Buffer[]> {
    const [w, h] = opts.shape === 'portrait' ? [1080, 1920] : [1600, 900];
    const out: Buffer[] = [];
    for (let i = 0; i < opts.count; i++) {
      const seed = hash(`${prompt}#${i}#${Date.now()}`);
      const [bg, accent, light] = PALETTES[seed % PALETTES.length]!;
      const r = (n: number) => ((seed >> n) & 255) / 255;
      const cx = Math.round(w * (0.25 + r(3) * 0.5));
      const cy = Math.round(h * (0.25 + r(7) * 0.5));
      const radius = Math.round(Math.min(w, h) * (0.22 + r(11) * 0.2));
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
        <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="#000" stop-opacity="0.85"/></linearGradient></defs>
        <rect width="100%" height="100%" fill="${bg}"/><rect width="100%" height="100%" fill="url(#g)" opacity="0.6"/>
        <circle cx="${cx}" cy="${cy}" r="${radius}" fill="${accent}" opacity="0.92"/>
        <circle cx="${cx}" cy="${cy}" r="${Math.round(radius * 1.35)}" fill="none" stroke="${light}" stroke-width="${Math.round(radius * 0.05)}" stroke-dasharray="${Math.round(radius * 6)} ${Math.round(radius * 2.5)}" opacity="0.8"/>
        <rect x="${Math.round(w * r(15) * 0.6)}" y="${Math.round(h * (0.65 + r(19) * 0.2))}" width="${Math.round(w * 0.4)}" height="${Math.round(h * 0.04)}" fill="${light}" opacity="0.35"/>
      </svg>`;
      out.push(await sharp(Buffer.from(svg)).png().toBuffer());
    }
    return out;
  }
}
