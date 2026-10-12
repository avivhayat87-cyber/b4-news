// What the newsroom asks of the AI. Two providers implement it: Anthropic
// (production) and a deterministic stand-in for local development and tests.
import { CATEGORY_SLUGS } from '@b4/shared';
import { z } from 'zod';

export type Usage = { model: string; inputTokens: number | null; outputTokens: number | null; latencyMs: number };
export type AiResult<T> = { data: T; usage: Usage };

export const RewriteOutput = z.object({
  title: z.string().min(1).max(200),
  subtitle: z.string().max(400),
  paragraphs: z.array(z.string()).min(1).max(80),
  suggested_category: z.enum(CATEGORY_SLUGS).nullable(),
  suggested_tags: z.array(z.string().max(40)).max(8),
  image_prompt: z.string().max(1000),
});
export type RewriteOutput = z.infer<typeof RewriteOutput>;

export const RefineOutput = z.object({
  title: z.string().min(1).max(200),
  subtitle: z.string().max(400),
  paragraphs: z.array(z.string()).min(1).max(80),
  /** One or two sentences to the editor about what changed. */
  reply: z.string().max(600),
});
export type RefineOutput = z.infer<typeof RefineOutput>;

export const SocialOutput = z.object({
  headline: z.string().min(1).max(120),
  caption: z.string().min(1).max(600),
  image_prompt: z.string().max(1000),
});
export type SocialOutput = z.infer<typeof SocialOutput>;

export const DistillOutput = z.object({ rules: z.string().min(1).max(6000) });
export type DistillOutput = z.infer<typeof DistillOutput>;

export type ArticleText = { title: string; subtitle: string; body: string };

export type RewriteRequest = {
  systemPrompt: string;
  source: { title: string; intro: string | null; body: string; sourceName: string; url: string };
};

export type RefineRequest = {
  styleRules: string;
  current: ArticleText;
  instruction: string;
  selection?: string;
  /** The original report, so "add the detail about X" can be answered from the facts. */
  original?: string;
};

export type SocialRequest = {
  systemPrompt: string;
  article: ArticleText;
  current?: { headline: string; caption: string };
  instruction?: string;
};

export type DistillRequest = {
  currentRules: string;
  examples: { aiText: string; finalText: string; diff: string; editRatio: number }[];
};

export interface TextAI {
  readonly provider: string;
  /** False for the development stand-in: the UI says the text was not really rewritten. */
  readonly live: boolean;
  rewrite(req: RewriteRequest): Promise<AiResult<RewriteOutput>>;
  refine(req: RefineRequest): Promise<AiResult<RefineOutput>>;
  social(req: SocialRequest): Promise<AiResult<SocialOutput>>;
  distill(req: DistillRequest): Promise<AiResult<DistillOutput>>;
}

export type ImageShape = 'landscape' | 'portrait';

export interface ImageAI {
  readonly provider: string;
  readonly model: string;
  readonly live: boolean;
  generate(prompt: string, opts: { count: number; shape: ImageShape }): Promise<Buffer[]>;
}

export type Ai = { text: TextAI; image: ImageAI };
