// Factual data an article must keep from its source: numbers, percentages,
// amounts and years. However far the wording moves from the original, these
// stay the same. The check compares the source (its Hebrew translation when
// there is one) with the draft: what went missing, and what appeared that the
// source doesn't have (possibly invented).

export type Fact = { value: string; key: string; context: string };
export type FactCheck = {
  /** Facts found in the source */
  sourceCount: number;
  /** In the source, not in the draft */
  missing: Fact[];
  /** In the draft, not in the source */
  added: Fact[];
};

const SCALE: [RegExp, string][] = [
  [/^(?:מיליארד|billion|bn|b)$/i, 'B'],
  [/^(?:מיליון|million|mn|m)$/i, 'M'],
  [/^(?:אלף|thousand|k)$/i, 'K'],
  [/^(?:%|אחוז|אחוזים|percent|per cent)$/i, '%'],
  [/^(?:נקודות בסיס|נ"ב|basis points|bps|bp)$/i, 'bp'],
];

// A number (1,234.5 / 1 234 / 4.5), optionally preceded by a currency sign and followed by a unit.
const PATTERN =
  /(?<![\p{L}\d.])[$€£₪]?\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s?(%|percent|per cent|אחוזים|אחוז|מיליארד|מיליון|אלף|billion|million|thousand|bn|mn|bps|bp|basis points|נקודות בסיס|נ"ב|k|m|b)?(?![\p{L}\d])/giu;

function unitOf(raw: string | undefined): string {
  if (!raw) return '';
  for (const [re, unit] of SCALE) if (re.test(raw.trim())) return unit;
  return '';
}

/** Every fact in a text, by a key that ignores formatting ("4.5%" = "4.5 אחוז", "$40bn" = "40 מיליארד"). */
export function extractFacts(text: string): Fact[] {
  const out: Fact[] = [];
  for (const m of text.matchAll(PATTERN)) {
    const whole = m[1]!.replace(/,/g, '');
    const decimals = (m[2] ?? '').replace(/0+$/, '');
    const unit = unitOf(m[3]);
    // A lone small integer ("3 שאלות", "שלב 2") is usually wording, not data; writers also spell it out.
    if (!unit && !decimals && whole.length < 2) continue;
    const key = `${Number(whole)}${decimals ? `.${decimals}` : ''}${unit}`;
    const at = m.index ?? 0;
    out.push({ value: m[0].trim(), key, context: text.slice(Math.max(0, at - 40), at + m[0].length + 40).replace(/\s+/g, ' ').trim() });
  }
  return out;
}

const unique = (facts: Fact[]) => [...new Map(facts.map((f) => [f.key, f])).values()];

export function checkFacts(source: string, draft: string): FactCheck {
  const fromSource = unique(extractFacts(source));
  const fromDraft = unique(extractFacts(draft));
  const draftKeys = new Set(fromDraft.map((f) => f.key));
  const sourceKeys = new Set(fromSource.map((f) => f.key));
  return {
    sourceCount: fromSource.length,
    missing: fromSource.filter((f) => !draftKeys.has(f.key)),
    added: fromDraft.filter((f) => !sourceKeys.has(f.key)),
  };
}

/** One line for a preview or an agent: null when the draft keeps every fact and adds none. */
export function factWarning(c: FactCheck): string | null {
  const parts: string[] = [];
  if (c.missing.length) parts.push(`${c.missing.length} נתונים מהמקור חסרים בכתבה (${c.missing.slice(0, 4).map((f) => f.value).join(', ')})`);
  if (c.added.length) parts.push(`${c.added.length} נתונים בכתבה לא מופיעים במקור (${c.added.slice(0, 4).map((f) => f.value).join(', ')})`);
  return parts.length ? `בדיקת נתונים: ${parts.join('; ')}.` : null;
}
