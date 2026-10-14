// The chat with the newsroom agent. Each message is a background turn: the
// model reads the conversation, calls tools, and answers. Read tools run at
// once. A tool that changes something stops the turn: the chat shows it with
// approve / decline, and the turn continues only after the person decides.
// The Messages API history is append-only (stored as sent and received).
import type Anthropic from '@anthropic-ai/sdk';
import type { AgentActionData, AgentConversationDto, AgentConversationSummary, AgentStatusDto } from '@b4/shared';
import { agentConversations, agentMessages, and, asc, desc, eq, inArray, sql, users } from '@b4/db';
import { AppError, errors } from '../../errors';
import { PermanentJobError, enqueue, type JobRow } from '../../lib/jobs';
import { tracked, writerPrompt } from '../ai';
import type { Services } from '../context';
import { AGENT_MODEL, agentEngine } from './engine';
import { type AgentStaff, allowed, runTool, toolByName, toolsFor } from './tools';

export const AGENT_TURN_JOB = 'agent.turn';
const MAX_STEPS = 12;
const RESULT_LIMIT = 24_000;

type History = Anthropic.Beta.BetaMessageParam[];
type ActionRow = AgentActionData & { resultForModel?: string; isError?: boolean };

/** The editable prompt (prompt_templates "agent.system") plus who is asking. */
function systemPrompt(body: string, staff: AgentStaff): string {
  return `${body}\n\nThe editor you are talking to: ${staff.fullName} (role: ${staff.role}).`;
}

async function loadConversation(s: Services, staff: { id: string }, id: string) {
  const [conv] = await s.db.select().from(agentConversations).where(eq(agentConversations.id, id)).limit(1);
  if (!conv || conv.userId !== staff.id) throw errors.notFound('השיחה');
  return conv;
}

async function staffOf(s: Services, userId: string): Promise<AgentStaff> {
  const [u] = await s.db.select({ id: users.id, fullName: users.fullName, role: users.role, isActive: users.isActive }).from(users).where(eq(users.id, userId)).limit(1);
  if (!u?.isActive) throw new PermanentJobError('user not found or inactive');
  return { id: u.id, fullName: u.fullName, role: u.role };
}

const say = (s: Services, conversationId: string, kind: 'user' | 'assistant' | 'notice', text: string) => s.db.insert(agentMessages).values({ conversationId, kind, text });

// --- Reading -------------------------------------------------------------------------------
export async function agentStatus(s: Services, staff: AgentStaff): Promise<AgentStatusDto> {
  let live = false;
  try {
    live = (await agentEngine(s)).live;
  } catch {
    live = false;
  }
  return { live, model: live ? AGENT_MODEL : 'demo', tools: toolsFor(staff).map((t) => ({ name: t.name, label: t.label({}), description: t.description, write: t.write })) };
}

export async function listConversations(s: Services, staff: { id: string }): Promise<AgentConversationSummary[]> {
  const rows = await s.db
    .select({ id: agentConversations.id, title: agentConversations.title, status: agentConversations.status, updatedAt: agentConversations.updatedAt })
    .from(agentConversations)
    .where(eq(agentConversations.userId, staff.id))
    .orderBy(desc(agentConversations.updatedAt))
    .limit(50);
  return rows.map((r) => ({ ...r, status: r.status as AgentConversationSummary['status'], updatedAt: r.updatedAt.toISOString() }));
}

export async function conversationDto(s: Services, staff: { id: string }, id: string): Promise<AgentConversationDto> {
  const conv = await loadConversation(s, staff, id);
  const msgs = await s.db.select().from(agentMessages).where(eq(agentMessages.conversationId, id)).orderBy(asc(agentMessages.id));
  return {
    id: conv.id,
    title: conv.title,
    status: conv.status as AgentConversationDto['status'],
    updatedAt: conv.updatedAt.toISOString(),
    engine: conv.engine,
    lastError: conv.lastError,
    messages: msgs.map((m) => {
      const a = m.data as ActionRow | null;
      return {
        id: m.id,
        kind: m.kind as 'user' | 'assistant' | 'action' | 'notice',
        text: m.text,
        action: a ? { toolUseId: a.toolUseId, tool: a.tool, label: a.label, input: a.input, write: a.write, status: a.status, outcome: a.outcome } : null,
        createdAt: m.createdAt.toISOString(),
      };
    }),
  };
}

// --- Sending ---------------------------------------------------------------------------------
export async function sendMessage(s: Services, staff: AgentStaff, input: { conversationId?: string; text: string }): Promise<{ conversationId: string }> {
  let conv = input.conversationId ? await loadConversation(s, staff, input.conversationId) : null;
  if (conv?.status === 'failed') {
    await resetFailed(s, staff, conv.id);
    conv = await loadConversation(s, staff, conv.id);
  }
  if (conv && conv.status === 'working') throw new AppError(409, 'agent_busy', 'הסוכן עוד עובד על ההודעה הקודמת.');
  if (conv && conv.status === 'awaiting_approval') throw new AppError(409, 'awaiting_approval', 'הסוכן מחכה שתאשרו או תדחו את הפעולה שהציע.');
  if (!conv) {
    const [created] = await s.db
      .insert(agentConversations)
      .values({ userId: staff.id, title: input.text.replace(/\s+/g, ' ').slice(0, 60) })
      .returning();
    conv = created!;
  }
  const history = [...(conv!.history as History), { role: 'user', content: input.text } as Anthropic.Beta.BetaMessageParam];
  await say(s, conv!.id, 'user', input.text);
  await s.db.update(agentConversations).set({ history, status: 'working', lastError: null }).where(eq(agentConversations.id, conv!.id));
  await enqueue(s.db, AGENT_TURN_JOB, { conversationId: conv!.id }, { createdBy: staff.id, maxAttempts: 1 });
  return { conversationId: conv!.id };
}

const clipResult = (value: unknown) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > RESULT_LIMIT ? `${text.slice(0, RESULT_LIMIT)}… (הקיצור של המערכת)` : text;
};

// --- The turn (background job) -------------------------------------------------------------------
export async function runAgentTurn(s: Services, job: JobRow) {
  const conversationId = String(job.payload.conversationId);
  const [conv] = await s.db.select().from(agentConversations).where(eq(agentConversations.id, conversationId)).limit(1);
  if (!conv || conv.status !== 'working') return { skipped: true };
  const staff = await staffOf(s, conv.userId);
  const engine = await agentEngine(s);
  const tools = toolsFor(staff);
  const prompt = await writerPrompt(s.db, 'agent.system');
  const system = systemPrompt(prompt.body, staff);
  const history = [...(conv.history as History)];

  for (let step = 0; step < MAX_STEPS; step++) {
    const { result: res } = await tracked(s.db, { type: 'agent_turn', provider: engine.provider, requestedBy: staff.id, promptKey: 'agent.system', promptVersion: prompt.version }, () =>
      engine.step({ system, tools, messages: history }),
    );
    history.push({ role: 'assistant', content: res.content as Anthropic.Beta.BetaContentBlockParam[] });
    const text = res.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    if (text) await say(s, conversationId, 'assistant', text);

    if (res.stopReason === 'refusal') {
      await say(s, conversationId, 'notice', 'ה-AI סירב לבקשה הזו. נסו לנסח אחרת.');
      break;
    }
    const uses = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    if (res.stopReason !== 'tool_use' || uses.length === 0) {
      if (res.stopReason === 'max_tokens') await say(s, conversationId, 'notice', 'התשובה נקטעה כי הייתה ארוכה מדי.');
      break;
    }

    // Reads run now; writes wait for the person.
    let waiting = 0;
    for (const use of uses) {
      const tool = toolByName.get(use.name);
      const data: ActionRow = {
        toolUseId: use.id,
        tool: use.name,
        label: tool ? safeLabel(tool.label, use.input) : use.name,
        input: use.input,
        write: Boolean(tool?.write),
        status: 'pending',
        outcome: null,
      };
      if (tool?.write && allowed(tool, staff)) {
        waiting++;
      } else {
        const r = await runTool(s, staff, use.name, use.input);
        data.status = r.ok ? 'done' : 'failed';
        data.outcome = r.ok ? r.outcome : r.error;
        data.resultForModel = r.ok ? clipResult(r.result) : r.error;
        data.isError = !r.ok;
      }
      await s.db.insert(agentMessages).values({ conversationId, kind: 'action', text: '', data });
    }
    if (waiting) {
      await s.db.update(agentConversations).set({ history, status: 'awaiting_approval' }).where(eq(agentConversations.id, conversationId));
      return { awaiting: waiting };
    }
    history.push({ role: 'user', content: await toolResults(s, conversationId, uses.map((u) => u.id)) });
  }
  await s.db.update(agentConversations).set({ history, status: 'idle' }).where(eq(agentConversations.id, conversationId));
  return { done: true };
}

function safeLabel(label: (input: unknown) => string, input: unknown): string {
  try {
    return label(input ?? {});
  } catch {
    return '';
  }
}

async function actionRows(s: Services, conversationId: string, toolUseIds: string[]) {
  return s.db
    .select()
    .from(agentMessages)
    .where(and(eq(agentMessages.conversationId, conversationId), eq(agentMessages.kind, 'action'), inArray(sql<string>`${agentMessages.data}->>'toolUseId'`, toolUseIds)));
}

/** All results of one assistant turn, in one user message (as the API requires). */
async function toolResults(s: Services, conversationId: string, toolUseIds: string[]): Promise<Anthropic.Beta.BetaToolResultBlockParam[]> {
  const rows = await actionRows(s, conversationId, toolUseIds);
  return toolUseIds.map((id) => {
    const a = rows.find((r) => (r.data as ActionRow).toolUseId === id)?.data as ActionRow | undefined;
    return { type: 'tool_result', tool_use_id: id, content: a?.resultForModel ?? 'אין תוצאה', ...(a?.isError ? { is_error: true } : {}) };
  });
}

/** Approve or decline a proposed change; when nothing is left waiting, the turn continues. */
export async function decideAction(s: Services, staff: AgentStaff, conversationId: string, toolUseId: string, approve: boolean) {
  const conv = await loadConversation(s, staff, conversationId);
  if (conv.status !== 'awaiting_approval') throw new AppError(409, 'not_waiting', 'אין פעולה שמחכה לאישור.');
  const [row] = await actionRows(s, conversationId, [toolUseId]);
  const a = row?.data as ActionRow | undefined;
  if (!row || !a || a.status !== 'pending') throw errors.notFound('הפעולה');

  // Claim it first, so a double click can't run it twice.
  const [claimed] = await s.db
    .update(agentMessages)
    .set({ data: { ...a, status: approve ? 'approved' : 'declined' } })
    .where(and(eq(agentMessages.id, row.id), sql`${agentMessages.data}->>'status' = 'pending'`))
    .returning({ id: agentMessages.id });
  if (!claimed) return;
  let next: ActionRow;
  if (approve) {
    const r = await runTool(s, staff, a.tool, a.input);
    next = { ...a, status: r.ok ? 'done' : 'failed', outcome: r.ok ? r.outcome : r.error, resultForModel: r.ok ? clipResult(r.result) : r.error, isError: !r.ok };
  } else {
    next = { ...a, status: 'declined', outcome: 'נדחה', resultForModel: 'The editor declined this action. Do not do it.', isError: false };
  }
  await s.db.update(agentMessages).set({ data: next }).where(eq(agentMessages.id, row.id));

  const history = conv.history as History;
  const last = history[history.length - 1];
  const ids = Array.isArray(last?.content) ? last.content.filter((b) => b.type === 'tool_use').map((b) => (b as Anthropic.Beta.BetaToolUseBlockParam).id) : [];
  const rows = await actionRows(s, conversationId, ids);
  if (rows.some((r) => (r.data as ActionRow).status === 'pending' || (r.data as ActionRow).status === 'approved')) return;

  await s.db
    .update(agentConversations)
    .set({ history: [...history, { role: 'user', content: await toolResults(s, conversationId, ids) }], status: 'working' })
    .where(and(eq(agentConversations.id, conversationId), eq(agentConversations.status, 'awaiting_approval')));
  await enqueue(s.db, AGENT_TURN_JOB, { conversationId }, { createdBy: staff.id, maxAttempts: 1 });
}

export async function markTurnFailed(s: Services, job: JobRow, error: Error) {
  const conversationId = String(job.payload.conversationId);
  await s.db.update(agentConversations).set({ status: 'failed', lastError: error.message.slice(0, 500) }).where(eq(agentConversations.id, conversationId));
  await say(s, conversationId, 'notice', `משהו השתבש: ${error.message.slice(0, 300)}`);
}

/** After a failure the person can write again; the failed turn is closed in the history first. */
export async function resetFailed(s: Services, staff: AgentStaff, conversationId: string) {
  const conv = await loadConversation(s, staff, conversationId);
  if (conv.status !== 'failed') return;
  const history = conv.history as History;
  const last = history[history.length - 1];
  // A turn that ended on tool calls needs their results before a new user message.
  const ids = last?.role === 'assistant' && Array.isArray(last.content) ? last.content.filter((b) => b.type === 'tool_use').map((b) => (b as Anthropic.Beta.BetaToolUseBlockParam).id) : [];
  const closed: History = ids.length ? [...history, { role: 'user', content: ids.map((id) => ({ type: 'tool_result' as const, tool_use_id: id, content: 'The turn failed before this ran.', is_error: true })) }] : history;
  // Two user messages in a row are fine for the API (it merges them).
  await s.db.update(agentConversations).set({ history: closed, status: 'idle' }).where(eq(agentConversations.id, conversationId));
}
