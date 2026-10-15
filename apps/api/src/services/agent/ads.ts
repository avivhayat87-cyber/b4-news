// The ads agent ("סוכן הפרסום"): a campaign proposal from a short brief (and the business's own
// site), a check of an ad before it runs, a summary of a campaign's numbers for the advertiser's
// page, and a picture drawn from a description. Each is a background job over ad_agent_tasks, and
// the CMS asks until it is done. It only proposes: a person makes the campaign from the proposal,
// fixes the ad and approves it. Cheap by design: the fast model, one call each, a picture only on
// request.
import {
  AD_FORMATS,
  AD_LEAD_FIELD_LABELS,
  AD_LEAD_FIELDS,
  AD_SIZES,
  AD_SLOT_FORMATS,
  AD_SLOTS,
  type AdBriefInput,
  type AdSlot,
  type AdTaskDto,
  type AdTaskKind,
  CATEGORIES,
} from '@b4/shared';
import { adAgentTasks, adCampaigns, adCreatives, advertisers, eq } from '@b4/db';
import { AppError, errors } from '../../errors';
import { ingestAdImage } from '../../lib/images';
import { enqueue, type JobRow, PermanentJobError } from '../../lib/jobs';
import { decodeText } from '../../lib/safe-fetch';
import { activePrompt, tracked } from '../ai';
import { imageCostUsd, textCostUsd } from '../ai/prices';
import type { ImageReference } from '../ai/types';
import { campaignDays } from '../ads/campaigns';
import type { Services } from '../context';
import { extractArticle } from '../scraper/parse';

export const AD_AGENT_JOB = 'ads.agent';

type Staff = { id: string };
type TaskRow = typeof adAgentTasks.$inferSelect;

/** What each place is, for the agent (generated from the code, never listed by hand in a skill). */
const SLOT_WHERE: Record<AdSlot, string> = {
  home_top: 'the site\'s home page, under the top stories (a wide banner)',
  sidebar: 'the side column of the home page and the sections',
  article_side: 'beside an article, on large screens',
  article_end: 'after the article text, before the comments',
  app_feed: 'the app\'s home feed, between stories',
  app_article: 'the app, after an article',
};

function optionsText(): string {
  return [
    'Places (slot: where; formats):',
    ...AD_SLOTS.map((s) => `- ${s}: ${SLOT_WHERE[s]}; ${AD_SLOT_FORMATS[s].join(', ')}`),
    `Formats: ${AD_FORMATS.map((f) => `${f} ${AD_SIZES[f].desktop.width}x${AD_SIZES[f].desktop.height}`).join(', ')} (native: a card with a picture, a headline, a line and a button).`,
    'Sections (categories; empty = everywhere):',
    ...CATEGORIES.map((c) => `- ${c.slug}: ${c.name}`),
    'action: link (a click goes to the business\'s page) or lead (a click opens a short form on our site; the reader agrees to be contacted).',
    `lead_fields: ${AD_LEAD_FIELDS.map((f) => `${f} (${AD_LEAD_FIELD_LABELS[f]})`).join(', ')}.`,
  ].join('\n');
}

function toDto(t: TaskRow): AdTaskDto {
  const r = (t.result ?? {}) as Partial<Record<'brief' | 'review' | 'report' | 'image', unknown>>;
  return {
    id: t.id,
    kind: t.kind as AdTaskKind,
    status: t.status as AdTaskDto['status'],
    brief: (r.brief as AdTaskDto['brief']) ?? null,
    review: (r.review as AdTaskDto['review']) ?? null,
    report: (r.report as string | undefined) ?? null,
    image: (r.image as AdTaskDto['image']) ?? null,
    lastError: t.lastError,
    costUsd: Number(t.costUsd),
    createdAt: t.createdAt.toISOString(),
  };
}

export async function adTask(s: Services, id: string): Promise<AdTaskDto> {
  const [row] = await s.db.select().from(adAgentTasks).where(eq(adAgentTasks.id, id)).limit(1);
  if (!row) throw errors.notFound('המשימה');
  return toDto(row);
}

async function start(s: Services, staff: Staff, kind: AdTaskKind, input: Record<string, unknown>, refs: { campaignId?: string; creativeId?: string } = {}): Promise<AdTaskDto> {
  const [row] = await s.db
    .insert(adAgentTasks)
    .values({ kind, input, campaignId: refs.campaignId ?? null, creativeId: refs.creativeId ?? null, createdBy: staff.id })
    .returning();
  await enqueue(s.db, AD_AGENT_JOB, { taskId: row!.id }, { createdBy: staff.id, maxAttempts: 1 });
  return toDto(row!);
}

export const startBrief = (s: Services, staff: Staff, input: AdBriefInput) => start(s, staff, 'brief', input);

export async function startReview(s: Services, staff: Staff, creativeId: string): Promise<AdTaskDto> {
  const [c] = await s.db.select({ id: adCreatives.id, campaignId: adCreatives.campaignId }).from(adCreatives).where(eq(adCreatives.id, creativeId)).limit(1);
  if (!c) throw errors.notFound('המודעה');
  return start(s, staff, 'review', {}, { creativeId, campaignId: c.campaignId });
}

export async function startReport(s: Services, staff: Staff, campaignId: string): Promise<AdTaskDto> {
  const [c] = await s.db.select({ id: adCampaigns.id }).from(adCampaigns).where(eq(adCampaigns.id, campaignId)).limit(1);
  if (!c) throw errors.notFound('הקמפיין');
  return start(s, staff, 'report', {}, { campaignId });
}

export const startDraw = (s: Services, staff: Staff, idea: string) => start(s, staff, 'draw', { idea });

// ---------------------------------------------------------------------------
// The work (a job)
// ---------------------------------------------------------------------------

/** The business's home page as text, for context (free; a page we can't read is simply left out). */
async function siteText(s: Services, url: string): Promise<string> {
  if (!url) return '';
  try {
    const res = await s.fetch(url, { allowTypes: ['text/html', 'application/xhtml'], maxBytes: 3 * 1024 * 1024 });
    const page = extractArticle(decodeText(res), res.url);
    return [page.title, page.intro, page.bodyText].filter(Boolean).join('\n\n').slice(0, 8000);
  } catch {
    return '';
  }
}

const priced = (r: { usage: { model: string; inputTokens: number | null; outputTokens: number | null } }) => textCostUsd(r.usage.model, r.usage.inputTokens, r.usage.outputTokens);

async function runBrief(s: Services, task: TaskRow): Promise<{ result: Record<string, unknown>; costUsd: number }> {
  const input = task.input as AdBriefInput;
  const prompt = await activePrompt(s.db, 'ads.brief');
  const textAi = await s.ai.text();
  const { result } = await tracked(s.db, { type: 'ads', provider: textAi.provider, requestedBy: task.createdBy, promptKey: 'ads.brief', promptVersion: prompt.version }, async () =>
    textAi.adBrief({
      systemPrompt: prompt.body,
      options: optionsText(),
      brief: { business: input.business, website: input.website, offer: input.offer, goal: input.goal, audience: input.audience, notes: input.notes },
      siteText: await siteText(s, input.website),
    }),
  );
  const d = result.data;
  return {
    result: {
      brief: {
        summary: d.summary,
        headlines: d.headlines,
        bodies: d.bodies,
        ctas: d.ctas,
        slots: [...new Set(d.slots)],
        categories: [...new Set(d.categories)],
        action: d.action,
        leadFields: d.action === 'lead' && d.lead_fields.length ? [...new Set(d.lead_fields)] : ['name', 'phone'],
        leadQuestion: d.lead_question,
        imageIdea: d.image_idea,
        warnings: d.warnings,
      },
    },
    costUsd: priced(result) ?? 0,
  };
}

async function runReview(s: Services, task: TaskRow): Promise<{ result: Record<string, unknown>; costUsd: number }> {
  const [row] = await s.db
    .select({ c: adCreatives, campaign: adCampaigns, advertiser: advertisers.name })
    .from(adCreatives)
    .innerJoin(adCampaigns, eq(adCampaigns.id, adCreatives.campaignId))
    .innerJoin(advertisers, eq(advertisers.id, adCampaigns.advertiserId))
    .where(eq(adCreatives.id, task.creativeId ?? ''))
    .limit(1);
  if (!row) throw new PermanentJobError('the ad is gone');
  const { c, campaign } = row;
  const images: ImageReference[] = [];
  for (const key of [...new Set([c.desktopImage, c.mobileImage].filter((k): k is string => Boolean(k)))]) {
    images.push({ data: await s.storage.get(key), mimeType: 'image/webp' });
  }
  const prompt = await activePrompt(s.db, 'ads.review');
  const textAi = await s.ai.text();
  const { result } = await tracked(s.db, { type: 'ads', provider: textAi.provider, requestedBy: task.createdBy, promptKey: 'ads.review', promptVersion: prompt.version }, () =>
    textAi.adReview({
      systemPrompt: prompt.body,
      ad: { advertiser: row.advertiser, sponsor: c.sponsor, format: c.format, headline: c.headline, body: c.body, cta: c.cta, alt: c.alt, url: campaign.url, action: campaign.action, leadQuestion: campaign.leadForm.question },
      images,
    }),
  );
  const review = { verdict: result.data.verdict, issues: result.data.issues, checkedAt: new Date().toISOString() };
  // The check belongs to the ad as it was: an ad changed meanwhile keeps no check.
  const [now] = await s.db.select({ updatedAt: adCreatives.updatedAt }).from(adCreatives).where(eq(adCreatives.id, c.id)).limit(1);
  if (now && now.updatedAt.getTime() === c.updatedAt.getTime()) await s.db.update(adCreatives).set({ review }).where(eq(adCreatives.id, c.id));
  return { result: { review }, costUsd: priced(result) ?? 0 };
}

async function runReport(s: Services, task: TaskRow): Promise<{ result: Record<string, unknown>; costUsd: number }> {
  const [row] = await s.db
    .select({ c: adCampaigns, advertiser: advertisers.name })
    .from(adCampaigns)
    .innerJoin(advertisers, eq(advertisers.id, adCampaigns.advertiserId))
    .where(eq(adCampaigns.id, task.campaignId ?? ''))
    .limit(1);
  if (!row) throw new PermanentJobError('the campaign is gone');
  const days = await campaignDays(s.db, row.c.id, '0000-00-00');
  const sum = days.reduce((t, d) => ({ views: t.views + d.views, clicks: t.clicks + d.clicks, leads: t.leads + d.leads }), { views: 0, clicks: 0, leads: 0 });
  const rate = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(2)}%` : '-');
  const best = [...days].sort((a, b) => b.views - a.views)[0];
  const facts = [
    `Advertiser: ${row.advertiser}`,
    `Campaign: ${row.c.name}`,
    `Dates: ${row.c.startsAt?.toISOString().slice(0, 10) ?? 'from approval'} – ${row.c.endedAt?.toISOString().slice(0, 10) ?? row.c.endsAt?.toISOString().slice(0, 10) ?? 'open'}`,
    `Places: ${(row.c.slots as AdSlot[]).map((x) => SLOT_WHERE[x]).join('; ')}`,
    `Action: ${row.c.action === 'lead' ? 'a lead form' : 'a link to the business'}`,
    `Views (at least half the ad on screen for a second): ${sum.views}`,
    `Clicks: ${sum.clicks} (click rate ${rate(sum.clicks, sum.views)})`,
    row.c.action === 'lead' ? `Leads: ${sum.leads} (from clicks ${rate(sum.leads, sum.clicks)})` : '',
    `Days with numbers: ${days.length}${best ? `; the most viewed day: ${best.day} (${best.views} views)` : ''}`,
  ]
    .filter(Boolean)
    .join('\n');
  const prompt = await activePrompt(s.db, 'ads.report');
  const textAi = await s.ai.text();
  const { result } = await tracked(s.db, { type: 'ads', provider: textAi.provider, requestedBy: task.createdBy, promptKey: 'ads.report', promptVersion: prompt.version }, () =>
    textAi.adReport({ systemPrompt: prompt.body, facts }),
  );
  // A proposal: it reaches the advertiser's page only when an admin saves it on the campaign.
  return { result: { report: result.data.note }, costUsd: priced(result) ?? 0 };
}

/** A picture from a description: translated for the image model, drawn once, kept as a native ad's picture. */
async function runDraw(s: Services, task: TaskRow): Promise<{ result: Record<string, unknown>; costUsd: number }> {
  const idea = String((task.input as { idea?: string }).idea ?? '');
  const textAi = await s.ai.text();
  const imageAi = await s.ai.image();
  const { result: english } = await tracked(s.db, { type: 'ads', provider: textAi.provider, requestedBy: task.createdBy }, () => textAi.toEnglish([idea]));
  const prompt = `${english.data.texts[0] ?? idea}\nA clean advertising photograph or illustration, wide frame, plenty of calm space. No text, letters, logos or watermarks.`;
  const { result } = await tracked(s.db, { type: 'ads', provider: imageAi.provider, model: imageAi.model, requestedBy: task.createdBy, imageCount: 1, costOf: () => imageCostUsd(imageAi, 1) }, async () => ({
    images: await imageAi.generate(prompt, { count: 1, shape: 'landscape' }),
  }));
  const picture = result.images[0];
  if (!picture) throw new AppError(502, 'no_image', 'מודל התמונות לא החזיר תמונה. נסו שוב.');
  const size = AD_SIZES.native.desktop;
  const saved = await ingestAdImage(s.storage, picture, { name: 'photo', width: size.width, height: size.height, fit: 'cover' });
  return { result: { image: { ...saved, url: s.storage.url(saved.key) } }, costUsd: (priced(english) ?? 0) + (imageCostUsd(imageAi, 1) ?? 0) };
}

const RUN: Record<AdTaskKind, (s: Services, t: TaskRow) => Promise<{ result: Record<string, unknown>; costUsd: number }>> = {
  brief: runBrief,
  review: runReview,
  report: runReport,
  draw: runDraw,
};

export async function runAdTask(s: Services, job: JobRow): Promise<void> {
  const [task] = await s.db.select().from(adAgentTasks).where(eq(adAgentTasks.id, String(job.payload.taskId))).limit(1);
  if (!task) throw new PermanentJobError('ad task not found');
  if (task.status === 'done') return;
  await s.db.update(adAgentTasks).set({ status: 'running', lastError: null }).where(eq(adAgentTasks.id, task.id));
  const { result, costUsd } = await RUN[task.kind as AdTaskKind](s, task);
  await s.db.update(adAgentTasks).set({ status: 'done', result, costUsd: costUsd.toFixed(4) }).where(eq(adAgentTasks.id, task.id));
}

export async function markAdTaskFailed(s: Services, job: JobRow, error: Error): Promise<void> {
  const message = error instanceof AppError ? error.message : 'סוכן הפרסום לא הצליח הפעם. נסו שוב בעוד רגע.';
  await s.db.update(adAgentTasks).set({ status: 'failed', lastError: message }).where(eq(adAgentTasks.id, String(job.payload.taskId)));
}
