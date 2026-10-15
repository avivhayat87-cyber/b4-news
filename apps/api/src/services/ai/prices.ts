// What the AI costs at Anthropic's list prices, for the team's usage page and the research budget
// (the bill itself comes from Anthropic; these are estimates).

/** US dollars per million tokens (input, output). */
export const TEXT_PRICES: { model: string; input: number; output: number }[] = [
  { model: 'claude-opus-5-5', input: 4, output: 20 },
  { model: 'claude-sonnet-5-5', input: 2, output: 10 },
  { model: 'claude-haiku-5-5', input: 0.1, output: 0.5 },
];

/** One web search ($10 per thousand); the pages it reads are billed as tokens. */
export const WEB_SEARCH_USD = 0.01;

/** A text call's price, or null for a model without a known price (the stand-in, another provider). */
export function textCostUsd(model: string, inputTokens: number | null, outputTokens: number | null): number | null {
  const price = TEXT_PRICES.find((p) => model.startsWith(p.model));
  if (!price) return null;
  return ((inputTokens ?? 0) * price.input + (outputTokens ?? 0) * price.output) / 1_000_000;
}
