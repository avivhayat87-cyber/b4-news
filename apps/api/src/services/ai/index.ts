import { type Db, aiJobs, and, desc, eq, promptTemplates, styleProfiles } from '@b4/db';
import type { Config } from '../../config';
import { AnthropicText } from './anthropic';
import { FakeText, PlaceholderImages } from './fake';
import { OpenAiImages } from './openai-images';
import type { Ai, Usage } from './types';

export type { Ai } from './types';

export function createAi(config: Config): Ai {
  const text =
    config.ai.text === 'anthropic' && config.ai.anthropicKey
      ? new AnthropicText(config.ai.anthropicKey, config.ai.model, config.ai.modelFast)
      : new FakeText();
  const image = config.ai.image === 'openai' && config.ai.openaiKey ? new OpenAiImages(config.ai.openaiKey, config.ai.imageModel) : new PlaceholderImages();
  return { text, image };
}

/** The active version of an editable prompt (prompt_templates). */
export async function activePrompt(db: Db, key: string): Promise<{ body: string; version: number }> {
  const [row] = await db
    .select({ body: promptTemplates.body, version: promptTemplates.version })
    .from(promptTemplates)
    .where(and(eq(promptTemplates.key, key), eq(promptTemplates.isActive, true)))
    .orderBy(desc(promptTemplates.version))
    .limit(1);
  if (!row) throw new Error(`no active prompt "${key}"`);
  return row;
}

/** House style learned from editors' corrections (the active style profile). */
export async function activeStyleRules(db: Db): Promise<string> {
  const [row] = await db.select({ rules: styleProfiles.rules }).from(styleProfiles).where(eq(styleProfiles.isActive, true)).orderBy(desc(styleProfiles.id)).limit(1);
  return row?.rules ?? 'אין עדיין כללים נלמדים. כתבו בעברית עיתונאית בהירה, משפטים קצרים, בלי סופרלטיבים.';
}

type AiJobType = (typeof aiJobs.$inferInsert)['type'];

/** Runs one AI call and records it in ai_jobs (tokens, latency, errors) for cost tracking. */
export async function tracked<T extends object>(
  db: Db,
  meta: { type: AiJobType; provider: string; draftId?: string | null; requestedBy?: string | null; promptKey?: string; promptVersion?: number; imageCount?: number; model?: string },
  call: () => Promise<T>,
): Promise<{ result: T; aiJobId: string }> {
  const started = Date.now();
  const [row] = await db
    .insert(aiJobs)
    .values({
      type: meta.type,
      provider: meta.provider,
      model: meta.model ?? 'pending',
      status: 'running',
      draftId: meta.draftId ?? null,
      requestedBy: meta.requestedBy ?? null,
      promptKey: meta.promptKey,
      promptVersion: meta.promptVersion,
      imageCount: meta.imageCount,
    })
    .returning({ id: aiJobs.id });
  const aiJobId = row!.id;
  try {
    const result = await call();
    const usage = (result as { usage?: Usage }).usage;
    await db
      .update(aiJobs)
      .set({
        status: 'succeeded',
        model: usage?.model ?? meta.model ?? 'unknown',
        inputTokens: usage?.inputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
        latencyMs: Date.now() - started,
        finishedAt: new Date(),
      })
      .where(eq(aiJobs.id, aiJobId));
    return { result, aiJobId };
  } catch (e) {
    await db
      .update(aiJobs)
      .set({ status: 'failed', error: (e instanceof Error ? e.message : String(e)).slice(0, 2000), latencyMs: Date.now() - started, finishedAt: new Date() })
      .where(eq(aiJobs.id, aiJobId));
    throw e;
  }
}
