import { describe, expect, it } from 'vitest';
import { checkFacts, extractFacts, factWarning } from '../src/lib/facts';

describe('fact check', () => {
  it('reads numbers, percentages, amounts and years regardless of formatting', () => {
    const keys = extractFacts('הריבית עלתה ל-4.5% ב-2026, ההשקעה: $40bn, כ-1,250 עובדים ו-3 שלבים').map((f) => f.key);
    expect(keys).toEqual(['4.5%', '2026', '40B', '1250']);
    expect(extractFacts('Rates at 4.50 percent').map((f) => f.key)).toEqual(['4.5%']);
  });

  it('finds facts that went missing and facts that the source does not have', () => {
    const source = 'The Fed kept rates at 4.5% for the 6th meeting. Shares rose 2.3%; the company plans $40bn of spending in 2027.';
    const draft = 'הפדרל ריזרב הותיר את הריבית על 4.5 אחוז. המניות עלו ב-2.3% והחברה מתכננת השקעה של 40 מיליארד דולר ב-2028.';
    const c = checkFacts(source, draft);
    expect(c.missing.map((f) => f.key)).toEqual(['2027']);
    expect(c.added.map((f) => f.key)).toEqual(['2028']);
    expect(factWarning(c)).toContain('2027');
    expect(factWarning(checkFacts('עלייה של 12%', 'עלייה של 12 אחוז'))).toBeNull();
  });
});
