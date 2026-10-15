// What the AI costs at Anthropic's and Google's list prices, for the team's usage page and the
// research budget (the bills themselves come from Anthropic and Google; these are estimates).
import type { ImageAI } from './types';

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

/** US dollars per image, by the size it is drawn at (Google's Gemini API prices, October 2026). */
export const IMAGE_PRICES: { model: string; size: Partial<Record<string, number>> }[] = [
  { model: 'gemini-nano-banana-2.1', size: { '1K': 0.0336, '2K': 0.0504, '4K': 0.113 } },
  { model: 'gemini-3.1-flash-lite-image', size: { '1K': 0.0336 } },
  { model: 'gemini-3.1-flash-image', size: { '1K': 0.067, '2K': 0.101, '4K': 0.151 } },
  { model: 'gemini-3-pro-image', size: { '1K': 0.134, '2K': 0.134, '4K': 0.24 } },
];

/** What the images a generator drew cost, or null for the stand-in and a model or size without a known price. */
export function imageCostUsd(ai: Pick<ImageAI, 'model' | 'size' | 'live'>, count: number): number | null {
  const price = ai.live && ai.size ? IMAGE_PRICES.find((p) => ai.model.startsWith(p.model))?.size[ai.size] : undefined;
  return price === undefined ? null : price * count;
}
