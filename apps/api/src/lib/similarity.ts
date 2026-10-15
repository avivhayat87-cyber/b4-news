// How much of a draft repeats its original word for word: facts are free to use,
// wording is protected, so the editor is warned before publishing copied passages.
import type { SimilarityDto } from '@b4/shared';

const SHINGLE = 6;
const MIN_PASSAGE_WORDS = 8;

type Token = { norm: string; text: string };

/** Lower case, no niqqud or punctuation; display text kept alongside. */
function tokens(text: string): Token[] {
  return text
    .split(/\s+/)
    .map((w) => ({ text: w, norm: w.toLowerCase().replace(/[֑-ׇ]/g, '').replace(/[^\p{L}\p{N}]+/gu, '') }))
    .filter((t) => t.norm.length > 0);
}

const key = (ts: Token[], i: number) => ts.slice(i, i + SHINGLE).map((t) => t.norm).join(' ');

/** fullPassages: whole passages (to hand to the AI) instead of shortened ones for display. */
export function compareWording(draft: string, original: string, opts: { fullPassages?: boolean } = {}): SimilarityDto {
  const d = tokens(draft);
  const o = tokens(original);
  if (d.length < SHINGLE || o.length < SHINGLE) return { ratio: 0, level: 'ok', passages: [] };

  const seen = new Set<string>();
  for (let i = 0; i + SHINGLE <= o.length; i++) seen.add(key(o, i));

  const total = d.length - SHINGLE + 1;
  const hit: boolean[] = [];
  for (let i = 0; i < total; i++) hit.push(seen.has(key(d, i)));
  const matched = hit.filter(Boolean).length;

  // A run of k matching shingles from position i covers words i .. i + k + SHINGLE - 2.
  const runs: { start: number; words: number }[] = [];
  for (let i = 0; i < total; ) {
    if (!hit[i]) {
      i++;
      continue;
    }
    let k = 0;
    while (i + k < total && hit[i + k]) k++;
    const words = k + SHINGLE - 1;
    if (words >= MIN_PASSAGE_WORDS) runs.push({ start: i, words });
    i += k;
  }
  runs.sort((a, b) => b.words - a.words);

  const ratio = matched / total;
  const longest = runs[0]?.words ?? 0;
  const level = ratio >= 0.3 || longest >= 25 ? 'high' : ratio >= 0.12 || longest >= 12 ? 'warn' : 'ok';
  const passages = runs.slice(0, 5).map((r) => {
    const text = d
      .slice(r.start, r.start + r.words)
      .map((t) => t.text)
      .join(' ');
    return !opts.fullPassages && text.length > 220 ? `${text.slice(0, 220)}…` : text;
  });
  return { ratio: Math.round(ratio * 1000) / 1000, level, passages };
}

/** Short words that say nothing about the subject. */
const STOP_WORDS = new Set(['של', 'על', 'את', 'עם', 'גם', 'כי', 'אם', 'לא', 'הוא', 'היא', 'הם', 'זה', 'זו', 'אך', 'או', 'כך', 'יותר', 'אחרי', 'לפני', 'בין', 'כל', 'עד', 'מה', 'יש', 'אין', 'היום', 'אחד', 'אחת', 'the', 'and', 'for', 'with']);

/** A word's forms to match on: as written, and without one Hebrew prefix letter (ו, ה, ב, ל, מ, ש, כ). */
function subjectWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const t of tokens(text)) {
    if (t.norm.length < 3 || STOP_WORDS.has(t.norm)) continue;
    out.add(t.norm);
    if (t.norm.length > 3 && /^[והבלמשכ]/.test(t.norm)) out.add(t.norm.slice(1));
  }
  return out;
}

/**
 * How much two short texts (headlines, summaries) are about the same thing: the share of the
 * shorter one's subject words found in the other, and how many were shared. Free and rough: a
 * hint for "we may already have this story", never a decision.
 */
export function topicOverlap(a: string, b: string): { score: number; shared: number } {
  const x = subjectWords(a);
  const y = subjectWords(b);
  if (x.size === 0 || y.size === 0) return { score: 0, shared: 0 };
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return { score: shared / Math.min(x.size, y.size), shared };
}

export function similarityWarning(result: SimilarityDto): string | null {
  if (result.level === 'ok') return null;
  const percent = Math.round(result.ratio * 100);
  return result.level === 'high'
    ? `הנוסח קרוב מאוד למקור (${percent}% מהרצפים חוזרים עליו מילה במילה). נסחו מחדש לפני פרסום.`
    : `יש קטעים שחוזרים על נוסח המקור (${percent}%). כדאי לנסח אותם מחדש.`;
}
