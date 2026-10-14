// The social page: every article that is on the site, and whether it went out
// to the networks. The newsroom picks articles that haven't, the AI writes a
// kit (frame, label, headline, opening sentence, caption, hashtags), the server
// renders the branded post (4:5) and story (9:16) the editor wants, a reel is
// made on request (social-reel.ts), and the editor publishes them to the
// accounts they choose. The link always points at the article page.
import { randomUUID } from 'node:crypto';
import {
  DESIGN_FORMATS,
  SHARE_FORMATS,
  SHARE_LIMITS,
  type PublishSharesInput,
  type ShareFormat,
  type ShareDto,
  type ShareFilter,
  type ShareList,
  type SharePostDto,
  type ShareTargetDto,
  type ShareTemplate,
  type SocialPlatform,
  type UpdateShareInput,
  docToText,
  sanitizeDoc,
} from '@b4/shared';
import {
  and,
  articleSharePosts,
  articleShares,
  articles,
  categories,
  desc,
  eq,
  ilike,
  inArray,
  jobs,
  mediaAssets,
  socialAccounts,
  socialPosts,
  sql,
} from '@b4/db';
import { AppError, errors } from '../errors';
import { toMediaDto } from '../lib/images';
import { PermanentJobError, enqueue, type JobRow } from '../lib/jobs';
import { tracked, writerPrompt } from './ai';
import type { Services } from './context';
import { type SocialPayload, autoFormats, postText, publishToNetwork } from './social-adapters';
import { renderDesign } from './social-design';
import { REEL_JOB_KINDS, reelError, reelSettingsOf } from './social-reel';

type Staff = { id: string };
type ShareRow = typeof articleShares.$inferSelect;
type AccountRow = typeof socialAccounts.$inferSelect;

export const KIT_JOB = 'social.kit';
export const SHARE_PUBLISH_JOB = 'social.publish';
const PAGE_SIZE = 30;

// --- Helpers -------------------------------------------------------------------------
/** "b4news.co.il": the site's address as printed on the designs. */
export function siteHost(publicSiteUrl: string): string {
  try {
    return new URL(publicSiteUrl).host.replace(/^www\./, '');
  } catch {
    return publicSiteUrl;
  }
}

/** The short article link, tagged so the site's analytics can tell the networks apart. */
export function articleLink(publicSiteUrl: string, articleId: number, platform: SocialPlatform): string {
  return `${publicSiteUrl}/a/${articleId}?utm_source=${platform}&utm_medium=social&utm_campaign=b4_social`;
}

/** The post body: the opening sentence, the caption, where the link is, hashtags. */
export function shareBody(share: Pick<ShareRow, 'hook' | 'caption' | 'hashtags'>, linkInFirstComment: boolean): string {
  const lines = [[share.hook, share.caption].filter((x) => x.trim()).join(' ')];
  if (linkInFirstComment) lines.push('הקישור לכתבה המלאה בתגובה הראשונה');
  if (share.hashtags.length) lines.push(share.hashtags.map((h) => `#${h}`).join(' '));
  return lines.filter(Boolean).join('\n\n');
}

function htmlToText(html: string): string {
  return html
    .replace(/<\/(p|h[1-6]|li|blockquote)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const jerusalemTime = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false });

export async function loadArticle(s: Services, articleId: number) {
  const [row] = await s.db
    .select({ article: articles, category: categories.name })
    .from(articles)
    .innerJoin(categories, eq(articles.categoryId, categories.id))
    .where(eq(articles.id, articleId))
    .limit(1);
  if (!row) throw errors.notFound('הכתבה');
  if (row.article.status !== 'published') throw new AppError(409, 'not_published', 'הכתבה לא מפורסמת באתר.');
  return row;
}

export async function loadShare(s: Services, articleId: number): Promise<ShareRow | null> {
  const [row] = await s.db.select().from(articleShares).where(eq(articleShares.articleId, articleId)).limit(1);
  return row ?? null;
}

/** The AI's kit texts, trimmed to the design's limits; hashtags without "#" and spaces, no repeats. */
export function kitTexts(kit: { kicker: string; headline: string; hook: string; caption: string; hashtags: string[] }) {
  return {
    kicker: kit.kicker.trim().slice(0, SHARE_LIMITS.kicker),
    headline: kit.headline.trim().slice(0, SHARE_LIMITS.headline),
    hook: kit.hook.trim().slice(0, SHARE_LIMITS.hook),
    caption: kit.caption.trim().slice(0, SHARE_LIMITS.caption),
    hashtags: [...new Set(kit.hashtags.map((h) => h.replace(/^#+/, '').trim().replace(/\s+/g, '_')).filter((h) => h && h.length <= SHARE_LIMITS.hashtag))].slice(0, SHARE_LIMITS.hashtags),
  };
}

/** Posts of these articles from this page and from the editor's social module. */
export async function postsOf(s: Services, articleIds: number[]): Promise<Map<number, SharePostDto[]>> {
  const out = new Map<number, SharePostDto[]>();
  if (!articleIds.length) return out;
  const cols = {
    articleId: articleSharePosts.articleId,
    accountId: socialAccounts.id,
    platform: socialAccounts.platform,
    displayName: socialAccounts.displayName,
    format: articleSharePosts.format,
    status: articleSharePosts.status,
    lastError: articleSharePosts.lastError,
    postedAt: articleSharePosts.postedAt,
  };
  const here = await s.db
    .select(cols)
    .from(articleSharePosts)
    .innerJoin(socialAccounts, eq(articleSharePosts.socialAccountId, socialAccounts.id))
    .where(inArray(articleSharePosts.articleId, articleIds));
  const fromEditor = await s.db
    .select({ ...cols, articleId: socialPosts.articleId, format: socialPosts.format, status: socialPosts.status, lastError: socialPosts.lastError, postedAt: socialPosts.postedAt })
    .from(socialPosts)
    .innerJoin(socialAccounts, eq(socialPosts.socialAccountId, socialAccounts.id))
    .where(and(inArray(socialPosts.articleId, articleIds), inArray(socialPosts.status, ['posted', 'skipped', 'failed'])));
  for (const p of [...here, ...fromEditor]) {
    if (p.articleId === null) continue;
    const list = out.get(p.articleId) ?? [];
    list.push({ accountId: p.accountId, platform: p.platform, displayName: p.displayName, format: p.format, status: p.status, lastError: p.lastError, postedAt: p.postedAt?.toISOString() ?? null });
    out.set(p.articleId, list);
  }
  return out;
}

/** Social jobs (AI kit, reel, publishing) still waiting or running, per article. */
async function activeJobs(s: Services, articleIds: number[]) {
  if (!articleIds.length) return new Map<number, { id: string; kind: string; status: 'queued' | 'running'; error: string | null }>();
  const rows = await s.db
    .select({ id: jobs.id, kind: jobs.kind, status: jobs.status, error: jobs.lastError, payload: jobs.payload })
    .from(jobs)
    .where(and(inArray(jobs.kind, [KIT_JOB, ...REEL_JOB_KINDS, SHARE_PUBLISH_JOB]), inArray(jobs.status, ['queued', 'running'])))
    .orderBy(desc(jobs.createdAt));
  const out = new Map<number, { id: string; kind: string; status: 'queued' | 'running'; error: string | null }>();
  for (const r of rows) {
    const ids = r.kind === SHARE_PUBLISH_JOB ? ((r.payload.articleIds as number[] | undefined) ?? []) : [Number(r.payload.articleId)];
    for (const id of ids) {
      if (articleIds.includes(id) && !out.has(id)) out.set(id, { id: r.id, kind: r.kind, status: r.status as 'queued' | 'running', error: r.error });
    }
  }
  return out;
}

const postedHere = sql`exists (select 1 from ${articleSharePosts} where ${articleSharePosts.articleId} = ${articles.id} and ${articleSharePosts.status} = 'posted')`;
const postedFromEditor = sql`exists (select 1 from ${socialPosts} where ${socialPosts.articleId} = ${articles.id} and ${socialPosts.status} = 'posted')`;
const shared = sql`(${postedHere} or ${postedFromEditor})`;
const notShared = sql`not ${shared}`;

// --- Reading ---------------------------------------------------------------------------
export async function listShares(s: Services, query: { filter: ShareFilter; q?: string; page: number }): Promise<ShareList> {
  const conditions = [eq(articles.status, 'published')];
  if (query.filter === 'pending') conditions.push(notShared);
  if (query.filter === 'shared') conditions.push(shared);
  if (query.q) conditions.push(ilike(articles.title, `%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`));
  const where = and(...conditions);

  const [{ total } = { total: 0 }] = await s.db.select({ total: sql<number>`count(*)::int` }).from(articles).where(where);
  const [{ pending } = { pending: 0 }] = await s.db
    .select({ pending: sql<number>`count(*)::int` })
    .from(articles)
    .where(and(eq(articles.status, 'published'), notShared));
  const rows = await s.db
    .select({
      id: articles.id,
      title: articles.title,
      publishedAt: articles.publishedAt,
      category: categories.name,
      hero: mediaAssets,
      template: articleShares.template,
      headline: articleShares.headline,
    })
    .from(articles)
    .innerJoin(categories, eq(articles.categoryId, categories.id))
    .leftJoin(mediaAssets, eq(articles.heroMediaId, mediaAssets.id))
    .leftJoin(articleShares, eq(articleShares.articleId, articles.id))
    .where(where)
    .orderBy(desc(articles.publishedAt), desc(articles.id))
    .limit(PAGE_SIZE)
    .offset((query.page - 1) * PAGE_SIZE);

  const ids = rows.map((r) => r.id);
  const posts = await postsOf(s, ids);
  const busy = await activeJobs(s, ids);
  return {
    items: rows.map((r) => ({
      articleId: r.id,
      title: r.title,
      category: r.category,
      publishedAt: r.publishedAt.toISOString(),
      thumbUrl: r.hero ? s.storage.url(r.hero.variants.thumb ?? r.hero.storageKey) : null,
      hasKit: Boolean(r.headline),
      template: (r.template as ShareTemplate | null) ?? null,
      busy: busy.has(r.id),
      posts: posts.get(r.id) ?? [],
    })),
    total,
    pendingCount: pending,
    page: query.page,
    pageSize: PAGE_SIZE,
  };
}

async function activeAccounts(s: Services): Promise<AccountRow[]> {
  return s.db.select().from(socialAccounts).where(eq(socialAccounts.isActive, true)).orderBy(socialAccounts.platform);
}

export async function listTargets(s: Services): Promise<ShareTargetDto[]> {
  const accounts = await activeAccounts(s);
  return Promise.all(
    accounts.map(async (a) => {
      const connected = Boolean(await s.settings.socialToken(a));
      return { id: a.id, platform: a.platform, displayName: a.displayName, connected, autoFormats: connected ? autoFormats(a.platform) : [], linkInFirstComment: a.linkInFirstComment };
    }),
  );
}

export async function getShare(s: Services, articleId: number): Promise<ShareDto> {
  const { article, category } = await loadArticle(s, articleId);
  const share = await loadShare(s, articleId);
  const mediaIds = [article.heroMediaId, share?.imageMediaId].filter((x): x is string => Boolean(x));
  const media = mediaIds.length ? await s.db.select().from(mediaAssets).where(inArray(mediaAssets.id, mediaIds)) : [];
  const hero = media.find((m) => m.id === article.heroMediaId);
  const chosen = media.find((m) => m.id === share?.imageMediaId);
  const accounts = await activeAccounts(s);
  const texts: Record<string, string> = {};
  if (share) {
    for (const a of accounts) {
      texts[a.id] = postText({ headline: share.headline, caption: shareBody(share, a.linkInFirstComment), articleUrl: articleLink(s.config.publicSiteUrl, articleId, a.platform), linkInFirstComment: a.linkInFirstComment, storyImageUrl: '', squareImageUrl: '' });
    }
  }
  const job = (await activeJobs(s, [articleId])).get(articleId) ?? null;
  const [reelPicture] = share?.reelImageMediaId ? await s.db.select().from(mediaAssets).where(eq(mediaAssets.id, share.reelImageMediaId)).limit(1) : [];
  const reel = await reelSettingsOf(s, share?.reelSettings);
  return {
    articleId,
    article: {
      title: article.title,
      excerpt: article.excerpt,
      category,
      url: `${s.config.publicSiteUrl}/a/${articleId}`,
      heroUrl: hero ? s.storage.url(hero.variants.card ?? hero.storageKey) : null,
    },
    template: (share?.template as ShareTemplate | undefined) ?? 'headline',
    kicker: share?.kicker ?? '',
    headline: share?.headline ?? '',
    hook: share?.hook ?? '',
    caption: share?.caption ?? '',
    hashtags: share?.hashtags ?? [],
    image: chosen ? toMediaDto(s.storage, chosen) : null,
    rendered: {
      feed: share?.rendered.feed ? s.storage.url(share.rendered.feed) : null,
      story: share?.rendered.story ? s.storage.url(share.rendered.story) : null,
    },
    formats: ((share?.formats ?? ['feed', 'story']) as ShareFormat[]).filter((f) => (SHARE_FORMATS as readonly string[]).includes(f)),
    reel: {
      plan: share?.reelPlan ?? null,
      image: reelPicture ? toMediaDto(s.storage, reelPicture) : null,
      posterUrl: share?.rendered.reelPoster ? s.storage.url(share.rendered.reelPoster) : null,
      videoUrl: share?.rendered.reel ? s.storage.url(share.rendered.reel) : null,
      settings: reel.settings,
      model: reel.model,
      estimateUsd: reel.estimateUsd,
      error: job && REEL_JOB_KINDS.includes(job.kind) ? null : await reelError(s, articleId),
    },
    texts: share ? texts : {},
    version: share?.version ?? 0,
    updatedAt: (share?.updatedAt ?? article.publishedAt).toISOString(),
    posts: (await postsOf(s, [articleId])).get(articleId) ?? [],
    activeJob: job,
  };
}

// --- Rendering -------------------------------------------------------------------------
/** Renders the post and the story for the current text and stores them; old files are removed. */
export async function renderShare(s: Services, articleId: number): Promise<void> {
  const { article } = await loadArticle(s, articleId);
  const share = await loadShare(s, articleId);
  if (!share || !share.headline) return;
  const mediaId = share.imageMediaId ?? article.heroMediaId;
  const [media] = mediaId ? await s.db.select().from(mediaAssets).where(eq(mediaAssets.id, mediaId)).limit(1) : [];
  let photo: { data: Buffer; focalX: number; focalY: number } | null = null;
  if (media) {
    try {
      photo = { data: await s.storage.get(media.storageKey), focalX: media.focalX, focalY: media.focalY };
    } catch (e) {
      s.log.warn({ media: media.id, err: e instanceof Error ? e.message : e }, 'social design: photo missing, using the brand background');
    }
  }
  const now = new Date();
  const base = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}`;
  const tag = randomUUID().slice(0, 6);
  // Only the still designs the editor asked for; the reel keeps its own frame and video.
  const { feed: _f, story: _s, ...kept } = share.rendered;
  const rendered: Record<string, string> = { ...kept };
  const wanted = DESIGN_FORMATS.filter((f) => share.formats.includes(f));
  for (const format of wanted) {
    const jpg = await renderDesign({
      template: share.template as ShareTemplate,
      format,
      kicker: share.kicker,
      headline: share.headline,
      hook: share.hook,
      photo,
      site: siteHost(s.config.publicSiteUrl),
      time: jerusalemTime.format(article.publishedAt),
    });
    const key = `${base}/${format}-${tag}.jpg`;
    await s.storage.put(key, jpg, 'image/jpeg');
    rendered[format] = key;
  }
  // Only replace the files if nobody changed the text while we were drawing.
  const [row] = await s.db
    .update(articleShares)
    .set({ rendered })
    .where(and(eq(articleShares.articleId, articleId), eq(articleShares.version, share.version)))
    .returning({ articleId: articleShares.articleId });
  const drawn = wanted.map((f) => rendered[f]!);
  const previous = [share.rendered.feed, share.rendered.story].filter((k): k is string => Boolean(k));
  await s.storage.remove(row ? previous : drawn).catch(() => undefined);
}

// --- Editing ---------------------------------------------------------------------------
export async function updateShare(s: Services, staff: Staff, articleId: number, input: UpdateShareInput): Promise<ShareDto> {
  await loadArticle(s, articleId);
  if (input.imageMediaId) {
    const [m] = await s.db.select({ id: mediaAssets.id }).from(mediaAssets).where(eq(mediaAssets.id, input.imageMediaId)).limit(1);
    if (!m) throw errors.notFound('התמונה');
  }
  const values = {
    template: input.template,
    kicker: input.kicker,
    headline: input.headline,
    hook: input.hook,
    caption: input.caption,
    hashtags: [...new Set(input.hashtags)],
    ...(input.imageMediaId !== undefined ? { imageMediaId: input.imageMediaId } : {}),
    ...(input.formats ? { formats: [...new Set(input.formats)] } : {}),
    ...(input.reelSettings ? { reelSettings: input.reelSettings } : {}),
  };
  const existing = await loadShare(s, articleId);
  if (!existing) {
    if (input.version !== 0) throw new AppError(409, 'version_conflict', 'הנוסח עודכן בינתיים. רעננו.');
    await s.db.insert(articleShares).values({ articleId, ...values, createdBy: staff.id }).onConflictDoNothing();
  } else {
    const [row] = await s.db
      .update(articleShares)
      .set({ ...values, version: sql`${articleShares.version} + 1` })
      .where(and(eq(articleShares.articleId, articleId), eq(articleShares.version, input.version)))
      .returning({ version: articleShares.version });
    if (!row) throw new AppError(409, 'version_conflict', 'הנוסח עודכן בינתיים (אולי על ידי ה-AI). רעננו.');
  }
  await renderShare(s, articleId);
  return getShare(s, articleId);
}

/**
 * Queues the AI for each article (one text call per article, whatever the formats). formats records what the
 * editor wants; only the still designs are drawn afterwards. A reel is made only by its own request (it costs a video).
 */
export async function requestKits(s: Services, staff: Staff, articleIds: number[], instruction?: string, formats?: ShareFormat[]): Promise<string[]> {
  const found = await s.db
    .select({ id: articles.id })
    .from(articles)
    .where(and(inArray(articles.id, articleIds), eq(articles.status, 'published')));
  if (found.length !== new Set(articleIds).size) throw new AppError(422, 'not_published', 'חלק מהכתבות לא נמצאו או לא מפורסמות באתר.');
  const busy = await activeJobs(s, articleIds);
  const out: string[] = [];
  for (const id of new Set(articleIds)) {
    const running = busy.get(id);
    if (running) {
      out.push(running.id);
      continue;
    }
    out.push(await enqueue(s.db, KIT_JOB, { articleId: id, instruction: instruction ?? null, formats: formats ?? null }, { createdBy: staff.id, maxAttempts: 2 }));
  }
  return out;
}

export async function runKit(s: Services, job: JobRow) {
  const articleId = Number(job.payload.articleId);
  const instruction = job.payload.instruction ? String(job.payload.instruction) : undefined;
  const { article, category } = await loadArticle(s, articleId).catch(() => {
    throw new PermanentJobError('article not found or not published');
  });
  const current = await loadShare(s, articleId);
  // Articles written in the CMS carry the document; older and sample ones only the HTML.
  let fromDoc = '';
  try {
    fromDoc = docToText(sanitizeDoc(article.bodyDoc));
  } catch {
    // not a document
  }
  const body = fromDoc.trim() ? fromDoc : htmlToText(article.bodyHtml);
  const prompt = await writerPrompt(s.db, 'social.kit');
  const textAi = await s.ai.text();
  const { result } = await tracked(
    s.db,
    { type: 'social_caption', provider: textAi.provider, requestedBy: job.createdBy, promptKey: 'social.kit', promptVersion: prompt.version },
    () =>
      textAi.shareKit({
        systemPrompt: prompt.body,
        article: { title: article.title, subtitle: article.subtitle || article.excerpt, body, section: category },
        current: current?.headline ? { kicker: current.kicker, headline: current.headline, hook: current.hook, caption: current.caption, hashtags: current.hashtags } : undefined,
        instruction,
      }),
  );
  const kit = result.data;
  const formats = Array.isArray(job.payload.formats) ? (job.payload.formats as string[]).filter((f) => (SHARE_FORMATS as readonly string[]).includes(f)) : null;
  const values = { ...(formats?.length ? { formats } : {}), ...kitTexts(kit) };
  if (!current) {
    await s.db
      .insert(articleShares)
      .values({ articleId, template: kit.template, ...values, aiBaseline: { ...values, template: kit.template }, createdBy: job.createdBy })
      .onConflictDoUpdate({ target: articleShares.articleId, set: { ...values, version: sql`${articleShares.version} + 1` } });
  } else {
    // The editor's choice of frame stays; the AI rewrites the text.
    await s.db
      .update(articleShares)
      .set({ ...values, ...(current.headline ? {} : { template: kit.template }), aiBaseline: current.aiBaseline ?? { ...values, template: kit.template }, version: sql`${articleShares.version} + 1` })
      .where(eq(articleShares.articleId, articleId));
  }
  await renderShare(s, articleId);
  return { ok: true };
}

// --- Publishing ------------------------------------------------------------------------
export async function startSharePublish(s: Services, staff: Staff, input: PublishSharesInput): Promise<string> {
  const articleIds = [...new Set(input.articleIds)];
  const shares = await s.db.select().from(articleShares).where(inArray(articleShares.articleId, articleIds));
  const missing = articleIds.filter((id) => !shares.find((x) => x.articleId === id && x.headline.trim()));
  if (missing.length) throw new AppError(422, 'no_kit', `ל-${missing.length} מהכתבות עוד אין פוסט. הכינו אותן עם ה-AI או כתבו כותרת, ואז פרסמו.`);
  const published = await s.db
    .select({ id: articles.id })
    .from(articles)
    .where(and(inArray(articles.id, articleIds), eq(articles.status, 'published')));
  if (published.length !== articleIds.length) throw new AppError(422, 'not_published', 'חלק מהכתבות כבר לא מפורסמות באתר.');
  const accounts = await s.db
    .select()
    .from(socialAccounts)
    .where(and(inArray(socialAccounts.id, input.accountIds), eq(socialAccounts.isActive, true)));
  if (accounts.length !== new Set(input.accountIds).size) throw new AppError(422, 'bad_account', 'אחד החשבונות לא קיים או מושבת.');

  const formats = [...new Set(input.formats)];
  if (formats.includes('reel')) {
    // Only a reel whose video the editor approved goes out.
    const notReady = shares.filter((x) => !x.rendered.reel || x.reelPlan?.stage !== 'approved').length;
    if (notReady) throw new AppError(422, 'no_reel', `ל-${notReady} מהכתבות אין עדיין סרטון ריל מאושר. אשרו את הסרטון בריל של הכתבה, או הסירו את "ריל" מהפרסום.`);
  }
  for (const articleId of articleIds) {
    for (const account of accounts) {
      for (const format of formats) {
        await s.db
          .insert(articleSharePosts)
          .values({ articleId, socialAccountId: account.id, format, status: 'queued', requestedBy: staff.id })
          .onConflictDoUpdate({
            target: [articleSharePosts.articleId, articleSharePosts.socialAccountId, articleSharePosts.format],
            set: { status: sql`case when ${articleSharePosts.status} = 'posted' then ${articleSharePosts.status} else 'queued'::social_post_status end`, lastError: null, requestedBy: staff.id },
          });
      }
    }
  }
  return enqueue(s.db, SHARE_PUBLISH_JOB, { articleIds, accountIds: accounts.map((a) => a.id), formats }, { createdBy: staff.id, maxAttempts: 2 });
}

export async function runSharePublish(s: Services, job: JobRow) {
  const articleIds = (job.payload.articleIds as number[]) ?? [];
  const accountIds = (job.payload.accountIds as string[]) ?? [];
  const formats = (job.payload.formats as ShareFormat[]) ?? [];
  const accounts = accountIds.length ? await s.db.select().from(socialAccounts).where(inArray(socialAccounts.id, accountIds)) : [];
  const results = { posted: 0, prepared: 0, failed: 0 };
  for (const articleId of articleIds) {
    let share = await loadShare(s, articleId);
    if (!share) continue;
    // A still design that is published but wasn't drawn yet is drawn now (and recorded as wanted).
    const designs = DESIGN_FORMATS.filter((f) => formats.includes(f));
    if (designs.some((f) => !share!.rendered[f])) {
      await s.db
        .update(articleShares)
        .set({ formats: [...new Set([...share.formats, ...designs])] })
        .where(eq(articleShares.articleId, articleId));
      await renderShare(s, articleId);
      share = (await loadShare(s, articleId))!;
    }
    const targets = await s.db
      .select()
      .from(articleSharePosts)
      .where(and(eq(articleSharePosts.articleId, articleId), inArray(articleSharePosts.socialAccountId, accountIds), inArray(articleSharePosts.format, formats)));
    for (const post of targets) {
      if (post.status === 'posted') continue;
      const account = accounts.find((a) => a.id === post.socialAccountId);
      if (!account) continue;
      const payload: SocialPayload = {
        headline: share.headline,
        caption: shareBody(share, account.linkInFirstComment),
        articleUrl: articleLink(s.config.publicSiteUrl, articleId, account.platform),
        storyImageUrl: share.rendered.story ? s.storage.url(share.rendered.story) : '',
        squareImageUrl: share.rendered.feed ? s.storage.url(share.rendered.feed) : '',
        videoUrl: share.rendered.reel ? s.storage.url(share.rendered.reel) : undefined,
        coverUrl: share.rendered.reelPoster ? s.storage.url(share.rendered.reelPoster) : undefined,
        linkInFirstComment: account.linkInFirstComment,
      };
      await s.db.update(articleSharePosts).set({ status: 'posting' }).where(eq(articleSharePosts.id, post.id));
      try {
        const format = post.format === 'message' ? 'feed' : post.format;
        const result = await publishToNetwork(s.config, account, await s.settings.socialToken(account), payload, format);
        await s.db
          .update(articleSharePosts)
          .set(
            result.status === 'posted'
              ? { status: 'posted', externalPostId: result.postId, externalCommentId: result.commentId, postedAt: new Date(), attempts: sql`${articleSharePosts.attempts} + 1`, lastError: null }
              : { status: 'skipped', lastError: result.reason },
          )
          .where(eq(articleSharePosts.id, post.id));
        results[result.status === 'posted' ? 'posted' : 'prepared'] += 1;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        await s.db
          .update(articleSharePosts)
          .set({ status: 'failed', lastError: message.slice(0, 500), attempts: sql`${articleSharePosts.attempts} + 1` })
          .where(eq(articleSharePosts.id, post.id));
        results.failed += 1;
      }
    }
  }
  return results;
}

/** What an account takes without a person choosing it: what its network posts automatically, or, without a token, what can be prepared to post by hand. */
function automaticFormats(target: ShareTargetDto): ShareFormat[] {
  if (target.connected) return target.autoFormats;
  return target.platform === 'facebook' || target.platform === 'instagram' ? ['feed', 'story', 'reel'] : ['feed'];
}

/**
 * Sends an article's posts to every active account that takes them, as a distribution plan
 * asks (no person picks the accounts). Returns how many posts were queued.
 */
export async function queueAutoPosts(s: Services, staffId: string, articleId: number, formats: ShareFormat[]): Promise<number> {
  const targets = await listTargets(s);
  const rows = targets.flatMap((t) => formats.filter((f) => automaticFormats(t).includes(f)).map((format) => ({ articleId, socialAccountId: t.id, format, status: 'queued' as const, requestedBy: staffId })));
  if (!rows.length) return 0;
  // A post that already exists (sent, or prepared) is left as it is.
  await s.db.insert(articleSharePosts).values(rows).onConflictDoNothing();
  await enqueue(s.db, SHARE_PUBLISH_JOB, { articleIds: [articleId], accountIds: [...new Set(rows.map((r) => r.socialAccountId))], formats }, { createdBy: staffId, maxAttempts: 2 });
  return rows.length;
}

/** The editor posted a prepared post by hand: it now counts as posted. */
export async function markPostedManually(s: Services, articleId: number, accountId: string, format: ShareFormat) {
  const [row] = await s.db
    .update(articleSharePosts)
    .set({ status: 'posted', postedAt: new Date(), lastError: 'פורסם ידנית' })
    .where(
      and(
        eq(articleSharePosts.articleId, articleId),
        eq(articleSharePosts.socialAccountId, accountId),
        eq(articleSharePosts.format, format),
        inArray(articleSharePosts.status, ['skipped', 'failed']),
      ),
    )
    .returning({ id: articleSharePosts.id });
  if (!row) throw errors.notFound('הפוסט המוכן');
}

/** A publishing job that failed for good: nothing stays "queued" forever. */
export async function markSharePublishFailed(s: Services, job: JobRow, error: Error) {
  const articleIds = (job.payload.articleIds as number[]) ?? [];
  if (!articleIds.length) return;
  await s.db
    .update(articleSharePosts)
    .set({ status: 'failed', lastError: error.message.slice(0, 500) })
    .where(and(inArray(articleSharePosts.articleId, articleIds), inArray(articleSharePosts.status, ['queued', 'posting'])));
}
