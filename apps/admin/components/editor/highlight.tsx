'use client';
// The original with the wording our draft repeats marked: the same test the
// server runs (6 words in a row, ignoring niqqud and punctuation).
const SHINGLE = 6;

const norm = (w: string) =>
  w
    .toLowerCase()
    .replace(/[֑-ׇ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');

type Word = { text: string; norm: string; para: number };

export function HighlightedText({ text, passages }: { text: string; passages: string[] }) {
  const keys = new Set<string>();
  for (const p of passages) {
    const ws = p.replace(/…$/, '').split(/\s+/).map(norm).filter(Boolean);
    for (let i = 0; i + SHINGLE <= ws.length; i++) keys.add(ws.slice(i, i + SHINGLE).join(' '));
  }

  // Paragraphs as the text-to-HTML path sees them ("## " sub-heading, "- " list item).
  const paragraphs = text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => ({ kind: p.startsWith('## ') ? 'h' : p.startsWith('- ') ? 'li' : 'p', body: p.replace(/^(##|-)\s+/, '') }));
  const words: Word[] = paragraphs.flatMap((p, para) => p.body.split(/\s+/).map((w) => ({ text: w, norm: norm(w), para })));

  // Shingles run over the counted words only (punctuation-only tokens are skipped, as on the server).
  const counted = words.flatMap((w, i) => (w.norm ? [i] : []));
  const marked = new Set<number>();
  for (let k = 0; k + SHINGLE <= counted.length; k++) {
    if (!keys.has(counted.slice(k, k + SHINGLE).map((i) => words[i]!.norm).join(' '))) continue;
    for (let j = counted[k]!; j <= counted[k + SHINGLE - 1]!; j++) marked.add(j);
  }

  return (
    <>
      {paragraphs.map((p, para) => {
        const runs: { text: string; marked: boolean }[] = [];
        words.forEach((w, i) => {
          if (w.para !== para) return;
          const last = runs.at(-1);
          if (last && last.marked === marked.has(i)) last.text += ` ${w.text}`;
          else runs.push({ text: last ? ` ${w.text}` : w.text, marked: marked.has(i) });
        });
        const content = runs.map((r, i) =>
          r.marked ? (
            <mark key={i} className="rounded-sm bg-warn-soft text-ink [box-decoration-break:clone]">
              {r.text}
            </mark>
          ) : (
            <span key={i}>{r.text}</span>
          ),
        );
        if (p.kind === 'h') return <h3 key={para}>{content}</h3>;
        if (p.kind === 'li') return <p key={para}>• {content}</p>;
        return <p key={para}>{content}</p>;
      })}
    </>
  );
}
