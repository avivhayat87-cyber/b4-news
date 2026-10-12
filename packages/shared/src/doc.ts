// The article body format. The CMS canvas (TipTap) edits a ProseMirror JSON
// document; this module is the only place that turns it into HTML or text.
//
// Allowed: paragraph, heading (2-3), blockquote, bulletList, orderedList,
// listItem, hardBreak, text with bold / italic / link marks. Anything else is
// dropped by sanitizeDoc, so stored documents never contain unknown nodes and
// the HTML built from them needs no HTML sanitizer.

export type Mark = { type: 'bold' } | { type: 'italic' } | { type: 'link'; attrs: { href: string } };
export type TextNode = { type: 'text'; text: string; marks?: Mark[] };
export type InlineNode = TextNode | { type: 'hardBreak' };
export type Paragraph = { type: 'paragraph'; content?: InlineNode[] };
export type Heading = { type: 'heading'; attrs: { level: 2 | 3 }; content?: InlineNode[] };
export type Blockquote = { type: 'blockquote'; content: Paragraph[] };
export type ListItem = { type: 'listItem'; content: Paragraph[] };
export type BulletList = { type: 'bulletList'; content: ListItem[] };
export type OrderedList = { type: 'orderedList'; content: ListItem[] };
export type Block = Paragraph | Heading | Blockquote | BulletList | OrderedList;
export type Doc = { type: 'doc'; content: Block[] };

export const DOC_LIMITS = { maxBlocks: 400, maxChars: 60_000 } as const;

export const EMPTY_DOC: Doc = { type: 'doc', content: [] };

export class InvalidDocError extends Error {}

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** http(s) links and site-relative paths only. */
export function safeHref(href: unknown): string | null {
  if (typeof href !== 'string') return null;
  const h = href.trim();
  if (h.length === 0 || h.length > 2000) return null;
  if (h.startsWith('/') && !h.startsWith('//')) return h;
  try {
    const url = new URL(h);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function cleanMarks(raw: unknown): Mark[] | undefined {
  const marks: Mark[] = [];
  for (const m of arr(raw)) {
    if (!isObj(m)) continue;
    if (m.type === 'bold' || m.type === 'italic') {
      if (!marks.some((x) => x.type === m.type)) marks.push({ type: m.type });
    } else if (m.type === 'link') {
      const href = safeHref(isObj(m.attrs) ? m.attrs.href : undefined);
      if (href && !marks.some((x) => x.type === 'link')) marks.push({ type: 'link', attrs: { href } });
    }
  }
  return marks.length ? marks : undefined;
}

function cleanInline(raw: unknown): InlineNode[] {
  const out: InlineNode[] = [];
  for (const n of arr(raw)) {
    if (!isObj(n)) continue;
    if (n.type === 'hardBreak') out.push({ type: 'hardBreak' });
    else if (n.type === 'text' && typeof n.text === 'string' && n.text.length > 0) {
      const marks = cleanMarks(n.marks);
      out.push(marks ? { type: 'text', text: n.text, marks } : { type: 'text', text: n.text });
    }
  }
  return out;
}

function paragraph(content: InlineNode[]): Paragraph {
  return content.length ? { type: 'paragraph', content } : { type: 'paragraph' };
}

/** Paragraphs inside a quote or list item; nested blocks are flattened to their text. */
function cleanParagraphs(raw: unknown): Paragraph[] {
  const out: Paragraph[] = [];
  for (const n of arr(raw)) {
    if (!isObj(n)) continue;
    if (n.type === 'paragraph' || n.type === 'heading') out.push(paragraph(cleanInline(n.content)));
    else if (n.type === 'blockquote' || n.type === 'listItem') out.push(...cleanParagraphs(n.content));
    else if (n.type === 'bulletList' || n.type === 'orderedList') {
      for (const li of arr(n.content)) if (isObj(li)) out.push(...cleanParagraphs(li.content));
    }
  }
  return out.length ? out : [paragraph([])];
}

function cleanList(raw: unknown): ListItem[] {
  return arr(raw)
    .filter(isObj)
    .filter((li) => li.type === 'listItem')
    .map((li) => ({ type: 'listItem' as const, content: cleanParagraphs(li.content) }));
}

/**
 * Validates and normalizes untrusted input (autosave requests, AI output).
 * Unknown nodes and marks are dropped; throws InvalidDocError when the
 * document is not a doc at all or is over the size limits.
 */
export function sanitizeDoc(input: unknown): Doc {
  if (!isObj(input) || input.type !== 'doc') throw new InvalidDocError('not a document');
  const content: Block[] = [];
  for (const n of arr(input.content)) {
    if (!isObj(n)) continue;
    switch (n.type) {
      case 'paragraph':
        content.push(paragraph(cleanInline(n.content)));
        break;
      case 'heading': {
        const level = isObj(n.attrs) && n.attrs.level === 3 ? 3 : 2;
        const inline = cleanInline(n.content);
        content.push(inline.length ? { type: 'heading', attrs: { level }, content: inline } : { type: 'heading', attrs: { level } });
        break;
      }
      case 'blockquote':
        content.push({ type: 'blockquote', content: cleanParagraphs(n.content) });
        break;
      case 'bulletList':
      case 'orderedList': {
        const items = cleanList(n.content);
        if (items.length) content.push({ type: n.type, content: items });
        break;
      }
      default:
        break;
    }
  }
  if (content.length > DOC_LIMITS.maxBlocks) throw new InvalidDocError('too many blocks');
  const doc: Doc = { type: 'doc', content };
  if (docToText(doc).length > DOC_LIMITS.maxChars) throw new InvalidDocError('too long');
  return doc;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c]!);
}

function inlineHtml(nodes: InlineNode[] | undefined): string {
  return (nodes ?? [])
    .map((n) => {
      if (n.type === 'hardBreak') return '<br>';
      let html = escapeHtml(n.text);
      for (const m of n.marks ?? []) {
        if (m.type === 'bold') html = `<strong>${html}</strong>`;
        else if (m.type === 'italic') html = `<em>${html}</em>`;
      }
      const link = n.marks?.find((m) => m.type === 'link');
      if (link && link.type === 'link') {
        const href = escapeHtml(link.attrs.href);
        html = link.attrs.href.startsWith('/')
          ? `<a href="${href}">${html}</a>`
          : `<a href="${href}" rel="noopener noreferrer nofollow" target="_blank">${html}</a>`;
      }
      return html;
    })
    .join('');
}

/** Paragraphs of a quote or list item, joined by line breaks (no nested <p>: the app's renderer expects flat blocks). */
function flatHtml(paragraphs: Paragraph[]): string {
  return paragraphs
    .map((p) => inlineHtml(p.content))
    .filter(Boolean)
    .join('<br>');
}

/** The published article HTML. Built from a sanitized doc, so it is safe by construction. */
export function docToHtml(doc: Doc): string {
  return doc.content
    .map((b) => {
      switch (b.type) {
        case 'paragraph': {
          const html = inlineHtml(b.content);
          return html ? `<p>${html}</p>` : '';
        }
        case 'heading': {
          const html = inlineHtml(b.content);
          return html ? `<h${b.attrs.level}>${html}</h${b.attrs.level}>` : '';
        }
        case 'blockquote': {
          const html = flatHtml(b.content);
          return html ? `<blockquote>${html}</blockquote>` : '';
        }
        case 'bulletList':
        case 'orderedList': {
          const tag = b.type === 'bulletList' ? 'ul' : 'ol';
          const items = b.content.map((li) => flatHtml(li.content)).filter(Boolean);
          return items.length ? `<${tag}>${items.map((i) => `<li>${i}</li>`).join('')}</${tag}>` : '';
        }
        default:
          return '';
      }
    })
    .filter(Boolean)
    .join('\n');
}

function inlineText(nodes: InlineNode[] | undefined): string {
  return (nodes ?? []).map((n) => (n.type === 'hardBreak' ? '\n' : n.text)).join('');
}

/**
 * Plain text, one block per paragraph (blank line between), with the same
 * markers textToDoc reads ("## ", "> ", "- "), so text <-> doc round-trips.
 * Used for diffs, the AI's input and the published excerpt.
 */
export function docToText(doc: Doc): string {
  const blocks: string[] = [];
  for (const b of doc.content) {
    if (b.type === 'paragraph') blocks.push(inlineText(b.content).trim());
    else if (b.type === 'heading') {
      const t = inlineText(b.content).trim();
      if (t) blocks.push(`${b.attrs.level === 3 ? '###' : '##'} ${t}`);
    } else if (b.type === 'blockquote') {
      const t = b.content.map((p) => inlineText(p.content).trim()).filter(Boolean).join(' ');
      if (t) blocks.push(`> ${t}`);
    } else {
      blocks.push(
        b.content
          .map((li) => li.content.map((p) => inlineText(p.content).trim()).filter(Boolean).join(' '))
          .filter(Boolean)
          .map((t) => `- ${t}`)
          .join('\n'),
      );
    }
  }
  return blocks.filter(Boolean).join('\n\n');
}

/**
 * Builds a doc from plain text blocks (AI output, scraped text, the manual
 * write form). Markers: "## " heading, "### " sub-heading, "> " quote,
 * lines starting with "- " form a bullet list.
 */
export function textToDoc(blocks: string[] | string): Doc {
  const parts = (Array.isArray(blocks) ? blocks : blocks.split(/\n\s*\n/)).map((b) => b.trim()).filter(Boolean);
  const content: Block[] = [];
  const text = (t: string): InlineNode[] => (t ? [{ type: 'text', text: t }] : []);
  for (const part of parts) {
    const lines = part.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.every((l) => /^[-•*]\s+/.test(l))) {
      content.push({
        type: 'bulletList',
        content: lines.map((l) => ({ type: 'listItem', content: [paragraph(text(l.replace(/^[-•*]\s+/, '')))] })),
      });
    } else if (part.startsWith('### ')) {
      content.push({ type: 'heading', attrs: { level: 3 }, content: text(part.slice(4).trim()) });
    } else if (part.startsWith('## ')) {
      content.push({ type: 'heading', attrs: { level: 2 }, content: text(part.slice(3).trim()) });
    } else if (part.startsWith('> ')) {
      content.push({ type: 'blockquote', content: [paragraph(text(lines.map((l) => l.replace(/^>\s?/, '')).join(' ')))] });
    } else {
      content.push(paragraph(text(lines.join(' '))));
    }
  }
  return { type: 'doc', content };
}

/** First paragraph-ish text, trimmed to a sentence boundary near `max` characters. */
export function excerptFrom(text: string, max = 220): string {
  const first = text.split(/\n\s*\n/).find((p) => p.trim() && !/^(- |#{2,3} |> )/.test(p))?.trim() ?? '';
  if (first.length <= max) return first;
  const cut = first.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
  return stop > max * 0.5 ? cut.slice(0, stop + 1) : `${cut.slice(0, cut.lastIndexOf(' ')).trim()}…`;
}

/** About 200 Hebrew words a minute; never less than one. */
export function readingMinutes(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}
