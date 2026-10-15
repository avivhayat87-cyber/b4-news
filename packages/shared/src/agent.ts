// Contracts for the newsroom agent: the chat in the CMS (/admin/agent/*), the
// editor agent's settings and learning reports, the visual agent (Google), and
// the tokens the Claude app uses to connect (MCP).
import { z } from 'zod';

const id = z.string().uuid();
const iso = z.string();

// ---------------------------------------------------------------------------
// The agent team: who the agents are, their skills (editable instructions, in Hebrew, versioned
// in prompt_templates), the newsroom rules every agent follows, and what each one cost this month.
// ---------------------------------------------------------------------------
/** chief: the chat agent that runs the others; reporter: research from a link or screenshots; reviewer: the legal review before publishing. */
export const AGENT_IDS = ['chief', 'reporter', 'rewrite', 'reviewer', 'social', 'visual', 'translator', 'learning'] as const;
export type AgentId = (typeof AGENT_IDS)[number];

/** skill: an agent's instructions; template: a technical text sent to an image or video model (English on purpose); rules: the newsroom rules every writing agent follows. */
export const SKILL_KINDS = ['skill', 'template', 'rules'] as const;
export type SkillKind = (typeof SKILL_KINDS)[number];

/** The rules no skill can turn off: added by the code to everything the AI writes for publication. */
export const NEWSROOM_FIXED_RULES = [
  'אין ייעוץ השקעות בקול של המערכת: לעולם לא ממליצים לקנות, למכור או להחזיק נייר ערך, מטבע, נכס קריפטוגרפי או מוצר פיננסי אחר, ולא קובעים מחירי יעד. המלצה או תחזית של אנליסט, בנק או חברה מדווחת כשלהם, עם ייחוס (למשל "לדברי", "לפי הערכת").',
  'מדווחים את העובדות בניסוח חדש. לא מעתיקים משפטים מהדיווח המקורי; ציטוט קצר מותר רק במירכאות ועם ייחוס לדובר.',
  'לא מציינים שם ולא מזהים קטינים או נפגעי עבירות, ולא מוסיפים פרטים אישיים על אנשים פרטיים מעבר למה שהסיפור צריך.',
] as const;

export const SkillSummary = z.object({
  key: z.string(),
  kind: z.enum(SKILL_KINDS),
  version: z.number().int(),
  versions: z.number().int(),
  updatedAt: iso,
  /** Who wrote the active version; null = the system's default. */
  updatedBy: z.string().nullable(),
});
export type SkillSummary = z.infer<typeof SkillSummary>;

export const AgentUsageDto = z.object({
  calls: z.number().int(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  /** Estimated, in US dollars, for the calls whose price is known. */
  costUsd: z.number(),
  /** Some calls (Google's images) are billed elsewhere and not counted in costUsd. */
  partial: z.boolean(),
});
export type AgentUsageDto = z.infer<typeof AgentUsageDto>;

export const AgentCardDto = z.object({
  id: z.enum(AGENT_IDS),
  provider: z.string(),
  model: z.string(),
  /** false: the development stand-in (or no key) answers instead of the AI. */
  live: z.boolean(),
  skills: z.array(SkillSummary),
  usage: AgentUsageDto,
});
export type AgentCardDto = z.infer<typeof AgentCardDto>;

export const AgentTeamDto = z.object({
  agents: z.array(AgentCardDto),
  /** The newsroom rules every writing agent reads (editable), and the fixed ones (not editable). */
  rules: SkillSummary,
  fixedRules: z.array(z.string()),
  /** The month the usage covers, as YYYY-MM (Israel time). */
  month: z.string(),
});
export type AgentTeamDto = z.infer<typeof AgentTeamDto>;

export const SkillVersionDto = z.object({ version: z.number().int(), body: z.string(), isActive: z.boolean(), createdAt: iso, createdBy: z.string().nullable() });
export type SkillVersionDto = z.infer<typeof SkillVersionDto>;

export const SkillDto = z.object({
  key: z.string(),
  kind: z.enum(SKILL_KINDS),
  /** Markers the code fills in ({{style_rules}}…): a new version must keep them. */
  placeholders: z.array(z.string()),
  /** Newest first. */
  versions: z.array(SkillVersionDto),
});
export type SkillDto = z.infer<typeof SkillDto>;

export const SaveSkillInput = z.object({ body: z.string().trim().min(20, 'הסקיל קצר מדי').max(20_000) });
export type SaveSkillInput = z.infer<typeof SaveSkillInput>;

// ---------------------------------------------------------------------------
// The editor agent (the AI that writes the new article from the source)
// ---------------------------------------------------------------------------
/** How far the new article moves from the source's wording, angle and structure. Facts never move. */
export const DIVERGENCE = ['light', 'medium', 'strong'] as const;
export type Divergence = (typeof DIVERGENCE)[number];
export const ARTICLE_LENGTHS = ['shorter', 'same', 'longer'] as const;

export const EditorAgentSettings = z.object({
  divergence: z.enum(DIVERGENCE).default('medium'),
  length: z.enum(ARTICLE_LENGTHS).default('same'),
  /** The voice, in the newsroom's words ("עניני, ישיר, פונה לקורא בגוף שני"). */
  tone: z.string().trim().max(300).default(''),
  /** Standing editorial instructions. */
  instructions: z.string().trim().max(3000).default(''),
});
export type EditorAgentSettings = z.infer<typeof EditorAgentSettings>;

export const LearningReportDto = z.object({
  id,
  publishJobId: id.nullable(),
  articleCount: z.number().int(),
  status: z.enum(['succeeded', 'skipped', 'failed']),
  summary: z.string(),
  profileId: z.number().int().nullable(),
  inputTokens: z.number().int().nullable(),
  createdAt: iso,
});
export type LearningReportDto = z.infer<typeof LearningReportDto>;

// ---------------------------------------------------------------------------
// The visual agent (Google Gemini): writes the prompts for article images and reels,
// and learns from what the editors did with them
// ---------------------------------------------------------------------------
export const VisualAgentSettings = z.object({
  /** How article images should look, in the newsroom's words ("צילום עיתונאי ריאליסטי, אור טבעי"). */
  articleStyle: z.string().trim().max(500).default(''),
  /** How reels should look and move (pace, mood, camera). */
  reelStyle: z.string().trim().max(500).default(''),
  /** Standing instructions for every prompt. */
  instructions: z.string().trim().max(3000).default(''),
  /** What never to show or do. */
  avoid: z.string().trim().max(1000).default(''),
  /** Learn by itself every few cases (otherwise only on "learn now"). */
  autoLearn: z.boolean().default(true),
});
export type VisualAgentSettings = z.infer<typeof VisualAgentSettings>;

export const VISUAL_FEEDBACK_KINDS = ['article_image', 'reel'] as const;
export const PROMPT_AUTHORS = ['agent', 'editor'] as const;
export type PromptAuthor = (typeof PROMPT_AUTHORS)[number];

/** One case the visual agent learns from: what it suggested and what the editor did with it. */
export const VisualFeedbackDetail = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('article_image'),
    title: z.string(),
    section: z.string(),
    /** Each "create 3 drafts", in order: who wrote the description, and whether the main image came from it. */
    rounds: z.array(z.object({ by: z.enum(PROMPT_AUTHORS).nullable(), prompt: z.string(), useSource: z.boolean(), chosen: z.boolean() })),
    /** Where the published main image came from. */
    outcome: z.enum(['ai', 'upload', 'source', 'none']),
  }),
  z.object({
    kind: z.literal('reel'),
    title: z.string(),
    section: z.string(),
    /** The agent's last suggestion, and the prompts the editor approved. */
    suggested: z.object({ imagePrompt: z.string(), videoPrompt: z.string() }).nullable(),
    approved: z.object({ imagePrompt: z.string(), videoPrompt: z.string() }),
    /** Directions the editor gave when asking for new prompts. */
    directions: z.array(z.string()),
    pictures: z.number().int(),
    videos: z.number().int(),
  }),
]);
export type VisualFeedbackDetail = z.infer<typeof VisualFeedbackDetail>;

export const VisualProfileDto = z.object({
  id: z.number().int(),
  rules: z.string(),
  /** What this learning pass learned, in Hebrew (null for an editor's own edit). */
  summary: z.string().nullable(),
  feedbackCount: z.number().int(),
  isActive: z.boolean(),
  approvedBy: z.string().nullable(),
  createdAt: iso,
});
export type VisualProfileDto = z.infer<typeof VisualProfileDto>;

export const VisualAgentOverview = z.object({
  /** live: Gemini answers; otherwise the development stand-in does. */
  live: z.boolean(),
  model: z.string(),
  pending: z.number().int(),
  learned: z.number().int(),
  /** Cases needed before it learns by itself. */
  learnEvery: z.number().int(),
  recent: z.array(z.object({ id, kind: z.enum(VISUAL_FEEDBACK_KINDS), title: z.string(), status: z.enum(['pending', 'distilled', 'excluded']), createdAt: iso })),
  profiles: z.array(VisualProfileDto),
  learning: z.boolean(),
  /** Why the last learning pass failed, in Hebrew (null when it didn't). */
  lastError: z.string().nullable(),
});
export type VisualAgentOverview = z.infer<typeof VisualAgentOverview>;

export const SaveVisualRulesInput = z.object({ rules: z.string().trim().min(1).max(6000) });

// ---------------------------------------------------------------------------
// The social editor: the distribution plan of every article before it is published
// ---------------------------------------------------------------------------
export const SocialAgentSettings = z.object({
  /** Write a distribution plan for every article when its text is marked final. */
  autoPlan: z.boolean().default(true),
  /** Publishing an article sends its plan out to the networks (a reel only after a person approves it). */
  autoPost: z.boolean().default(true),
  /** Standing instructions, in the newsroom's words. */
  instructions: z.string().trim().max(3000).default(''),
  /** When a reel is worth its price, in the newsroom's words. */
  reelGuidance: z.string().trim().max(1000).default(''),
});
export type SocialAgentSettings = z.infer<typeof SocialAgentSettings>;

/** The legal reviewer: whether every article is checked when its text is final, and who is told. */
export const ReviewerSettings = z.object({
  /** Check every article when its text is marked final. */
  enabled: z.boolean().default(true),
  /** Email every admin when an article is stopped. */
  emailAdmins: z.boolean().default(true),
});
export type ReviewerSettings = z.infer<typeof ReviewerSettings>;

/** A frame, the formats that go out, and a reel (recommended by the AI, or approved by a person). */
const SocialChoice = z.object({ template: z.string(), formats: z.array(z.string()), reel: z.boolean() });

/** A plan an editor changed: what the social editor chose and what the editor chose instead. */
export const SocialCorrectionDto = z.object({ draftId: id, title: z.string(), agent: SocialChoice, editor: SocialChoice, at: iso });
export type SocialCorrectionDto = z.infer<typeof SocialCorrectionDto>;

export const SocialAgentOverview = z.object({
  settings: SocialAgentSettings,
  /** The latest corrections; the social editor reads them with every new plan. */
  corrections: z.array(SocialCorrectionDto),
  /** Plans written in the last 30 days, and how many an editor changed. */
  planned: z.number().int(),
  changed: z.number().int(),
});
export type SocialAgentOverview = z.infer<typeof SocialAgentOverview>;

/** Factual data of a draft against its source (numbers, percentages, amounts, years). */
export const FactCheckDto = z.object({
  hasSource: z.boolean(),
  sourceCount: z.number().int(),
  missing: z.array(z.object({ value: z.string(), context: z.string() })),
  added: z.array(z.object({ value: z.string(), context: z.string() })),
});
export type FactCheckDto = z.infer<typeof FactCheckDto>;

// ---------------------------------------------------------------------------
// The chat agent
// ---------------------------------------------------------------------------
export const AGENT_STATUSES = ['idle', 'working', 'awaiting_approval', 'failed'] as const;
export const ACTION_STATUSES = ['pending', 'approved', 'declined', 'done', 'failed'] as const;

export const AgentActionData = z.object({
  toolUseId: z.string(),
  tool: z.string(),
  /** What the action does, in Hebrew, for the confirm button. */
  label: z.string(),
  input: z.unknown(),
  /** Changes something (needs the user's approval). */
  write: z.boolean(),
  status: z.enum(ACTION_STATUSES),
  /** Short outcome for the chat ("נשמרו 3 כתבות"). */
  outcome: z.string().nullable(),
});
export type AgentActionData = z.infer<typeof AgentActionData>;

export const AgentMessageDto = z.object({
  id: z.number().int(),
  kind: z.enum(['user', 'assistant', 'action', 'notice']),
  text: z.string(),
  action: AgentActionData.nullable(),
  createdAt: iso,
});
export type AgentMessageDto = z.infer<typeof AgentMessageDto>;

export const AgentConversationSummary = z.object({ id, title: z.string(), status: z.enum(AGENT_STATUSES), updatedAt: iso });
export type AgentConversationSummary = z.infer<typeof AgentConversationSummary>;

export const AgentConversationDto = AgentConversationSummary.extend({
  engine: z.string(),
  lastError: z.string().nullable(),
  messages: z.array(AgentMessageDto),
});
export type AgentConversationDto = z.infer<typeof AgentConversationDto>;

export const SendAgentMessageInput = z.object({
  conversationId: id.optional(),
  text: z.string().trim().min(1, 'כתבו הודעה').max(4000),
});

export const DecideActionInput = z.object({ toolUseId: z.string().min(1).max(200), approve: z.boolean() });

export const AgentToolInfo = z.object({ name: z.string(), label: z.string(), description: z.string(), write: z.boolean() });
export type AgentToolInfo = z.infer<typeof AgentToolInfo>;

export const AgentStatusDto = z.object({
  /** live: Claude answers; demo: no key yet, a rule-based stand-in answers. */
  live: z.boolean(),
  model: z.string(),
  tools: z.array(AgentToolInfo),
});
export type AgentStatusDto = z.infer<typeof AgentStatusDto>;

// ---------------------------------------------------------------------------
// The Claude app (MCP): tools, personal access tokens, the app's config
// ---------------------------------------------------------------------------
export const AgentToolDef = z.object({
  name: z.string(),
  title: z.string(),
  description: z.string(),
  /** JSON Schema of the tool's input */
  inputSchema: z.record(z.string(), z.unknown()),
  write: z.boolean(),
});
export type AgentToolDef = z.infer<typeof AgentToolDef>;

export const RunAgentToolInput = z.object({ input: z.unknown().optional() });
export const AgentToolResult = z.union([
  z.object({ ok: z.literal(true), outcome: z.string().nullable(), result: z.unknown() }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type AgentToolResult = z.infer<typeof AgentToolResult>;

/** What to paste into the Claude app's config (the token is added after it is created). */
export const McpConfigDto = z.object({ command: z.string(), args: z.array(z.string()), env: z.record(z.string(), z.string()) });
export type McpConfigDto = z.infer<typeof McpConfigDto>;

export const ApiTokenDto = z.object({ id, name: z.string(), createdAt: iso, lastUsedAt: iso.nullable(), revokedAt: iso.nullable() });
export type ApiTokenDto = z.infer<typeof ApiTokenDto>;
export const CreateApiTokenInput = z.object({ name: z.string().trim().min(2).max(60) });
/** The token is shown once; only its hash is kept. */
export const CreatedApiToken = z.object({ token: ApiTokenDto, secret: z.string() });
