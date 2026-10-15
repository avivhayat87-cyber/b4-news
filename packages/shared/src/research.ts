// Contracts for the research reporter (/admin/research/*): an article researched from a link or
// from screenshots, on official sources only. Every detail of the article is in the research file
// with its label and its sources; the sources are kept as proof (a copy of the text and a
// screenshot of the page).
import { z } from 'zod';
import { DRAFT_COLORS } from './cms';

const id = z.string().uuid();
const iso = z.string();

/** How far it searches: quick (the default), regular, deep (the strongest model). */
export const RESEARCH_DEPTHS = ['quick', 'regular', 'deep'] as const;
export type ResearchDepth = (typeof RESEARCH_DEPTHS)[number];

/** Searches allowed per depth (each costs a cent). */
export const RESEARCH_SEARCHES: Record<ResearchDepth, number> = { quick: 3, regular: 8, deep: 15 };

export const RESEARCH_KINDS = ['link', 'screenshot'] as const;
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
    /** What to check in particular ("תבדוק במיוחד את המספר"). */
    note: z.string().trim().max(1000).default(''),
    depth: z.enum(RESEARCH_DEPTHS).default('quick'),
    magazineId: id.optional(),
    colorLabel: z.enum(DRAFT_COLORS).optional(),
  })
  .refine((v) => (v.kind === 'link' ? Boolean(v.url) : v.mediaIds.length > 0), 'צריך קישור, או לפחות צילום מסך אחד');
export type StartResearchInput = z.infer<typeof StartResearchInput>;

export const SimilarStoriesInput = z.object({ url: z.string().trim().url().max(2000) });

/** The copy of a source's text kept as proof. */
export const SourceCopyDto = z.object({ url: z.string(), capturedAt: iso.nullable(), text: z.string() });
export type SourceCopyDto = z.infer<typeof SourceCopyDto>;

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
