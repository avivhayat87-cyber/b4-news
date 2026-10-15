// The research reporter: a link or screenshots become a research file (every detail labelled, and
// facts only from official sources), an article written from that file alone, and a copy of every
// source kept as proof (its text, and a screenshot of the page). Its settings and the rules for
// which source may back a fact are in agent/researcher.ts.
import sharp from 'sharp';
import {
  CLAIM_LABELS,
  type ClaimLabel,
  type ResearchDossierDto,
  type ResearchOverviewDto,
  type ResearchTaskDto,
  type SimilarStoryDto,
  type SourceCopyDto,
  type SourceKind,
  type StartResearchInput,
  docToText,
  sanitizeDoc,
  textToDoc,
} from '@b4/shared';
import {
  type ResearchDossierRecord,
  type ResearchSourceRecord,
  and,
  articleDrafts,
  articles,
  desc,
  draftRevisions,
  eq,
  gte,
  inArray,
  mediaAssets,
  notInArray,
  researchTasks,
  scrapedItems,
  sql,
  users,
} from '@b4/db';
import { AppError, errors } from '../errors';
import { PermanentJobError, enqueue, type JobRow } from '../lib/jobs';
import { decodeText } from '../lib/safe-fetch';
import { topicOverlap } from '../lib/similarity';
import { editorGuidelinesFor } from './agent/editor';
import { approvedEntries, getResearcherSettings, judgeSource } from './agent/researcher';
import { israelMonthStart } from './agent/team';
import { activeStyleRules, tracked, writerPrompt } from './ai';
import { WEB_SEARCH_USD, textCostUsd } from './ai/prices';
import type { ImageReference, ResearchOutput, Usage } from './ai/types';
import type { Services } from './context';
import { assertMagazine, categoryIdOf, nextPosition, requestImages } from './drafts';
import { canonicalUrl, sha256 } from './scraper/collect';
import { extractArticle } from './scraper/parse';

export const RESEARCH_JOB = 'research.run';
export const ARCHIVE_JOB = 'research.archive';

type Staff = { id: string; fullName: string };
type TaskRow = typeof researchTasks.$inferSelect;

/** How far back "we may already have this story" looks. */
const SIMILAR_DAYS = 14;
/** Sources kept as proof per research (each is a page read and, with a browser, a screenshot). */
const ARCHIVE_LIMIT = 12;
/** A copy of a source's text is kept up to this length. */
const COPY_CHARS = 20_000;

const SOURCE_NAME: Partial<Record<SourceKind, string>> = { social: 'רשתות חברתיות', wiki: 'ויקיפדיה' };
/** A detail with one of these labels may be written only with a source that may back a fact. */
const NEEDS_APPROVED: ClaimLabel[] = ['verified', 'suspicion', 'debunked'];

// ---------------------------------------------------------------------------
// The budget and stories we already have
// ---------------------------------------------------------------------------

/** What research cost this month (estimated at list prices: tokens and searches). */
export async function researchSpentUsd(s: Services): Promise<number> {
  const { start } = israelMonthStart();
  const [row] = await s.db
    .select({ total: sql<string | null>`sum(${researchTasks.costUsd})` })
    .from(researchTasks)
    .where(gte(researchTasks.createdAt, start));
  return Math.round(Number(row?.total ?? 0) * 10_000) / 10_000;
}

async function assertBudget(s: Services) {
  const settings = await getResearcherSettings(s.db);
  if ((await researchSpentUsd(s)) >= settings.monthlyBudgetUsd) {
    throw new AppError(409, 'research_budget', `התקציב החודשי לתחקירים ($${settings.monthlyBudgetUsd}) נגמר. אדמין יכול להגדיל אותו ב"הגדרות" > "צוות הסוכנים" > "הכתב-החוקר".`);
  }
}

const articleLink = (s: Services, slug: string) => `${s.config.publicSiteUrl.replace(/\/+$/, '')}/article/${slug}`;

/** Articles and drafts from the same link (free: no AI). */
export async function similarForUrl(s: Services, url: string, exceptDraftId?: string): Promise<SimilarStoryDto[]> {
  const canonical = canonicalUrl(url);
  const published = await s.db
    .select({ id: articles.id, slug: articles.slug, title: articles.title, at: articles.publishedAt })
    .from(articles)
    .where(and(eq(articles.status, 'published'), inArray(articles.sourceUrl, [...new Set([url, canonical])])))
    .orderBy(desc(articles.publishedAt))
    .limit(3);
  const drafts = await s.db
    .select({ id: articleDrafts.id, title: articleDrafts.title, at: articleDrafts.createdAt })
    .from(articleDrafts)
    .innerJoin(scrapedItems, eq(articleDrafts.scrapedItemId, scrapedItems.id))
    .where(and(eq(scrapedItems.urlHash, sha256(canonical)), notInArray(articleDrafts.status, ['published', 'skipped'])))
    .orderBy(desc(articleDrafts.createdAt))
    .limit(3);
  return [
    ...published.map((a) => ({ kind: 'article' as const, id: String(a.id), title: a.title, at: a.at.toISOString(), href: articleLink(s, a.slug) })),
    ...drafts.filter((d) => d.id !== exceptDraftId).map((d) => ({ kind: 'draft' as const, id: d.id, title: d.title || 'כתבה בעריכה', at: d.at.toISOString(), href: `/drafts/${d.id}` })),
  ];
}

/** Recent articles and drafts about the same thing, by their headlines (free and rough: a hint). */
export async function similarByTopic(s: Services, text: string, exceptDraftId?: string): Promise<SimilarStoryDto[]> {
  const since = new Date(Date.now() - SIMILAR_DAYS * 24 * 3600_000);
  const [published, drafts] = await Promise.all([
    s.db
      .select({ id: articles.id, slug: articles.slug, title: articles.title, subtitle: articles.subtitle, at: articles.publishedAt })
      .from(articles)
      .where(and(eq(articles.status, 'published'), gte(articles.publishedAt, since))),
    s.db
      .select({ id: articleDrafts.id, title: articleDrafts.title, subtitle: articleDrafts.subtitle, at: articleDrafts.createdAt })
      .from(articleDrafts)
      .where(and(gte(articleDrafts.createdAt, since), notInArray(articleDrafts.status, ['published', 'skipped']))),
  ]);
  const scored = [
    ...published.map((a) => ({ dto: { kind: 'article' as const, id: String(a.id), title: a.title, at: a.at.toISOString(), href: articleLink(s, a.slug) }, ...topicOverlap(text, `${a.title} ${a.subtitle}`) })),
    ...drafts
      .filter((d) => d.id !== exceptDraftId && d.title)
      .map((d) => ({ dto: { kind: 'draft' as const, id: d.id, title: d.title, at: d.at.toISOString(), href: `/drafts/${d.id}` }, ...topicOverlap(text, `${d.title} ${d.subtitle}`) })),
  ];
  return scored
    .filter((x) => x.shared >= 3 && x.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => x.dto);
}

// ---------------------------------------------------------------------------
// Starting a research
// ---------------------------------------------------------------------------

export async function startResearch(s: Services, staff: Staff, input: StartResearchInput): Promise<ResearchTaskDto> {
  await assertBudget(s);
  await assertMagazine(s.db, input.magazineId);
  const mediaIds = input.kind === 'screenshot' ? [...new Set(input.mediaIds)] : [];
  if (mediaIds.length) {
    const found = await s.db.select({ id: mediaAssets.id, mimeType: mediaAssets.mimeType }).from(mediaAssets).where(inArray(mediaAssets.id, mediaIds));
    if (found.length !== mediaIds.length || found.some((m) => !m.mimeType.startsWith('image/'))) throw errors.notFound('צילום המסך');
  }
  const [row] = await s.db
    .insert(researchTasks)
    .values({
      kind: input.kind,
      depth: input.depth,
      url: input.kind === 'link' ? input.url! : null,
      mediaIds,
      note: input.note,
      magazineId: input.magazineId ?? null,
      colorLabel: input.magazineId ? null : (input.colorLabel ?? 'purple'),
      createdBy: staff.id,
    })
    .returning();
  // One attempt: a research is paid for by its searches, so a failure waits for a person.
  await enqueue(s.db, RESEARCH_JOB, { taskId: row!.id }, { createdBy: staff.id, maxAttempts: 1 });
  return researchTask(s, row!.id);
}

/** A failed research again. A file that was already made is kept (only the writing is redone). */
export async function retryResearch(s: Services, staff: Staff, id: string): Promise<ResearchTaskDto> {
  const task = await loadTask(s, id);
  if (task.status !== 'failed') throw new AppError(409, 'research_running', 'התחקיר הזה לא נכשל.');
  await assertBudget(s);
  await s.db.update(researchTasks).set({ status: 'queued', lastError: null }).where(eq(researchTasks.id, id));
  await enqueue(s.db, RESEARCH_JOB, { taskId: id }, { createdBy: staff.id, maxAttempts: 1 });
  return researchTask(s, id);
}

async function loadTask(s: Services, id: string): Promise<TaskRow> {
  const [row] = await s.db.select().from(researchTasks).where(eq(researchTasks.id, id)).limit(1);
  if (!row) throw errors.notFound('התחקיר');
  return row;
}

// ---------------------------------------------------------------------------
// The research job
// ---------------------------------------------------------------------------

/** What a call cost: its tokens, and its searches. */
function callCost(usage: Usage, searches = 0): number {
  return (textCostUsd(usage.model, usage.inputTokens, usage.outputTokens) ?? 0) + searches * WEB_SEARCH_USD;
}

type Page = { title: string; intro: string | null; bodyText: string; imageUrl: string | null; publishedAt: Date | null; url: string };

async function readPage(s: Services, url: string): Promise<Page | null> {
  try {
    const res = await s.fetch(url, { allowTypes: ['text/html', 'application/xhtml'] });
    const page = extractArticle(decodeText(res), res.url);
    return page.title || page.bodyText ? { ...page, url: res.url } : null;
  } catch (e) {
    s.log.warn({ url, err: e instanceof Error ? e.message : e }, 'research: reading the link failed');
    return null;
  }
}

async function screenshotsOf(s: Services, mediaIds: string[]): Promise<ImageReference[]> {
  if (!mediaIds.length) return [];
  const rows = await s.db.select({ id: mediaAssets.id, key: mediaAssets.storageKey }).from(mediaAssets).where(inArray(mediaAssets.id, mediaIds));
  const out: ImageReference[] = [];
  for (const id of mediaIds) {
    const m = rows.find((r) => r.id === id);
    if (!m) continue;
    // Large enough to read small text in a screenshot, within what the model takes in.
    const data = await sharp(await s.storage.get(m.key)).rotate().resize({ width: 1568, height: 1568, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 85 }).toBuffer();
    out.push({ data, mimeType: 'image/jpeg' });
  }
  return out;
}

const sameUrl = (a: string, b: string) => a.replace(/[#?].*$/, '').replace(/\/+$/, '') === b.replace(/[#?].*$/, '').replace(/\/+$/, '');
const hostName = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

/**
 * The model's file, checked: every source judged by its address, every detail's sources known,
 * and a detail whose label needs an official source but has none marked down (with a note why).
 */
export function checkDossier(out: ResearchOutput, original: string | null, entries: string[]): ResearchDossierRecord {
  const sources: ResearchSourceRecord[] = [];
  const add = (url: string, title: string, publisher: string, kind: SourceKind, usedFor: string): ResearchSourceRecord | null => {
    const known = sources.find((x) => sameUrl(x.url, url));
    if (known) return known;
    const judged = judgeSource(url, kind, entries);
    if (!judged) return null;
    const record: ResearchSourceRecord = {
      id: `s${sources.length + 1}`,
      url,
      title: title.trim() || hostName(url),
      publisher: SOURCE_NAME[judged.kind] ?? (publisher.trim() || hostName(url)),
      kind: judged.kind,
      approved: judged.approved,
      usedFor,
      archive: { status: 'pending', capturedAt: null, text: null, screenshotKey: null, error: null },
    };
    sources.push(record);
    return record;
  };
  for (const src of out.sources) add(src.url, src.title, src.publisher, src.kind, src.used_for);
  // The report itself is always kept as proof of what was reported.
  const originalUrl = original ?? (out.original.url.startsWith('http') ? out.original.url : null);
  if (originalUrl) add(originalUrl, out.original.what.slice(0, 200), out.original.who, 'other', 'lead');

  const claims = out.claims.map((c, i) => {
    const ids = [...new Set(c.source_urls.map((u) => add(u, '', '', 'other', 'fact')?.id).filter((x): x is string => Boolean(x)))];
    const backing = sources.filter((x) => ids.includes(x.id));
    let label: ClaimLabel = CLAIM_LABELS.includes(c.label) ? c.label : 'unverified';
    let note = c.note.trim();
    const downgrade = (to: ClaimLabel, why: string) => {
      label = to;
      note = [note, why].filter(Boolean).join(' ');
    };
    if (NEEDS_APPROVED.includes(label) && !backing.some((x) => x.approved)) {
      if (label === 'verified' && backing.length) downgrade('reported', 'סומן מחדש כ"דיווח": אין לו מקור רשמי.');
      else downgrade('unverified', label === 'suspicion' ? 'חשד בלי מקור רשמי (משטרה, תביעה, בית משפט, רגולטור): לא נכנס לכתבה.' : 'סומן מחדש כ"לא מאומת": אין לו מקור רשמי.');
    } else if ((label === 'reported' || label === 'claimed') && !backing.length) {
      downgrade('unverified', 'סומן מחדש כ"לא מאומת": לא צוין מקור.');
    }
    return { id: `c${i + 1}`, text: c.text.trim(), label, sourceIds: ids, note };
  });

  // The line at the end of the article: who the facts and the background came from, names only.
  const usedIds = new Set(claims.filter((c) => c.label !== 'unverified').flatMap((c) => c.sourceIds));
  const credited = sources.filter((x) => (x.approved && (usedIds.has(x.id) || x.usedFor !== 'lead')) || (x.kind === 'wiki' && x.usedFor === 'background'));
  const names = [...new Set(credited.map((x) => x.publisher))];
  return {
    original: { ...out.original, url: originalUrl },
    summary: out.summary,
    claims,
    background: out.background,
    openQuestions: out.open_questions,
    responseNeeded: out.response_needed,
    sources,
    creditLine: names.length ? `מקורות: ${names.join(', ')}` : '',
  };
}

/** The file as the writer reads it: each detail with its label and who published its sources. */
function dossierText(d: ResearchDossierRecord): string {
  const publishers = (ids: string[]) => [...new Set(d.sources.filter((x) => ids.includes(x.id)).map((x) => (x.kind === 'news' ? `דיווח ב-${x.publisher}` : x.publisher)))].join(', ');
  const list = (title: string, items: string[]) => (items.length ? `${title}\n${items.map((x) => `* ${x}`).join('\n')}` : '');
  return [
    `הדיווח המקורי: ${[d.original.who, d.original.when].filter(Boolean).join(', ')}: ${d.original.what}`,
    `סיכום: ${d.summary}`,
    `פרטים (כל פרט עם הסימון שלו ומי פרסם את המקורות שלו):\n${d.claims.map((c) => `- [${c.label}] ${c.text}${c.sourceIds.length ? ` (מקורות: ${publishers(c.sourceIds)})` : ''}${c.note ? ` | הערה: ${c.note}` : ''}`).join('\n')}`,
    list('רקע:', d.background),
    list('שאלות פתוחות:', d.openQuestions),
    list('לפנות לתגובה לפני פרסום:', d.responseNeeded),
  ]
    .filter(Boolean)
    .join('\n\n');
}

function israelToday(): string {
  return new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date());
}

export async function runResearch(s: Services, job: JobRow) {
  const task = await loadTask(s, String(job.payload.taskId));
  if (task.status === 'done') return { skipped: 'done' };
  const textAi = await s.ai.text();
  let cost = Number(task.costUsd);
  let searches = task.searches;
  let page: Page | null = task.url ? await readPage(s, task.url) : null;

  // 1. The research file (kept from an earlier attempt that failed while writing).
  let dossier = task.dossier;
  if (!dossier) {
    await s.db.update(researchTasks).set({ status: 'researching', updatedAt: new Date() }).where(eq(researchTasks.id, task.id));
    const settings = await getResearcherSettings(s.db);
    const entries = approvedEntries(settings);
    const prompt = await writerPrompt(s.db, 'research.system');
    const { result } = await tracked(
      s.db,
      {
        type: 'research',
        provider: textAi.provider,
        requestedBy: task.createdBy,
        promptKey: 'research.system',
        promptVersion: prompt.version,
        costOf: (r) => (textAi.live ? callCost(r.usage, r.searches) : null),
      },
      async () =>
        textAi.research({
          systemPrompt: prompt.body,
          approvedSources: entries,
          depth: task.depth as ResearchTaskDto['depth'],
          input: {
            kind: task.kind as ResearchTaskDto['kind'],
            url: task.url,
            pageText: page ? [page.title, page.intro, page.bodyText].filter(Boolean).join('\n\n') : null,
            images: await screenshotsOf(s, task.mediaIds),
            note: task.note,
          },
          today: israelToday(),
        }),
    );
    if (textAi.live) cost += callCost(result.usage, result.searches);
    searches += result.searches;
    if (result.toolErrors.length) s.log.warn({ taskId: task.id, errors: result.toolErrors }, 'research: web searches or fetches failed');
    dossier = checkDossier(result.data, task.url, entries);
    await s.db
      .update(researchTasks)
      .set({ status: 'writing', dossier, searches, costUsd: cost.toFixed(4), updatedAt: new Date() })
      .where(eq(researchTasks.id, task.id));
  } else {
    await s.db.update(researchTasks).set({ status: 'writing', updatedAt: new Date() }).where(eq(researchTasks.id, task.id));
  }

  // 2. The article, from the file alone; the sources line is added here, never by the model.
  const write = await writerPrompt(s.db, 'research.write');
  const styleRules = `${await activeStyleRules(s.db)}\n${await editorGuidelinesFor(s.db)}`;
  const { result: written, aiJobId } = await tracked(
    s.db,
    { type: 'research', provider: textAi.provider, requestedBy: task.createdBy, promptKey: 'research.write', promptVersion: write.version, costOf: (r) => (textAi.live ? callCost(r.usage) : null) },
    () => textAi.researchWrite({ systemPrompt: write.body, styleRules, dossier: dossierText(dossier), note: task.note }),
  );
  if (textAi.live) cost += callCost(written.usage);
  const out = written.data;
  const doc = sanitizeDoc(textToDoc([...out.paragraphs, ...(dossier.creditLine ? [dossier.creditLine] : [])]));
  const bodyText = docToText(doc);
  const suggestedCategoryId = out.suggested_category ? await categoryIdOf(s.db, out.suggested_category).catch(() => null) : null;

  // 3. The draft, with the link's page as its original when there is one.
  if (!page && task.url) page = await readPage(s, task.url);
  const scrapedItemId = page && task.url ? await originalItem(s, task.url, page) : null;
  const position = await nextPosition(s.db, task.magazineId ?? undefined);
  const draftId = await s.db.transaction(async (tx) => {
    const [draft] = await tx
      .insert(articleDrafts)
      .values({
        magazineId: task.magazineId,
        position,
        origin: 'research',
        scrapedItemId,
        status: 'editing',
        colorLabel: task.magazineId ? null : (task.colorLabel ?? 'purple'),
        title: out.title,
        subtitle: out.subtitle,
        bodyDoc: doc,
        bodyText,
        aiBaselineTitle: out.title,
        aiBaselineText: bodyText,
        aiBaselineJobId: aiJobId,
        suggestedCategoryId,
        categoryId: suggestedCategoryId,
        tagNames: out.suggested_tags,
        createdBy: task.createdBy,
        updatedBy: task.createdBy,
      })
      .returning({ id: articleDrafts.id, version: articleDrafts.version });
    await tx.insert(draftRevisions).values({ draftId: draft!.id, version: draft!.version, source: 'ai_initial', title: out.title, subtitle: out.subtitle, bodyDoc: doc, bodyText, aiJobId });
    return draft!.id;
  });

  const similar = [...(task.url ? await similarForUrl(s, task.url, draftId) : []), ...(await similarByTopic(s, `${out.title} ${out.subtitle}`, draftId))];
  const unique = similar.filter((x, i) => similar.findIndex((y) => y.kind === x.kind && y.id === x.id) === i).slice(0, 4);
  await s.db
    .update(researchTasks)
    .set({ status: 'done', draftId, similar: unique, costUsd: cost.toFixed(4), lastError: null, updatedAt: new Date() })
    .where(eq(researchTasks.id, task.id));

  await enqueue(s.db, ARCHIVE_JOB, { taskId: task.id }, { createdBy: task.createdBy, maxAttempts: 1 });
  if (s.config.ai.autoImages) await requestImages(s, task.createdBy, draftId, 'article').catch(() => undefined);
  return { draftId };
}

/** The link's page as the draft's original (the editor reads it beside the article). */
async function originalItem(s: Services, url: string, page: Page): Promise<string | null> {
  if (!page.title || page.bodyText.length < 200) return null;
  const urlHash = sha256(canonicalUrl(url));
  const [found] = await s.db.select({ id: scrapedItems.id }).from(scrapedItems).where(eq(scrapedItems.urlHash, urlHash)).limit(1);
  if (found) return found.id;
  const [item] = await s.db
    .insert(scrapedItems)
    .values({ url, urlHash, title: page.title.slice(0, 500), intro: page.intro, bodyText: page.bodyText.slice(0, 100_000), imageUrl: page.imageUrl, publishedAt: page.publishedAt, status: 'in_draft' })
    .onConflictDoNothing()
    .returning({ id: scrapedItems.id });
  return item?.id ?? null;
}

export async function markResearchFailed(s: Services, job: JobRow, error: Error) {
  await s.db
    .update(researchTasks)
    .set({ status: 'failed', lastError: error.message.slice(0, 2000), updatedAt: new Date() })
    .where(eq(researchTasks.id, String(job.payload.taskId)));
}

// ---------------------------------------------------------------------------
// Proof: a copy of every source
// ---------------------------------------------------------------------------

async function copyText(s: Services, url: string): Promise<string | null> {
  const res = await s.fetch(url, { allowTypes: ['text/html', 'application/xhtml', 'text/plain'], maxBytes: 5 * 1024 * 1024 });
  const raw = decodeText(res);
  if (res.contentType.startsWith('text/plain')) return raw.slice(0, COPY_CHARS);
  const page = extractArticle(raw, res.url);
  const text = [page.title, page.intro, page.bodyText].filter(Boolean).join('\n\n').trim();
  return text ? text.slice(0, COPY_CHARS) : null;
}

/** Each source the article rests on, and the report itself: its text, and a screenshot when a browser is available. */
export async function runArchive(s: Services, job: JobRow) {
  const task = await loadTask(s, String(job.payload.taskId));
  if (!task.dossier) throw new PermanentJobError('research has no file');
  const settings = await getResearcherSettings(s.db);
  const shoot = settings.screenshots && s.capture.available;
  const now = new Date();
  const folder = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${task.id}`;
  // The report itself first, then what backs the facts, the background, and the other leads.
  const original = task.dossier.original.url;
  const rank = (x: ResearchSourceRecord) => (original && sameUrl(x.url, original) ? 0 : x.usedFor === 'fact' ? 1 : x.usedFor === 'background' ? 2 : 3);
  const open = task.dossier.sources.filter((x) => x.archive.status !== 'saved').sort((a, b) => rank(a) - rank(b));
  const wanted = open.slice(0, ARCHIVE_LIMIT);
  const done = new Map<string, ResearchSourceRecord['archive']>();
  for (const src of open.slice(ARCHIVE_LIMIT)) done.set(src.id, { status: 'skipped', capturedAt: null, text: null, screenshotKey: null, error: null });
  for (const src of wanted) {
    const problems: string[] = [];
    const text = await copyText(s, src.url).catch((e) => {
      s.log.warn({ url: src.url, err: e instanceof Error ? e.message : e }, 'research: copying a source failed');
      return null;
    });
    if (!text) problems.push('לא הצלחנו לשמור עותק של הטקסט');
    let screenshotKey: string | null = null;
    if (shoot) {
      try {
        const key = `${folder}/source-${src.id}.jpg`;
        await s.storage.put(key, await s.capture.screenshot(src.url), 'image/jpeg');
        screenshotKey = key;
      } catch (e) {
        s.log.warn({ url: src.url, err: e instanceof Error ? e.message : e }, 'research: screenshot failed');
        problems.push('לא הצלחנו לצלם את העמוד');
      }
    } else if (settings.screenshots) {
      problems.push('אין במחשב הזה דפדפן לצילום עמודים');
    }
    done.set(src.id, { status: text || screenshotKey ? 'saved' : 'failed', capturedAt: now.toISOString(), text, screenshotKey, error: problems.length ? `${problems.join('; ')}.` : null });
  }
  // The file may have changed meanwhile only here, so the latest one is read back before saving.
  const fresh = await loadTask(s, task.id);
  if (!fresh.dossier) return { saved: 0 };
  const dossier: ResearchDossierRecord = { ...fresh.dossier, sources: fresh.dossier.sources.map((x) => (done.has(x.id) ? { ...x, archive: done.get(x.id)! } : x)) };
  await s.db.update(researchTasks).set({ dossier, updatedAt: new Date() }).where(eq(researchTasks.id, task.id));
  return { saved: [...done.values()].filter((a) => a.status === 'saved').length };
}

export async function retryArchive(s: Services, staff: Staff, id: string): Promise<ResearchTaskDto> {
  const task = await loadTask(s, id);
  if (!task.dossier) throw new AppError(409, 'no_dossier', 'לתחקיר הזה עוד אין תיק.');
  await enqueue(s.db, ARCHIVE_JOB, { taskId: id }, { createdBy: staff.id, maxAttempts: 1 });
  return researchTask(s, id);
}

export async function sourceCopy(s: Services, id: string, sourceId: string): Promise<SourceCopyDto> {
  const task = await loadTask(s, id);
  const src = task.dossier?.sources.find((x) => x.id === sourceId);
  if (!src?.archive.text) throw errors.notFound('העותק');
  return { url: src.url, capturedAt: src.archive.capturedAt, text: src.archive.text };
}

// ---------------------------------------------------------------------------
// Reading models
// ---------------------------------------------------------------------------

/** A failure in words an editor can act on. */
function errorMessage(raw: string | null): string | null {
  if (!raw) return null;
  if (/[א-ת]/.test(raw)) return raw;
  if (/cut off|max_tokens/.test(raw)) return 'התחקיר יצא ארוך מדי ונקטע. נסו שוב, או בעומק "מהיר".';
  if (/declined/.test(raw)) return 'ה-AI סירב לחקור את הדיווח הזה.';
  if (/not connected|api key|401|403/i.test(raw)) return 'אין חיבור ל-Claude. בדקו את המפתח ב"הגדרות" > "חיבורים".';
  return 'התחקיר נכשל. אפשר לנסות שוב.';
}

function dossierDto(s: Services, d: ResearchDossierRecord): ResearchDossierDto {
  return {
    ...d,
    claims: d.claims.map((c) => ({ ...c, label: (CLAIM_LABELS as readonly string[]).includes(c.label) ? (c.label as ClaimLabel) : 'unverified' })),
    sources: d.sources.map(({ archive, usedFor: _u, ...x }) => ({
      ...x,
      kind: x.kind as SourceKind,
      archive: { status: archive.status, capturedAt: archive.capturedAt, hasText: Boolean(archive.text), screenshotUrl: archive.screenshotKey ? s.storage.url(archive.screenshotKey) : null, error: archive.error },
    })),
  };
}

const TASK_FIELDS = {
  id: researchTasks.id,
  kind: researchTasks.kind,
  depth: researchTasks.depth,
  url: researchTasks.url,
  mediaIds: researchTasks.mediaIds,
  note: researchTasks.note,
  status: researchTasks.status,
  title: articleDrafts.title,
  // Read in the database, so the list needn't carry the files.
  official: sql<boolean>`coalesce(exists (select 1 from jsonb_array_elements(${researchTasks.dossier} -> 'claims') c where c ->> 'label' = 'verified'), false)`,
  similar: researchTasks.similar,
  draftId: researchTasks.draftId,
  searches: researchTasks.searches,
  costUsd: researchTasks.costUsd,
  lastError: researchTasks.lastError,
  createdBy: users.fullName,
  createdAt: researchTasks.createdAt,
};

type TaskListRow = Omit<TaskRow, 'dossier' | 'magazineId' | 'colorLabel' | 'createdBy' | 'updatedAt'> & { createdBy: string | null; title: string | null; official: boolean };

async function taskDtos(s: Services, rows: TaskListRow[], dossiers: Map<string, ResearchDossierRecord | null> = new Map()): Promise<ResearchTaskDto[]> {
  const mediaIds = [...new Set(rows.flatMap((r) => r.mediaIds))];
  const media = mediaIds.length ? await s.db.select({ id: mediaAssets.id, key: mediaAssets.storageKey }).from(mediaAssets).where(inArray(mediaAssets.id, mediaIds)) : [];
  return rows.map((r) => {
    const d = dossiers.get(r.id);
    return {
      id: r.id,
      kind: r.kind as ResearchTaskDto['kind'],
      depth: r.depth as ResearchTaskDto['depth'],
      url: r.url,
      screenshots: r.mediaIds.map((id) => media.find((m) => m.id === id)).filter((m) => m !== undefined).map((m) => s.storage.url(m.key)),
      note: r.note,
      status: r.status as ResearchTaskDto['status'],
      title: r.title || d?.summary.slice(0, 160) || (r.url ? hostName(r.url) : 'צילום מסך'),
      dossier: d ? dossierDto(s, d) : null,
      official: Boolean(r.official),
      similar: r.similar,
      draftId: r.draftId,
      searches: r.searches,
      costUsd: Number(r.costUsd),
      error: r.status === 'failed' ? errorMessage(r.lastError) : null,
      createdBy: r.createdBy ?? '',
      createdAt: r.createdAt.toISOString(),
    };
  });
}

export async function researchTask(s: Services, id: string): Promise<ResearchTaskDto> {
  const [row] = await s.db.select({ ...TASK_FIELDS, dossier: researchTasks.dossier }).from(researchTasks).leftJoin(users, eq(researchTasks.createdBy, users.id)).leftJoin(articleDrafts, eq(researchTasks.draftId, articleDrafts.id)).where(eq(researchTasks.id, id)).limit(1);
  if (!row) throw errors.notFound('התחקיר');
  return (await taskDtos(s, [row], new Map([[row.id, row.dossier]])))[0]!;
}

/** The research a draft was written from, if it was. */
export async function researchForDraft(s: Services, draftId: string): Promise<ResearchTaskDto | null> {
  const [row] = await s.db.select({ id: researchTasks.id }).from(researchTasks).where(eq(researchTasks.draftId, draftId)).orderBy(desc(researchTasks.createdAt)).limit(1);
  return row ? researchTask(s, row.id) : null;
}

/** The recent research (without their files: the list is light; one task is read in full), and the month's budget. */
export async function researchOverview(s: Services): Promise<ResearchOverviewDto> {
  const rows = await s.db.select(TASK_FIELDS).from(researchTasks).leftJoin(users, eq(researchTasks.createdBy, users.id)).leftJoin(articleDrafts, eq(researchTasks.draftId, articleDrafts.id)).orderBy(desc(researchTasks.createdAt)).limit(20);
  const settings = await getResearcherSettings(s.db);
  return { tasks: await taskDtos(s, rows), spentUsd: await researchSpentUsd(s), budgetUsd: settings.monthlyBudgetUsd, defaultDepth: settings.defaultDepth };
}
