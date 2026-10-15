// Contracts for the research reporter (/admin/research/*): an article researched from a link, from
// screenshots or from the newsroom's own idea, on official sources only. Every detail of the
// article is in the research file with its label and its sources; the sources are kept as proof
// (a copy of the text and a screenshot of the page). And the editorial meeting (/admin/meetings/*):
// story pitches from what discovery found, researched only once a person approves them.
import { z } from 'zod';
import { DRAFT_COLORS } from './cms';

const id = z.string().uuid();
const iso = z.string();

/** How far it searches: quick (the default), regular, deep (the strongest model). */
export const RESEARCH_DEPTHS = ['quick', 'regular', 'deep'] as const;
export type ResearchDepth = (typeof RESEARCH_DEPTHS)[number];

/** Searches allowed per depth (each costs a cent). */
export const RESEARCH_SEARCHES: Record<ResearchDepth, number> = { quick: 3, regular: 8, deep: 15 };

/** link and screenshot: a report to check; idea: the newsroom's own question or topic (or an approved pitch). */
export const RESEARCH_KINDS = ['link', 'screenshot', 'idea'] as const;
export type ResearchKind = (typeof RESEARCH_KINDS)[number];

/**
 * verified: an official source says it; reported: only a report (a news site, unconfirmed);
 * claimed: someone said it (true that they said it, not that it is true); estimate: a forecast
 * or the reporter's own analysis; suspicion: a suspicion against someone ("לכאורה", with its
 * source); unverified: no source could be found; debunked: checked and found untrue.
 */
export const CLAIM_LABELS = ['verified', 'reported', 'claimed', 'estimate', 'suspicion', 'unverified', 'debunked'] as const;
export type ClaimLabel = (typeof CLAIM_LABELS)[number];

/** official: a ministry, a regulator, a court, a municipality, the UN…; company and person: their own channels. */
export const SOURCE_KINDS = ['official', 'company', 'person', 'social', 'news', 'wiki', 'other'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/**
 * Sites that are official wherever they appear (a domain covers its subdomains). Besides these, a
 * source may back a fact when it is the subject's own (a company's or a person's site, as the
 * reporter marks it) or on the newsroom's approved list.
 */
export const OFFICIAL_DOMAINS = [
  'gov.il',
  'muni.il',
  'boi.org.il',
  'tase.co.il',
  'idf.il',
  'un.org',
  'oecd.org',
  'imf.org',
  'worldbank.org',
  'bis.org',
  'europa.eu',
  'who.int',
  'wto.org',
  'federalreserve.gov',
  'gov.uk',
  'gov',
  'int',
] as const;

/** News sites: a lead to the primary source, never the source of a fact. */
export const NEWS_DOMAINS = [
  'ynet.co.il',
  'ynetnews.com',
  'mako.co.il',
  'n12.co.il',
  'maariv.co.il',
  'walla.co.il',
  'globes.co.il',
  'calcalist.co.il',
  'themarker.com',
  'haaretz.co.il',
  'haaretz.com',
  'israelhayom.co.il',
  'kan.org.il',
  '13tv.co.il',
  'reshet.tv',
  'now14.co.il',
  'c14.co.il',
  'i24news.tv',
  'bizportal.co.il',
  'ice.co.il',
  'funder.co.il',
  'srugim.co.il',
  'inn.co.il',
  'kikar.co.il',
  'bhol.co.il',
  'davar1.co.il',
  'zman.co.il',
  '0404.co.il',
  'glz.co.il',
  '103fm.co.il',
  'timesofisrael.com',
  'jpost.com',
  'reuters.com',
  'bloomberg.com',
  'ft.com',
  'wsj.com',
  'nytimes.com',
  'washingtonpost.com',
  'cnn.com',
  'cnbc.com',
  'bbc.com',
  'bbc.co.uk',
  'apnews.com',
  'theguardian.com',
  'economist.com',
  'forbes.com',
  'businessinsider.com',
  'axios.com',
  'politico.com',
  'foxnews.com',
  'aljazeera.com',
] as const;

/** Social networks: a post backs a fact only from an account on the approved list. */
export const SOCIAL_DOMAINS = ['x.com', 'twitter.com', 't.me', 'telegram.me', 'facebook.com', 'instagram.com', 'tiktok.com', 'youtube.com', 'linkedin.com', 'threads.net', 'whatsapp.com'] as const;

export const ResearchSourceDto = z.object({
  id: z.string(),
  url: z.string(),
  title: z.string(),
  /** Who published it, in Hebrew ("משרד החינוך"): the name in the article's sources line. */
  publisher: z.string(),
  kind: z.enum(SOURCE_KINDS),
  /** May back a fact: official, the subject's own channel, or on the newsroom's approved list. News sites never are. */
  approved: z.boolean(),
  /** The proof kept in the CMS: when, a copy of the text (GET …/sources/:sourceId/text), a screenshot of the page; skipped: past the 12 kept per research. */
  archive: z.object({
    status: z.enum(['pending', 'saved', 'failed', 'skipped']),
    capturedAt: iso.nullable(),
    hasText: z.boolean(),
    screenshotUrl: z.string().nullable(),
    error: z.string().nullable(),
  }),
});
export type ResearchSourceDto = z.infer<typeof ResearchSourceDto>;

export const ResearchClaimDto = z.object({ id: z.string(), text: z.string(), label: z.enum(CLAIM_LABELS), sourceIds: z.array(z.string()), note: z.string() });
export type ResearchClaimDto = z.infer<typeof ResearchClaimDto>;

export const ResearchDossierDto = z.object({
  /** What the link or the screenshot says: who published it, when, what. */
  original: z.object({ who: z.string(), when: z.string(), what: z.string(), url: z.string().nullable() }),
  summary: z.string(),
  claims: z.array(ResearchClaimDto),
  /** The reporter's own background and explanation (written as background, never as news). */
  background: z.array(z.string()),
  openQuestions: z.array(z.string()),
  /** Who should be asked for a response before publishing. */
  responseNeeded: z.array(z.string()),
  sources: z.array(ResearchSourceDto),
  /** The line at the end of the article: names only, no links. */
  creditLine: z.string(),
});
export type ResearchDossierDto = z.infer<typeof ResearchDossierDto>;

export const RESEARCH_STATUSES = ['queued', 'researching', 'writing', 'done', 'failed'] as const;
export type ResearchStatus = (typeof RESEARCH_STATUSES)[number];

/** An article already on the site or in editing that looks like the same story. */
export const SimilarStoryDto = z.object({ kind: z.enum(['article', 'draft']), id: z.string(), title: z.string(), at: iso, href: z.string() });
export type SimilarStoryDto = z.infer<typeof SimilarStoryDto>;

export const ResearchTaskDto = z.object({
  id,
  kind: z.enum(RESEARCH_KINDS),
  depth: z.enum(RESEARCH_DEPTHS),
  url: z.string().nullable(),
  screenshots: z.array(z.string()),
  note: z.string(),
  status: z.enum(RESEARCH_STATUSES),
  title: z.string(),
  dossier: ResearchDossierDto.nullable(),
  /** Some detail rests on an official source (false: the article rests on reports alone). */
  official: z.boolean(),
  /** Looks like a story we already have (found after the research, for screenshots). */
  similar: z.array(SimilarStoryDto),
  /** An update of an article we already have (draftId is then that article's draft). */
  target: z.object({ draftId: id, title: z.string() }).nullable(),
  /** The update it proposes: put in by an editor ("applied"), set aside ("dismissed"), or nothing new found ("empty"). */
  update: z.object({ paragraphs: z.array(z.string()), reason: z.string(), state: z.enum(['ready', 'applied', 'dismissed', 'empty']) }).nullable(),
  draftId: id.nullable(),
  searches: z.number().int(),
  costUsd: z.number(),
  error: z.string().nullable(),
  createdBy: z.string(),
  createdAt: iso,
});
export type ResearchTaskDto = z.infer<typeof ResearchTaskDto>;

export const ResearchOverviewDto = z.object({
  tasks: z.array(ResearchTaskDto),
  /** This month, in US dollars (estimated at list prices), and the newsroom's budget. */
  spentUsd: z.number(),
  budgetUsd: z.number(),
  defaultDepth: z.enum(RESEARCH_DEPTHS),
});
export type ResearchOverviewDto = z.infer<typeof ResearchOverviewDto>;

export const StartResearchInput = z
  .object({
    kind: z.enum(RESEARCH_KINDS),
    url: z.string().trim().url('הקישור לא תקין').max(2000).optional(),
    /** Uploaded screenshots (media ids), up to four. */
    mediaIds: z.array(id).max(4).default([]),
    /** What to check in particular ("תבדוק במיוחד את המספר"); for an idea, the idea itself. */
    note: z.string().trim().max(3000).default(''),
    depth: z.enum(RESEARCH_DEPTHS).default('quick'),
    magazineId: id.optional(),
    colorLabel: z.enum(DRAFT_COLORS).optional(),
    /** Update an article we already have instead of writing a new one: its draft, or the published article. */
    targetDraftId: id.optional(),
    targetArticleId: z.number().int().positive().optional(),
  })
  .refine((v) => (v.kind === 'link' ? Boolean(v.url) : v.kind === 'screenshot' ? v.mediaIds.length > 0 : v.note.length >= 10), 'צריך קישור, צילום מסך אחד לפחות, או רעיון של משפט אחד לפחות');
export type StartResearchInput = z.infer<typeof StartResearchInput>;

/** A link (the same link), or the words of an idea (similar headlines). */
export const SimilarStoriesInput = z.union([z.object({ url: z.string().trim().url().max(2000) }), z.object({ text: z.string().trim().min(3).max(3000) })]);

/** The copy of a source's text kept as proof. */
export const SourceCopyDto = z.object({ url: z.string(), capturedAt: iso.nullable(), text: z.string() });
export type SourceCopyDto = z.infer<typeof SourceCopyDto>;

// ---------------------------------------------------------------------------
// The editorial meeting
// ---------------------------------------------------------------------------

/** How far back the meeting reads what discovery found. */
export const MEETING_HOURS = 36;

export const MEETING_STATUSES = ['queued', 'thinking', 'ready', 'failed'] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

export const PITCH_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type PitchStatus = (typeof PITCH_STATUSES)[number];

/** An article discovery found that a pitch grew from: a lead, never a source. */
export const PitchLeadDto = z.object({ itemId: id, title: z.string(), url: z.string(), source: z.string() });
export type PitchLeadDto = z.infer<typeof PitchLeadDto>;

/** A story the meeting proposes: a question to research, not a fact. */
export const PitchDto = z.object({
  id: z.string(),
  title: z.string(),
  /** What makes it ours and not a rewrite: the angle, what it adds for the reader. */
  angle: z.string(),
  whyNow: z.string(),
  /** What to check, and in which official sources. */
  checks: z.array(z.string()),
  officialSources: z.array(z.string()),
  category: z.string().nullable(),
  depth: z.enum(RESEARCH_DEPTHS),
  /** How many sites covered its topic in the hours read (the heat of the story). */
  coverage: z.number().int(),
  leads: z.array(PitchLeadDto),
  /** Articles and drafts we already have that look like it (free headline overlap). */
  similar: z.array(SimilarStoryDto),
  status: z.enum(PITCH_STATUSES),
  decidedBy: z.string().nullable(),
  /** The research an approved pitch became, as it stands. */
  research: z.object({ id, status: z.enum(RESEARCH_STATUSES), draftId: id.nullable(), official: z.boolean() }).nullable(),
});
export type PitchDto = z.infer<typeof PitchDto>;

export const MeetingDto = z.object({
  id,
  focus: z.string(),
  status: z.enum(MEETING_STATUSES),
  /** What is happening, in a few sentences. */
  summary: z.string(),
  /** What the meeting read: discovered articles in the last MEETING_HOURS, and the topics they made. */
  itemsRead: z.number().int(),
  topics: z.number().int(),
  pitches: z.array(PitchDto),
  costUsd: z.number(),
  error: z.string().nullable(),
  /** The morning meeting held by itself (createdBy is then empty). */
  auto: z.boolean(),
  createdBy: z.string(),
  createdAt: iso,
});
export type MeetingDto = z.infer<typeof MeetingDto>;

/** The morning meeting: held by itself every day at this hour (Israel), and the admins get its pitches by email. */
export const MeetingSettings = z.object({
  morning: z.boolean().default(true),
  hour: z.number().int().min(5).max(12).default(8),
  /** A standing direction for the morning meeting (empty: whatever is hot). */
  focus: z.string().trim().max(300).default(''),
  /** No meeting on Saturdays. */
  skipSaturday: z.boolean().default(true),
});
export type MeetingSettings = z.infer<typeof MeetingSettings>;

/** focus: an optional direction ("נדל"ן ומשכנתאות", "מה מעניין צרכנים השבוע"). */
export const StartMeetingInput = z.object({ focus: z.string().trim().max(300).default('') });
export type StartMeetingInput = z.infer<typeof StartMeetingInput>;

/** Approving starts the research of the pitch (as edited), at the chosen depth. */
export const ApprovePitchInput = z.object({
  title: z.string().trim().min(3).max(300).optional(),
  angle: z.string().trim().max(2000).optional(),
  depth: z.enum(RESEARCH_DEPTHS).optional(),
  magazineId: id.optional(),
  colorLabel: z.enum(DRAFT_COLORS).optional(),
});
export type ApprovePitchInput = z.infer<typeof ApprovePitchInput>;

// ---------------------------------------------------------------------------
// The official-sources registry
// ---------------------------------------------------------------------------

export const OFFICIAL_PLATFORMS = ['x', 'telegram', 'facebook', 'instagram', 'youtube', 'linkedin', 'tiktok', 'threads'] as const;
export type OfficialPlatform = (typeof OFFICIAL_PLATFORMS)[number];

export const ORG_KINDS = ['government', 'regulator', 'central_bank', 'statistics', 'parliament', 'court', 'municipality', 'exchange', 'international', 'company', 'other'] as const;
export type OrgKind = (typeof ORG_KINDS)[number];

/** verified: its official site links to it (or an admin added it); pending: found elsewhere, waits for an admin; missing: no longer linked. */
export const ACCOUNT_STATUSES = ['verified', 'pending', 'missing'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const OfficialAccountDto = z.object({
  platform: z.enum(OFFICIAL_PLATFORMS),
  /** "x.com/israel_mof": what a post's address is matched against. */
  key: z.string(),
  url: z.string(),
  status: z.enum(ACCOUNT_STATUSES),
  foundBy: z.enum(['site', 'search', 'admin']),
  /** The official page that links to it. */
  evidence: z.string().nullable(),
  checkedAt: iso.nullable(),
});
export type OfficialAccountDto = z.infer<typeof OfficialAccountDto>;

/** A body whose site and verified accounts count as official sources, under its name in the sources line. */
export const OfficialSourceDto = z.object({
  id,
  name: z.string(),
  kind: z.enum(ORG_KINDS),
  homepage: z.string(),
  /** Hosts, or a host and a path ("gov.il/he/departments/ministry_of_finance"), that are this body's own. */
  domains: z.array(z.string()),
  accounts: z.array(OfficialAccountDto),
  active: z.boolean(),
  addedBy: z.enum(['seed', 'admin', 'research']),
  lastCheckedAt: iso.nullable(),
  lastError: z.string().nullable(),
});
export type OfficialSourceDto = z.infer<typeof OfficialSourceDto>;

export const RegistryOverviewDto = z.object({
  sources: z.array(OfficialSourceDto),
  lastRun: z.object({ at: iso, checked: z.number().int(), added: z.number().int(), pending: z.number().int(), errors: z.number().int(), costUsd: z.number() }).nullable(),
  running: z.boolean(),
});
export type RegistryOverviewDto = z.infer<typeof RegistryOverviewDto>;

export const OfficialSourceInput = z.object({
  name: z.string().trim().min(2).max(120),
  kind: z.enum(ORG_KINDS).default('other'),
  homepage: z.string().trim().url('הכתובת לא תקינה').max(500),
  domains: z.array(z.string().trim().min(3).max(200)).max(10).default([]),
  active: z.boolean().default(true),
});
export type OfficialSourceInput = z.infer<typeof OfficialSourceInput>;

export const OfficialAccountInput = z.object({ url: z.string().trim().url('הכתובת לא תקינה').max(500) });

/** The research reporter's settings (only an admin changes them). */
export const ResearcherSettings = z.object({
  /** A month's research stops at this, in US dollars. */
  monthlyBudgetUsd: z.number().min(0).max(5000).default(60),
  defaultDepth: z.enum(RESEARCH_DEPTHS).default('quick'),
  /** Sources that may back a fact besides official ones: a domain, or an account address, one per line. */
  approvedSources: z.string().max(5000).default(''),
  /** Keep a screenshot of every source page as proof. */
  screenshots: z.boolean().default(true),
});
export type ResearcherSettings = z.infer<typeof ResearcherSettings>;
