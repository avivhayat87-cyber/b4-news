// The model behind the newsroom agent. Claude when a key is connected; a
// rule-based stand-in otherwise (local development, tests), so the chat and the
// approval flow work end to end without a key. Gemini can be added here later
// behind the same interface.
import Anthropic from '@anthropic-ai/sdk';
import { AiNotConnectedError } from '../ai';
import type { Usage } from '../ai/types';
import type { Services } from '../context';
import type { AgentTool } from './tools';

export type AgentStep = {
  content: Anthropic.Beta.BetaContentBlock[];
  stopReason: string | null;
  /** Same shape as the other AI calls, so tracked() records cost and latency in ai_jobs. */
  usage: Usage;
};

export interface AgentEngine {
  readonly provider: string;
  readonly live: boolean;
  readonly model: string;
  step(req: { system: string; tools: AgentTool[]; messages: Anthropic.Beta.BetaMessageParam[] }): Promise<AgentStep>;
}

/** The agent runs on the most capable Claude by default; the CMS can set another model. */
export const AGENT_MODEL = 'claude-opus-5-5';

class ClaudeEngine implements AgentEngine {
  readonly provider = 'anthropic';
  readonly live = true;
  private readonly client: Anthropic;
  constructor(
    apiKey: string,
    readonly model: string,
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 180_000 });
  }

  async step(req: { system: string; tools: AgentTool[]; messages: Anthropic.Beta.BetaMessageParam[] }): Promise<AgentStep> {
    const started = Date.now();
    const res = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: 16_000,
      system: req.system,
      tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema as Anthropic.Beta.BetaTool.InputSchema })),
      messages: req.messages,
      // Caches the growing conversation: each turn re-reads the previous ones from cache.
      cache_control: { type: 'ephemeral' },
      output_config: { effort: 'medium' },
      // If a request is declined by a safety classifier, the API retries it on a fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    return {
      content: res.content,
      stopReason: res.stop_reason,
      usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens, model: res.model, latencyMs: Date.now() - started },
    };
  }
}

/** Without a key: recognizes a few requests, calls the matching tool, and summarizes the result. */
class DemoEngine implements AgentEngine {
  readonly provider = 'fake';
  readonly live = false;
  readonly model = 'demo';

  async step(req: { messages: Anthropic.Beta.BetaMessageParam[] }): Promise<AgentStep> {
    const last = req.messages[req.messages.length - 1];
    const usage: Usage = { inputTokens: null, outputTokens: null, model: 'demo', latencyMs: 1 };
    const text = (t: string): AgentStep => ({ content: [{ type: 'text', text: t, citations: null }], stopReason: 'end_turn', usage });
    if (last && Array.isArray(last.content) && last.content.some((b) => b.type === 'tool_result')) {
      const results = last.content.filter((b): b is Anthropic.Beta.BetaToolResultBlockParam => b.type === 'tool_result');
      const body = results.map((r) => (typeof r.content === 'string' ? r.content : JSON.stringify(r.content))).join('\n').slice(0, 700);
      return text(`(מצב הדגמה: Claude עוד לא מחובר) זה מה שקיבלתי מהמערכת:\n${body}`);
    }
    const ask = typeof last?.content === 'string' ? last.content : '';
    const call = (name: string, input: Record<string, unknown>): AgentStep => ({
      content: [{ type: 'tool_use', id: `toolu_demo_${Date.now().toString(36)}`, name, input, caller: { type: 'direct' } } as Anthropic.Beta.BetaContentBlock],
      stopReason: 'tool_use',
      usage,
    });
    if (/איתור|סריקה|סרוק/.test(ask)) return call('start_discovery', { region: /חו["״]?ל|בינלאומ|מחו/.test(ask) ? 'international' : 'local' });
    if (/אתר/.test(ask)) return call('list_sources', {});
    if (/רשת|סושיאל|פוסט/.test(ask)) return call('social_status', { filter: 'pending' });
    if (/למד|כלל/.test(ask)) return call('learning_status', {});
    return call('newsroom_overview', {});
  }
}

export async function agentEngine(s: Services): Promise<AgentEngine> {
  if (s.config.ai.text !== 'fake') {
    const v = await s.settings.integration('anthropic');
    if (v.apiKey) return new ClaudeEngine(v.apiKey, AGENT_MODEL);
  }
  // Production without a key: say so, rather than answering from a stand-in.
  if (!s.config.ai.allowStandIns && s.config.ai.text !== 'fake') throw new AiNotConnectedError('text');
  return new DemoEngine();
}
