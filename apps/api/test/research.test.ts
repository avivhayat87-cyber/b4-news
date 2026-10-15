// The research reporter: a link or screenshots become a research file, the article is written from
// it alone and ends with the sources (names only), details without an official source are marked
// down, every source is kept as proof, and a month's research stops at its budget.
import { articleDrafts, articles, eq, researchTasks } from '@b4/db';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ingestImage } from '../src/lib/images';
import { fixedAi } from '../src/services/ai';
import { FakeText, PlaceholderImages } from '../src/services/ai/fake';
import type { ResearchOutput, ResearchWriteRequest } from '../src/services/ai/types';
import { checkDossier } from '../src/services/research';
import type { Fetcher } from '../src/services/scraper/collect';
import { setup, signInStaff, staffClient } from './helpers';

const GOV = 'https://www.gov.il/he/pages/fuel-price-october';
const PAGE = `<html><head><title>מחיר הדלק יעלה בחודש הבא</title></head><body><article><h1>מחיר הדלק יעלה בחודש הבא</h1>
<p>משרד האנרגיה הודיע היום כי מחיר ליטר בנזין 95 יעלה ב-12 אגורות בתחילת החודש הבא, ויגיע ל-7.42 שקלים לליטר בשירות עצמי.</p>
<p>לפי ההודעה, העלייה נובעת מעליית מחירי הנפט בעולם ומשינוי בשער הדולר בחודש האחרון. המחיר המרבי נקבע על פי נוסחה קבועה.</p>
<p>המחיר הבא ייקבע בתחילת החודש שאחריו, לפי אותה נוסחה. בתחנות עם שירות מלא יתווסף למחיר תשלום נפרד, כפי שנקבע בצו הפיקוח על המחירים.</p></article></body></html>`;

const GOV2 = 'https://www.gov.il/he/pages/fuel-price-correction';
const PAGE2 = `<html><head><title>תיקון: מחיר הדלק יעלה ב-15 אגורות</title></head><body><article><h1>תיקון: מחיר הדלק יעלה ב-15 אגורות</h1>
<p>משרד האנרגיה עדכן הערב כי מחיר ליטר בנזין 95 יעלה בתחילת החודש הבא ב-15 אגורות, ולא ב-12 אגורות כפי שפורסם בבוקר.</p>
<p>לפי העדכון, המחיר המרבי בשירות עצמי יגיע ל-7.45 שקלים לליטר, בגלל עלייה נוספת בשער הדולר.</p>
<p>המשרד הוסיף כי התיקון נובע מנתון שהתקבל אחרי פרסום ההודעה הראשונה, וכי הנוסחה עצמה לא השתנתה.</p></article></body></html>`;

/** The pages the research reads, answered in-process (no network in tests). */
const fetchPages: Fetcher = async (url) => {
  if (url.startsWith(GOV2)) return { url, status: 200, contentType: 'text/html; charset=utf-8', body: Buffer.from(PAGE2) };
  if (url.startsWith(GOV)) return { url, status: 200, contentType: 'text/html; charset=utf-8', body: Buffer.from(PAGE) };
  throw new Error(`unexpected fetch in test: ${url}`);
};

const output = (over: Partial<ResearchOutput> = {}): ResearchOutput => ({
  original: { who: 'ערוץ טלגרם', when: 'היום', what: 'מחיר הדלק יעלה', url: '' },
  summary: 'מחיר הדלק יעלה.',
  claims: [],
  background: [],
  open_questions: [],
  response_needed: [],
  sources: [],
  ...over,
});

describe('the research reporter', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  let editor: ReturnType<typeof staffClient>;
  let admin: ReturnType<typeof staffClient>;

  beforeAll(async () => {
    ctx = await setup({ fetch: fetchPages });
    editor = staffClient(ctx, await signInStaff(ctx, 'editor'));
    admin = staffClient(ctx, await signInStaff(ctx, 'admin'));
  });
  afterAll(() => ctx.close());

  it('researches a link into a file, writes the article from it alone, and ends it with the sources by name', async () => {
    const started = await editor.post('/research', { kind: 'link', url: GOV, note: 'שמעתי שזה יעלה ב-20 אגורות' });
    expect(started.status).toBe(202);
    expect(started.body).toMatchObject({ status: 'queued', depth: 'quick', kind: 'link' });
    await ctx.drain();

    const task = (await editor.get(`/research/${started.body.id}`)).body;
    expect(task.status).toBe('done');
    const d = task.dossier;
    expect(d.sources[0]).toMatchObject({ url: GOV, kind: 'official', approved: true });
    expect(d.claims[0]).toMatchObject({ label: 'verified', sourceIds: ['s1'] });
    // The editor's note is a lead, not a fact: it stays in the file, unverified, and out of the article.
    expect(d.claims.at(-1)).toMatchObject({ text: 'שמעתי שזה יעלה ב-20 אגורות', label: 'unverified' });
    // A gov.il page: the registry's government portal, by name.
    expect(d.creditLine).toBe('מקורות: ממשלת ישראל');

    const [draft] = await ctx.db.select().from(articleDrafts).where(eq(articleDrafts.id, task.draftId));
    expect(draft).toMatchObject({ origin: 'research', status: 'editing', colorLabel: 'purple' });
    expect(draft!.bodyText).toContain('משרד האנרגיה הודיע היום');
    expect(draft!.bodyText).not.toContain('20 אגורות');
    expect(draft!.bodyText.trim().endsWith('מקורות: ממשלת ישראל')).toBe(true);
    expect(draft!.bodyText).not.toContain('https://');

    // The proof: a copy of the page's text (no browser here, so no screenshot, and it says so).
    expect(d.sources[0].archive).toMatchObject({ status: 'saved', hasText: true, screenshotUrl: null, error: 'אין במחשב הזה דפדפן לצילום עמודים.' });
    const copy = await editor.get(`/research/${task.id}/sources/s1/text`);
    expect(copy.body.text).toContain('7.42 שקלים');

    // The editor finds the file from the draft, and the free check finds the story by its link.
    expect((await editor.get(`/drafts/${task.draftId}/research`)).body.id).toBe(task.id);
    const similar = await editor.post('/research/similar', { url: GOV });
    expect(similar.body).toEqual([expect.objectContaining({ kind: 'draft', id: task.draftId, href: `/drafts/${task.draftId}` })]);
    const list = (await editor.get('/research')).body;
    expect(list.tasks[0]).toMatchObject({ id: task.id, dossier: null, title: draft!.title, official: true });
  });

  it('researches screenshots, with the editor note as the only lead', async () => {
    const png = await sharp({ create: { width: 600, height: 900, channels: 3, background: '#ffffff' } }).png().toBuffer();
    const shot = await ingestImage(ctx.db, ctx.storage, png, { kind: 'upload' });
    const started = await editor.post('/research', { kind: 'screenshot', mediaIds: [shot.id], note: 'פוסט שרץ בטלגרם על קיצוץ בקצבאות' });
    expect(started.status).toBe(202);
    expect(started.body.screenshots).toHaveLength(1);
    await ctx.drain();
    const task = (await editor.get(`/research/${started.body.id}`)).body;
    const [row] = await ctx.db.select().from(researchTasks).where(eq(researchTasks.id, task.id));
    expect(row!.lastError).toBeNull();
    // Nothing official behind it: the CMS warns that the article rests on reports alone.
    expect(task).toMatchObject({ status: 'done', kind: 'screenshot', official: false });
    expect(task.dossier.claims).toEqual([expect.objectContaining({ label: 'unverified' })]);
    expect(task.dossier.creditLine).toBe('');
    expect(task.draftId).toBeTruthy();
  });

  it('updates an article we already have, and changes it only when the editor puts the update in', async () => {
    const [first] = (await editor.get('/research')).body.tasks.filter((t: { url: string | null; draftId: string | null }) => t.url === GOV && t.draftId);
    const draftsBefore = (await ctx.db.select().from(articleDrafts)).length;
    const started = await editor.post('/research', { kind: 'link', url: GOV2, targetDraftId: first.draftId });
    expect(started.status).toBe(202);
    await ctx.drain();
    const task = (await editor.get(`/research/${started.body.id}`)).body;
    // No new article: the update waits in the file of the one we have.
    expect(task).toMatchObject({ status: 'done', draftId: first.draftId, target: { draftId: first.draftId }, update: { state: 'ready' } });
    expect(task.update.paragraphs.join(' ')).toContain('15 אגורות');
    expect(await ctx.db.select().from(articleDrafts)).toHaveLength(draftsBefore);
    const [untouched] = await ctx.db.select().from(articleDrafts).where(eq(articleDrafts.id, first.draftId));
    expect(untouched!.bodyText).not.toContain('15 אגורות');

    const applied = await editor.post(`/research/${task.id}/apply-update`);
    expect(applied.body.update.state).toBe('applied');
    const [draft] = await ctx.db.select().from(articleDrafts).where(eq(articleDrafts.id, first.draftId));
    expect(draft!.bodyText).toMatch(/^(## )?עדכון \(\d+\.\d+\)/);
    expect(draft!.bodyText).toContain('15 אגורות');
    // One sources line at the end, with the update's sources merged in.
    expect(draft!.bodyText.match(/מקורות:/g)).toHaveLength(1);
    expect(draft!.bodyText.trim().endsWith('מקורות: ממשלת ישראל')).toBe(true);
    expect((await editor.post(`/research/${task.id}/apply-update`)).status).toBe(409);
  });

  it('opens a published article for an update without changing the site', async () => {
    const [article] = await ctx.db.select().from(articles).limit(1);
    const started = await editor.post('/research', { kind: 'link', url: `${GOV2}?a=1`, targetArticleId: article!.id });
    await ctx.drain();
    const task = (await editor.get(`/research/${started.body.id}`)).body;
    expect(task.target.draftId).toBeTruthy();
    expect((await editor.post(`/research/${task.id}/dismiss-update`)).body.update.state).toBe('dismissed');
    const [same] = await ctx.db.select().from(articles).where(eq(articles.id, article!.id));
    expect(same!.bodyHtml).toBe(article!.bodyHtml);
  });

  it('needs a link, at least one screenshot, or an idea of a sentence', async () => {
    expect((await editor.post('/research', { kind: 'screenshot', mediaIds: [] })).status).toBe(400);
    expect((await editor.post('/research', { kind: 'link' })).status).toBe(400);
    expect((await editor.post('/research', { kind: 'idea', note: 'דירות' })).status).toBe(400);
  });

  it('researches the newsroom\'s own idea, after a free check for what we already have', async () => {
    const idea = 'מחיר הדלק יעלה בחודש הבא: כמה זה יעלה למשפחה ממוצעת בשנה?';
    // The free check by the idea's words finds the draft about the fuel price from the first research.
    const similar = await editor.post('/research/similar', { text: idea });
    expect(similar.status).toBe(200);
    expect(similar.body.map((x: { kind: string }) => x.kind)).toContain('draft');

    const started = await editor.post('/research', { kind: 'idea', note: idea });
    expect(started.status).toBe(202);
    expect(started.body).toMatchObject({ kind: 'idea', url: null, screenshots: [], note: idea });
    await ctx.drain();
    const task = (await editor.get(`/research/${started.body.id}`)).body;
    expect(task).toMatchObject({ status: 'done', kind: 'idea' });
    expect(task.draftId).toBeTruthy();
  });

  it('marks down a detail whose label needs an official source it does not have', () => {
    const d = checkDossier(
      output({
        claims: [
          { text: 'הבנק הודיע על העלאת ריבית', label: 'verified', source_urls: ['https://www.ynet.co.il/economy/article/abc'], note: '' },
          { text: 'המנכ"ל נחשד בהונאה', label: 'suspicion', source_urls: ['https://x.com/someone/status/1'], note: '' },
          { text: 'הריבית עלתה ל-4.5%', label: 'verified', source_urls: ['https://www.boi.org.il/press/1'], note: '' },
          { text: 'השר אמר שהמחירים ירדו', label: 'claimed', source_urls: [], note: '' },
          { text: 'החברה הודיעה על דיבידנד', label: 'verified', source_urls: ['https://x.com/company_official/status/9'], note: '' },
          // A bank's own rate page behind a mere report: kept in the file, not named at the end.
          { text: 'שער הדולר לפי אתר הבנק', label: 'reported', source_urls: ['https://www.bank.example/fx'], note: '' },
        ],
        sources: [
          { url: 'https://www.ynet.co.il/economy/article/abc', title: 'כתבה', publisher: 'ynet', kind: 'company', used_for: 'fact' },
          { url: 'https://he.wikipedia.org/wiki/בנק_ישראל', title: 'בנק ישראל', publisher: 'ויקיפדיה', kind: 'wiki', used_for: 'background' },
          { url: 'https://www.bank.example/fx', title: 'שערי מט"ח', publisher: 'הבנק', kind: 'company', used_for: 'fact' },
        ],
      }),
      null,
      ['x.com/company_official'],
    );
    expect(d.claims.map((c) => c.label)).toEqual(['reported', 'unverified', 'verified', 'unverified', 'verified', 'reported']);
    expect(d.claims[1]!.note).toContain('חשד בלי מקור רשמי');
    // A news site is a news site whatever the reporter called it, and never named in the sources line.
    expect(d.sources.find((x) => x.url.includes('ynet'))).toMatchObject({ kind: 'news', approved: false });
    // An address a detail named but the list missed is added (and judged) all the same.
    expect(d.sources.find((x) => x.url.includes('boi.org.il'))).toMatchObject({ kind: 'official', approved: true });
    expect(d.creditLine).toBe('מקורות: ויקיפדיה, boi.org.il, רשתות חברתיות');
  });

  it('keeps the file when the writing fails, and writes again without researching again', async () => {
    let failWrite = true;
    let researched = 0;
    class Flaky extends FakeText {
      override async research(req: Parameters<FakeText['research']>[0]) {
        researched++;
        return super.research(req);
      }
      override async researchWrite(req: ResearchWriteRequest) {
        if (failWrite) throw new Error('overloaded');
        return super.researchWrite(req);
      }
    }
    const saved = ctx.app.services.ai;
    ctx.app.services.ai = fixedAi(new Flaky(), new PlaceholderImages());
    try {
      const started = await editor.post('/research', { kind: 'link', url: `${GOV}?again=1` });
      await ctx.drain();
      const failed = (await editor.get(`/research/${started.body.id}`)).body;
      expect(failed).toMatchObject({ status: 'failed', error: 'התחקיר נכשל. אפשר לנסות שוב.', draftId: null });
      expect(failed.dossier.claims.length).toBeGreaterThan(0);

      failWrite = false;
      expect((await editor.post(`/research/${started.body.id}/retry`)).status).toBe(202);
      await ctx.drain();
      expect((await editor.get(`/research/${started.body.id}`)).body.status).toBe('done');
      expect(researched).toBe(1);
    } finally {
      ctx.app.services.ai = saved;
    }
  });

  it('stops when the month\'s budget is spent, and only an admin changes the budget', async () => {
    const current = (await editor.get('/agent/researcher-settings')).body;
    expect((await editor.put('/agent/researcher-settings', { ...current, monthlyBudgetUsd: 0 })).status).toBe(403);
    expect((await admin.put('/agent/researcher-settings', { ...current, monthlyBudgetUsd: 0 })).status).toBe(200);
    const refused = await editor.post('/research', { kind: 'link', url: GOV });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('research_budget');
    await admin.put('/agent/researcher-settings', current);
  });

  it('counts the research on the reporter in the agent team', async () => {
    const team = (await admin.get('/agents')).body;
    const reporter = team.agents.find((a: { id: string }) => a.id === 'reporter');
    expect(reporter.skills.map((x: { key: string }) => x.key)).toEqual(['research.system', 'research.write', 'research.update', 'research.accounts']);
    const usage = (await admin.get('/agents/usage')).body;
    expect(usage.agents.find((a: { id: string }) => a.id === 'reporter').usage.calls).toBeGreaterThan(0);
  });
});
