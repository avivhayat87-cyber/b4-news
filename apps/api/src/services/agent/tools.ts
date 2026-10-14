// What the newsroom agent can do in the CMS. One list serves the chat in the CMS
// and the Claude app (MCP). Read tools run at once; tools that change something
// ("write") run only after the person approves them (in the chat, a confirm
// button; in the Claude app, its own approval prompt). Every tool checks the
// person's role, exactly like the CMS screens.
import { randomUUID } from 'node:crypto';
import { DIVERGENCE, EditorAgentSettings, SHARE_FORMATS, SHARE_TEMPLATES, SOURCE_REGIONS, type SocialPlanDto, type StaffRole } from '@b4/shared';
import {
  and,
  articleDrafts,
  articles,
  categories,
  count,
  desc,
  eq,
  ilike,
  scrapedItems,
  scrapeRunItems,
  scrapeRuns,
  socialAccounts,
  sources,
  sql,
  styleProfiles,
} from '@b4/db';
import { z } from 'zod';
import { AppError } from '../../errors';
import type { Services } from '../context';
import { createDraftsFromItems, draftDetail, finalizeText, listSaved, requestRefine, similarityToOriginal } from '../drafts';
import { learningReportsList, queueDistill } from '../learning';
import { startPublish } from '../publish';
import { startRun } from '../scraper/run';
import { addSources, approveTestedSources } from '../scraper/setup';
import { reviewQueue } from '../legal-review';
import { getPlan, planReport, updatePlan } from '../social-plan';
import { listShares, requestKits, startSharePublish } from '../social-share';
import { draftFacts, getEditorSettings, saveEditorSettings } from './editor';

export type AgentStaff = { id: string; fullName: string; role: StaffRole };

export type AgentTool = {
  name: string;
  /** Hebrew, for the confirm button and the chat ("התחלת איתור מחו״ל") */
  label: (input: any) => string;
  description: string;
  /** JSON Schema for the model; the zod schema below validates what actually runs. */
  schema: Record<string, unknown>;
  input: z.ZodTypeAny;
  write: boolean;
  /** Roles allowed besides admin; empty = every signed-in staff member. */
  roles: StaffRole[];
  run: (s: Services, staff: AgentStaff, input: any) => Promise<unknown>;
  /** One line for the chat after a write ran. */
  outcome?: (result: any) => string;
};

const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const uuidList = { type: 'array', items: { type: 'string', format: 'uuid' }, maxItems: 60 };
const region = { type: 'string', enum: [...SOURCE_REGIONS], description: 'local = Israeli sites, international = sites from abroad' };
const clip = (t: string | null | undefined, n: number) => (!t ? '' : t.length > n ? `${t.slice(0, n)}…` : t);
/** Times for the agent are in Israel time, as the newsroom reads them. */
const israelTime = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const il = (d: Date | string | null | undefined) => (d ? israelTime.format(new Date(d)) : null);
const regionName = (r: string) => (r === 'international' ? 'מחו״ל' : 'מישראל');
/** A distribution plan as the agent reads it. */
const planView = (p: SocialPlanDto) => ({
  draftId: p.draftId,
  title: p.title,
  state: p.state,
  frame: p.template,
  goesOut: p.formats,
  reel: p.reel ? { recommended: p.reel.recommended, approved: p.formats.includes('reel'), idea: p.reel.idea, why: p.reel.reason, estimateUsd: p.reelEstimateUsd } : null,
  why: p.reasons,
  headline: p.headline,
  cmsLink: `/drafts/${p.draftId}`,
});

export const TOOLS: AgentTool[] = [
  // --- Reading ---------------------------------------------------------------------
  {
    name: 'newsroom_overview',
    label: () => 'סקירת מצב המערכת',
    description: 'Counts of everything waiting in the newsroom: drafts by status, sites by status and region, the latest discovery run per region, articles published today, articles not yet shared on social networks.',
    schema: object({}),
    input: z.object({}),
    write: false,
    roles: [],
    run: async (s) => {
      const drafts = await s.db.select({ status: articleDrafts.status, n: count() }).from(articleDrafts).groupBy(articleDrafts.status);
      const srcs = await s.db.select({ region: sources.region, status: sources.status, n: count() }).from(sources).groupBy(sources.region, sources.status);
      const runs = [];
      for (const r of SOURCE_REGIONS) {
        const [run] = await s.db.select().from(scrapeRuns).where(eq(scrapeRuns.region, r)).orderBy(desc(scrapeRuns.createdAt)).limit(1);
        runs.push(run ? { region: r, status: run.status, at: il(run.createdAt), newItems: run.itemsNew } : { region: r, status: 'never' });
      }
      const [today] = await s.db.select({ n: count() }).from(articles).where(sql`${articles.publishedAt} >= date_trunc('day', now())`);
      const social = await listShares(s, { filter: 'pending', page: 1 });
      return {
        drafts: Object.fromEntries(drafts.map((d) => [d.status, d.n])),
        sources: srcs.map((x) => ({ region: x.region, status: x.status, count: x.n })),
        latestRuns: runs,
        publishedToday: today?.n ?? 0,
        articlesNotYetOnSocial: social.pendingCount,
      };
    },
  },
  {
    name: 'list_sources',
    label: () => 'רשימת האתרים',
    description: 'The news sites the system scans, with their status (active, waiting for approval, broken...), region, method and last successful scan.',
    schema: object({ region, status: { type: 'string', description: 'Optional status filter, e.g. active, in_development, pending_dev, broken' } }),
    input: z.object({ region: z.enum(SOURCE_REGIONS).optional(), status: z.string().max(30).optional() }),
    write: false,
    roles: [],
    run: async (s, _staff, input) => {
      const rows = await s.db.select().from(sources).orderBy(sources.region, sources.name);
      return rows
        .filter((r) => (!input.region || r.region === input.region) && (!input.status || r.status === input.status))
        .map((r) => ({
          id: r.id,
          name: r.name,
          url: r.baseUrl,
          region: r.region,
          status: r.status,
          readyForApproval: r.status === 'in_development' && Boolean(r.lastTestPassedAt),
          method: r.method,
          lastSuccessAt: il(r.lastSuccessAt),
          notes: clip(r.devNotes, 160),
        }));
    },
  },
  {
    name: 'latest_discovery',
    label: (i) => `תוצאות האיתור האחרון ${regionName(i.region ?? 'local')}`,
    description: 'The articles found by the latest discovery run of a region (Israeli or international), newest first. Foreign articles include the Hebrew headline. Use the item ids to save articles for editing.',
    schema: object({ region, query: { type: 'string', description: 'Optional text to filter headlines' }, limit: { type: 'integer', minimum: 1, maximum: 80 } }),
    input: z.object({ region: z.enum(SOURCE_REGIONS).default('local'), query: z.string().max(100).optional(), limit: z.number().int().min(1).max(80).default(40) }),
    write: false,
    roles: [],
    run: async (s, _staff, input) => {
      const [run] = await s.db.select().from(scrapeRuns).where(eq(scrapeRuns.region, input.region)).orderBy(desc(scrapeRuns.createdAt)).limit(1);
      if (!run) return { run: null, items: [] };
      const items = await s.db
        .select({ id: scrapedItems.id, title: scrapedItems.title, titleHe: scrapedItems.titleHe, status: scrapedItems.status, publishedAt: scrapedItems.publishedAt, source: sources.name, section: categories.name })
        .from(scrapeRunItems)
        .innerJoin(scrapedItems, eq(scrapeRunItems.itemId, scrapedItems.id))
        .leftJoin(sources, eq(scrapedItems.sourceId, sources.id))
        .leftJoin(categories, eq(scrapedItems.categoryId, categories.id))
        .where(eq(scrapeRunItems.runId, run.id))
        .orderBy(desc(scrapedItems.publishedAt));
      const q = input.query?.toLowerCase();
      return {
        run: { status: run.status, startedAt: il(run.createdAt), newItems: run.itemsNew },
        items: items
          .filter((i) => !q || `${i.title} ${i.titleHe ?? ''}`.toLowerCase().includes(q))
          .slice(0, input.limit)
          .map((i) => ({ id: i.id, title: i.titleHe ?? i.title, original: i.titleHe ? i.title : undefined, source: i.source, section: i.section, status: i.status, publishedAt: il(i.publishedAt) })),
      };
    },
  },
  {
    name: 'list_saved_edits',
    label: () => 'העריכות השמורות',
    description: 'Saved edits: magazines and single articles being edited, with their status (editing, text_final, ready, published...).',
    schema: object({}),
    input: z.object({}),
    write: false,
    roles: [],
    run: async (s) => {
      const saved = await listSaved(s);
      return {
        magazines: saved.magazines.map((m) => ({ id: m.id, title: m.title, status: m.status, counts: m.counts })),
        singles: saved.singles.slice(0, 60).map((d) => ({ id: d.id, title: d.title, status: d.status, section: d.category, source: d.sourceName, updatedAt: il(d.updatedAt) })),
      };
    },
  },
  {
    name: 'get_draft',
    label: () => 'קריאת כתבה בעריכה',
    description: "One draft in full: title, subtitle, body, status, section, what is missing before publishing, the fact check against the source (numbers missing or added) and how much wording is copied from the source.",
    schema: object({ draftId: { type: 'string', format: 'uuid' } }, ['draftId']),
    input: z.object({ draftId: z.string().uuid() }),
    write: false,
    roles: [],
    run: async (s, _staff, input) => {
      const d = await draftDetail(s, input.draftId);
      const [row] = await s.db.select({ body: articleDrafts.bodyText }).from(articleDrafts).where(eq(articleDrafts.id, input.draftId)).limit(1);
      const facts = await draftFacts(s.db, input.draftId);
      const copied = await similarityToOriginal(s, input.draftId);
      return {
        id: d.id,
        status: d.status,
        title: d.title,
        subtitle: d.subtitle,
        body: clip(row?.body, 6000),
        section: d.category,
        hasMainImage: Boolean(d.hero),
        source: d.original ? { name: d.original.sourceName, url: d.original.url, language: d.original.language } : null,
        factCheck: { missingFromArticle: facts.missing.map((f) => f.value), notInSource: facts.added.map((f) => f.value) },
        copiedWording: Math.round(copied.ratio * 100) + '%',
        cmsLink: `/drafts/${d.id}`,
      };
    },
  },
  {
    name: 'search_published',
    label: () => 'חיפוש כתבות שפורסמו',
    description: 'Articles published on the site, newest first, optionally filtered by words in the title.',
    schema: object({ query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50 } }),
    input: z.object({ query: z.string().max(100).optional(), limit: z.number().int().min(1).max(50).default(20) }),
    write: false,
    roles: [],
    run: async (s, _staff, input) => {
      const rows = await s.db
        .select({ id: articles.id, title: articles.title, slug: articles.slug, publishedAt: articles.publishedAt, section: categories.name })
        .from(articles)
        .innerJoin(categories, eq(articles.categoryId, categories.id))
        .where(and(eq(articles.status, 'published'), input.query ? ilike(articles.title, `%${input.query.replace(/[\\%_]/g, (c: string) => `\\${c}`)}%`) : undefined))
        .orderBy(desc(articles.publishedAt))
        .limit(input.limit);
      return rows.map((r) => ({ id: r.id, title: r.title, section: r.section, publishedAt: il(r.publishedAt), url: `${s.config.publicSiteUrl}/article/${r.slug}` }));
    },
  },
  {
    name: 'social_status',
    label: () => 'מצב הרשתות החברתיות',
    description: 'Published articles and whether they went out to the social networks (pending = not shared yet), with whether a post/story was prepared.',
    schema: object({ filter: { type: 'string', enum: ['pending', 'shared', 'all'] } }),
    input: z.object({ filter: z.enum(['pending', 'shared', 'all']).default('pending') }),
    write: false,
    roles: [],
    run: async (s, _staff, input) => {
      const list = await listShares(s, { filter: input.filter, page: 1 });
      const accounts = await s.db.select({ id: socialAccounts.id, platform: socialAccounts.platform, name: socialAccounts.displayName }).from(socialAccounts).where(eq(socialAccounts.isActive, true));
      return {
        pendingCount: list.pendingCount,
        accounts,
        articles: list.items.map((i) => ({ articleId: i.articleId, title: i.title, section: i.category, hasPost: i.hasKit, template: i.template, posted: i.posts.filter((p) => p.status === 'posted').map((p) => `${p.platform}/${p.format}`) })),
      };
    },
  },
  {
    name: 'social_plans',
    label: () => 'תוכנית ההפצה ברשתות',
    description:
      "The social editor's distribution plans. For each article waiting to be published: the design frame, what goes out (feed post, story), whether a reel is recommended or approved and why, and the headline on the image. Also what went out for the articles published in the last days, and whether publishing sends plans out automatically.",
    schema: object({}),
    input: z.object({}),
    write: false,
    roles: [],
    run: async (s) => {
      const r = await planReport(s);
      return {
        sentAutomaticallyOnPublish: r.autoPost,
        waiting: r.pending.map(planView),
        recentlyPublished: r.recent.map((p) => ({ ...planView(p), articleId: p.articleId, posted: p.posts.filter((x) => x.status === 'posted').map((x) => `${x.platform}/${x.format}`), reelStage: p.reelStage })),
      };
    },
  },
  {
    name: 'legal_reviews',
    label: () => 'כתבות שנעצרו בבדיקה המשפטית',
    description:
      'Articles the legal review stopped before publishing, with each risk (a suspicion against a named private person, a minor or a victim, a possible gag order, security information, an unverified report about a listed company, an accusation without a response), the passage, why, the advice, and what was decided. Only a person decides, in the CMS (/review).',
    schema: object({}),
    input: z.object({}),
    write: false,
    roles: [],
    run: async (s) =>
      (await reviewQueue(s)).map((r) => ({
        draftId: r.draftId,
        title: r.title,
        state: r.state,
        waiting: r.openCount,
        error: r.error,
        issues: r.issues.map((i) => ({ risk: i.flag, passage: i.quote, why: i.why, advice: i.advice, decided: i.decision?.action ?? null })),
        cmsLink: `/drafts/${r.draftId}`,
      })),
  },
  {
    name: 'learning_status',
    label: () => 'מה סוכן העריכה למד',
    description: "The editor agent: its current house-style rules (learned from the editors' corrections), its settings, and the latest learning reports (one per publish batch).",
    schema: object({}),
    input: z.object({}),
    write: false,
    roles: [],
    run: async (s) => {
      const [profile] = await s.db.select({ rules: styleProfiles.rules, createdAt: styleProfiles.createdAt }).from(styleProfiles).where(eq(styleProfiles.isActive, true)).orderBy(desc(styleProfiles.id)).limit(1);
      const reports = await learningReportsList(s);
      return {
        rules: profile?.rules ?? null,
        rulesSince: il(profile?.createdAt),
        settings: await getEditorSettings(s.db),
        reports: reports.slice(0, 5).map((r) => ({ at: il(r.createdAt), articles: r.articleCount, status: r.status, summary: r.summary })),
      };
    },
  },

  // --- Changing (needs approval) -----------------------------------------------------------
  {
    name: 'start_discovery',
    label: (i) => `התחלת איתור כתבות ${regionName(i.region ?? 'local')}`,
    description: 'Starts a discovery run: scans every active site of the region for what was published since the last run. The results appear a minute later (read them with latest_discovery).',
    schema: object({ region }, ['region']),
    input: z.object({ region: z.enum(SOURCE_REGIONS) }),
    write: true,
    roles: ['editor'],
    run: async (s, staff, input) => startRun(s, staff.id, 'manual', input.region),
    outcome: (r) => (r.created ? 'האיתור התחיל. התוצאות יופיעו בעוד דקה.' : 'איתור כבר רץ עכשיו.'),
  },
  {
    name: 'add_sources',
    label: (i) => `הוספת ${i.urls?.length ?? ''} אתרים ${regionName(i.region ?? 'local')}`,
    description: 'Adds news sites by their links. Each one is set up automatically (feed detection and a test) and then waits for approval.',
    schema: object({ urls: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 30 }, region }, ['urls', 'region']),
    input: z.object({ urls: z.array(z.string().url()).min(1).max(30), region: z.enum(SOURCE_REGIONS) }),
    write: true,
    roles: ['editor', 'developer'],
    run: async (s, staff, input) => addSources(s, staff, input.urls, input.region),
    outcome: (r) => `נוספו ${r.created.length} אתרים${r.skipped.length ? `, ${r.skipped.length} כבר היו ברשימה` : ''}. ההגדרה האוטומטית רצה ברקע.`,
  },
  {
    name: 'approve_tested_sources',
    label: () => 'אישור כל האתרים שעברו בדיקה',
    description: 'Approves every site whose automatic setup passed its test, so it is included in every discovery run.',
    schema: object({}),
    input: z.object({}),
    write: true,
    roles: ['developer'],
    run: async (s, staff) => ({ approved: await approveTestedSources(s, staff.id) }),
    outcome: (r) => `${r.approved} אתרים אושרו ונכללים מעכשיו בכל איתור.`,
  },
  {
    name: 'save_for_editing',
    label: (i) => (i.mode === 'single' ? `שמירת ${i.itemIds?.length ?? ''} כתבות לעריכה` : `יצירת מגזין מ-${i.itemIds?.length ?? ''} כתבות`),
    description: 'Saves discovered articles (item ids from latest_discovery) for editing, as one magazine or as single articles. The AI starts writing the new articles right away (foreign ones are translated first).',
    schema: object({ itemIds: uuidList, mode: { type: 'string', enum: ['magazine', 'single'] }, title: { type: 'string', description: 'Magazine name (optional)' } }, ['itemIds']),
    input: z.object({ itemIds: z.array(z.string().uuid()).min(1).max(60), mode: z.enum(['magazine', 'single']).default('magazine'), title: z.string().trim().min(1).max(120).optional() }),
    write: true,
    roles: ['editor'],
    run: async (s, staff, input) => createDraftsFromItems(s, staff, { ...input, colorLabel: input.mode === 'single' ? 'blue' : undefined }),
    outcome: (r) => `נשמרו ${r.draftIds.length} כתבות לעריכה${r.magazineId ? ` במגזין (/magazines/${r.magazineId})` : ''}. ה-AI מתחיל לכתוב.`,
  },
  {
    name: 'ask_ai_to_edit',
    label: () => 'בקשת תיקון מה-AI בכתבה',
    description: 'Asks the AI writer to change a draft (for example "shorten by a third", "a sharper headline"). Runs in the background; the editor sees the change in the draft.',
    schema: object({ draftId: { type: 'string', format: 'uuid' }, instruction: { type: 'string' } }, ['draftId', 'instruction']),
    input: z.object({ draftId: z.string().uuid(), instruction: z.string().trim().min(2).max(1000) }),
    write: true,
    roles: ['editor'],
    run: async (s, staff, input) => requestRefine(s, staff, input.draftId, input.instruction),
    outcome: () => 'הבקשה נשלחה ל-AI. השינוי יופיע בכתבה בעוד רגע.',
  },
  {
    name: 'mark_text_final',
    label: () => 'סימון הטקסט כסופי',
    description: 'Marks a draft\'s text as final (it must have a title, a body and a section). Opens the social module and allows publishing.',
    schema: object({ draftId: { type: 'string', format: 'uuid' } }, ['draftId']),
    input: z.object({ draftId: z.string().uuid() }),
    write: true,
    roles: ['editor'],
    run: async (s, staff, input) => finalizeText(s, staff, input.draftId),
    outcome: () => 'הטקסט סומן כסופי.',
  },
  {
    name: 'publish',
    label: (i) => (i.magazineId ? 'פרסום המגזין באתר' : 'פרסום הכתבה באתר'),
    description: 'Publishes to the site a single draft (draftId) or every ready article of a magazine (magazineId). Articles must be final, with a section and a main image. Approved social packages go out after the site.',
    schema: object({ draftId: { type: 'string', format: 'uuid' }, magazineId: { type: 'string', format: 'uuid' } }),
    input: z.object({ draftId: z.string().uuid().optional(), magazineId: z.string().uuid().optional() }).refine((v) => Boolean(v.draftId) !== Boolean(v.magazineId), 'צריך כתבה אחת או מגזין אחד'),
    write: true,
    roles: ['editor'],
    run: async (s, staff, input) => ({ publishJobId: await startPublish(s, staff, input.magazineId ? { magazineId: input.magazineId } : { draftId: input.draftId! }, `agent-${randomUUID()}`) }),
    outcome: () => 'הפרסום התחיל: קודם האתר, אחר כך הרשתות.',
  },
  {
    name: 'prepare_social_posts',
    label: (i) => `הכנת פוסט וסטורי ל-${i.articleIds?.length ?? ''} כתבות`,
    description: 'Lets the AI prepare branded posts and stories (text and designs) for published articles (article ids from social_status). Nothing is posted yet.',
    schema: object({ articleIds: { type: 'array', items: { type: 'integer' }, minItems: 1, maxItems: 20 }, instruction: { type: 'string' } }, ['articleIds']),
    input: z.object({ articleIds: z.array(z.number().int().positive()).min(1).max(20), instruction: z.string().max(1000).optional() }),
    write: true,
    roles: ['editor'],
    run: async (s, staff, input) => ({ jobs: (await requestKits(s, staff, input.articleIds, input.instruction)).length }),
    outcome: (r) => `ה-AI מכין ${r.jobs} פוסטים. אפשר לראות אותם ב"רשתות חברתיות".`,
  },
  {
    name: 'post_to_social',
    label: (i) => `פרסום ${i.articleIds?.length ?? ''} כתבות ברשתות`,
    description: 'Posts prepared posts and/or stories of published articles to the social accounts (all active accounts if none given). Accounts without a token get the post prepared for manual posting.',
    schema: object(
      {
        articleIds: { type: 'array', items: { type: 'integer' }, minItems: 1, maxItems: 20 },
        formats: { type: 'array', items: { type: 'string', enum: [...SHARE_FORMATS] } },
        accountIds: uuidList,
      },
      ['articleIds'],
    ),
    input: z.object({ articleIds: z.array(z.number().int().positive()).min(1).max(20), formats: z.array(z.enum(SHARE_FORMATS)).min(1).default(['feed', 'story']), accountIds: z.array(z.string().uuid()).optional() }),
    write: true,
    roles: ['editor'],
    run: async (s, staff, input) => {
      const accountIds = input.accountIds?.length ? input.accountIds : (await s.db.select({ id: socialAccounts.id }).from(socialAccounts).where(eq(socialAccounts.isActive, true))).map((a) => a.id);
      if (!accountIds.length) throw new AppError(422, 'no_accounts', 'אין חשבונות רשתות פעילים.');
      return { jobId: await startSharePublish(s, staff, { articleIds: input.articleIds, formats: input.formats, accountIds }) };
    },
    outcome: () => 'הפרסום ברשתות התחיל.',
  },
  {
    name: 'update_social_plan',
    label: () => 'שינוי תוכנית ההפצה של כתבה',
    description:
      "Changes an article's distribution plan before it is published (draft ids from social_plans): the design frame, what goes out (feed, story; adding reel approves the reel, which costs a video), or whether it goes out to the networks at all.",
    schema: object(
      {
        draftId: { type: 'string', format: 'uuid' },
        frame: { type: 'string', enum: [...SHARE_TEMPLATES] },
        goesOut: { type: 'array', items: { type: 'string', enum: [...SHARE_FORMATS] }, minItems: 1 },
        enabled: { type: 'boolean', description: 'false = this article does not go out to the networks automatically' },
      },
      ['draftId'],
    ),
    input: z.object({ draftId: z.string().uuid(), frame: z.enum(SHARE_TEMPLATES).optional(), goesOut: z.array(z.enum(SHARE_FORMATS)).min(1).optional(), enabled: z.boolean().optional() }),
    write: true,
    roles: ['editor'],
    run: async (s, staff, input) => {
      const current = await getPlan(s, input.draftId);
      return planView(await updatePlan(s, staff, input.draftId, { version: current.version, template: input.frame, formats: input.goesOut, enabled: input.enabled }));
    },
    outcome: () => 'תוכנית ההפצה עודכנה.',
  },
  {
    name: 'update_editor_agent',
    label: () => 'עדכון הגדרות סוכן העריכה',
    description: 'Changes the editor agent settings: divergence from the source (light, medium, strong), length (shorter, same, longer), voice, and standing instructions. Factual data is always kept, whatever the settings.',
    schema: object({
      divergence: { type: 'string', enum: [...DIVERGENCE] },
      length: { type: 'string', enum: ['shorter', 'same', 'longer'] },
      tone: { type: 'string' },
      instructions: { type: 'string' },
    }),
    input: EditorAgentSettings.partial(),
    write: true,
    roles: ['editor'],
    run: async (s, staff, input) => saveEditorSettings(s.db, staff.id, { ...(await getEditorSettings(s.db)), ...input }),
    outcome: () => 'הגדרות סוכן העריכה עודכנו. הן חלות על כל כתבה חדשה.',
  },
  {
    name: 'learn_now',
    label: () => 'הפעלת למידה עכשיו',
    description: "Makes the editor agent learn now from every published correction it hasn't learned from yet (normally it learns after each publish batch).",
    schema: object({}),
    input: z.object({}),
    write: true,
    roles: ['editor'],
    run: async (s, staff) => ({ queued: Boolean(await queueDistill(s, staff.id, true)) }),
    outcome: (r) => (r.queued ? 'הלמידה התחילה.' : 'למידה כבר רצה עכשיו.'),
  },
];

export const toolByName = new Map(TOOLS.map((t) => [t.name, t]));

export function allowed(tool: AgentTool, staff: AgentStaff): boolean {
  if (staff.role === 'admin') return true;
  if (staff.role === 'viewer') return !tool.write;
  return tool.roles.length === 0 || tool.roles.includes(staff.role);
}

export const toolsFor = (staff: AgentStaff) => TOOLS.filter((t) => allowed(t, staff));

/** Validates and runs one tool for a person; errors come back as text the model can explain. */
export async function runTool(s: Services, staff: AgentStaff, name: string, rawInput: unknown): Promise<{ ok: true; result: unknown; outcome: string | null } | { ok: false; error: string }> {
  const tool = toolByName.get(name);
  if (!tool) return { ok: false, error: `אין פעולה בשם ${name}` };
  if (!allowed(tool, staff)) return { ok: false, error: 'אין לך הרשאה לפעולה הזו.' };
  const parsed = tool.input.safeParse(rawInput ?? {});
  if (!parsed.success) return { ok: false, error: `קלט לא תקין: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}` };
  try {
    const result = await tool.run(s, staff, parsed.data);
    return { ok: true, result: result ?? { ok: true }, outcome: tool.outcome ? tool.outcome(result) : null };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    s.log.error({ tool: name, err: e instanceof Error ? e.message : e }, 'agent tool failed');
    return { ok: false, error: e instanceof Error ? e.message : 'הפעולה נכשלה' };
  }
}
