import { describe, expect, it } from 'vitest';
import { InvalidDocError, docToHtml, docToText, excerptFrom, sanitizeDoc, textToDoc } from '../src/doc';

describe('sanitizeDoc', () => {
  it('drops unknown nodes, unknown marks and unsafe links', () => {
    const doc = sanitizeDoc({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'שלום', marks: [{ type: 'bold' }, { type: 'strike' }] }] },
        { type: 'codeBlock', content: [{ type: 'text', text: 'rm -rf' }] },
        { type: 'image', attrs: { src: 'x' } },
        { type: 'paragraph', content: [{ type: 'text', text: 'קישור', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] },
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'כותרת' }] },
      ],
    });
    expect(doc.content.map((b) => b.type)).toEqual(['paragraph', 'paragraph', 'heading']);
    expect(JSON.stringify(doc)).not.toContain('strike');
    expect(JSON.stringify(doc)).not.toContain('javascript');
    expect(doc.content[2]).toMatchObject({ attrs: { level: 2 } });
  });

  it('rejects things that are not documents and oversized documents', () => {
    expect(() => sanitizeDoc('<p>hi</p>')).toThrow(InvalidDocError);
    expect(() => sanitizeDoc({ type: 'paragraph' })).toThrow(InvalidDocError);
    const huge = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'א'.repeat(70_000) }] }] };
    expect(() => sanitizeDoc(huge)).toThrow(InvalidDocError);
  });
});

describe('docToHtml', () => {
  it('escapes text and attributes', () => {
    const html = docToHtml(
      sanitizeDoc({
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: '<script>alert("x")</script>' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'כאן', marks: [{ type: 'link', attrs: { href: 'https://example.com/?a="b"' } }] }] },
        ],
      }),
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('href="https://example.com/?a=%22b%22"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
  });

  it('keeps quotes and list items flat (no nested paragraphs)', () => {
    const html = docToHtml(textToDoc(['> ציטוט חשוב', '- אחד\n- שניים', '## ביניים']));
    expect(html).toBe('<blockquote>ציטוט חשוב</blockquote>\n<ul><li>אחד</li><li>שניים</li></ul>\n<h2>ביניים</h2>');
  });
});

describe('text helpers', () => {
  it('round-trips plain text blocks', () => {
    const text = 'פסקה ראשונה.\n\n## כותרת\n\nפסקה שנייה.';
    expect(docToText(textToDoc(text))).toBe(text);
  });

  it('cuts excerpts at a sentence boundary', () => {
    const long = `${'משפט ראשון שמסביר את העניין. '.repeat(5)}המשך`;
    const excerpt = excerptFrom(long, 120);
    expect(excerpt.length).toBeLessThanOrEqual(120);
    expect(excerpt.endsWith('.')).toBe(true);
  });
});
