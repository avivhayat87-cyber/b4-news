// The legal review: every article is checked when its text is marked final; a risk stops it from
// being published and the admins are emailed; a person decides (approve with a reason, a safer
// wording the editor approves, wait for a response, or don't publish); a decision on the same
// passage carries over; a check that didn't finish can be waived; only an admin turns it off.
import { articleDrafts, auditLog, draftRevisions, eq, jobs } from '@b4/db';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixedAi } from '../src/services/ai';
import { FakeText, PlaceholderImages } from '../src/services/ai/fake';
import type { ReviewRequest } from '../src/services/ai/types';
import { ORIGIN, setup, signInStaff, staffClient } from './helpers';

let ctx: Awaited<ReturnType<typeof setup>>;
let admin: ReturnType<typeof staffClient>;
let editor: ReturnType<typeof staffClient>;
let viewer: ReturnType<typeof staffClient>;
let heroId: string;

const SAFE = 'בנק ישראל פרסם היום את נתוני האינפלציה לחודש האחרון, והם היו נמוכים מהצפוי. ';
const SUSPECT = 'החשוד, יוסי כהן, נחשד בגניבה מהקופה של החנות.';
const RUMOR = 'לפי שמועות, חברת אלפא תימכר בקרוב למשקיע זר.';

async function upload(): Promise<string> {
  const png = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#3366aa' } }).png().toBuffer();
  const boundary = '----b4review';
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/admin/media',
    headers: { cookie: await signInStaff(ctx, 'editor'), origin: ORIGIN, 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`),
      png,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  });
  return JSON.parse(res.body).id;
}

/** A finished article with these risky sentences; checked when its text is marked final. */
async function finalArticle(title: string, ...risky: string[]): Promise<string> {
  const body = [SAFE.repeat(3), ...risky].join('\n\n');
  const created = await editor.post('/manual/write', { title, body, category: 'israeli-economy', heroMediaId: heroId });
  expect((await editor.post(`/drafts/${created.body.draftId}/finalize`)).status).toBe(204);
  return created.body.draftId;
}

const review = async (id: string) => (await editor.get(`/drafts/${id}/review`)).body;
const publish = (id: string) => editor.post(`/drafts/${id}/publish`, { idempotencyKey: `review-${id}-${Math.random()}` });

beforeAll(async () => {
  ctx = await setup();
  admin = staffClient(ctx, await signInStaff(ctx, 'admin'));
  editor = staffClient(ctx, await signInStaff(ctx, 'editor'));
  viewer = staffClient(ctx, await signInStaff(ctx, 'viewer'));
  heroId = await upload();
});
afterAll(() => ctx.close());

describe('legal review', () => {
  let draftId: string;

  it('checks the article when its text is final, stops it, and emails the admins', async () => {
    draftId = await finalArticle('כתבה עם סיכונים', SUSPECT, RUMOR);
    expect((await review(draftId)).state).toBe('checking');
    expect((await publish(draftId)).status).toBe(422); // not while it is being checked
    await ctx.drain();

    const r = await review(draftId);
    expect(r).toMatchObject({ state: 'flagged', openCount: 2 });
    expect(r.issues.map((i: { flag: string }) => i.flag).sort()).toEqual(['market_rumor', 'private_suspect']);
    expect(r.issues.find((i: { flag: string }) => i.flag === 'private_suspect')).toMatchObject({ where: 'body', quote: SUSPECT, open: true });

    const mail = ctx.mailer.lastTo('admin@newsroom.test')!;
    expect(mail.subject).toContain('נעצרה');
    expect(mail.text).toContain(`http://localhost:3001/drafts/${draftId}`);
    expect(mail.text).toContain('חשד נגד אדם פרטי בשמו');

    expect((await editor.get('/dashboard')).body.review.waiting).toBe(1);
    expect((await editor.get('/reviews')).body.map((x: { draftId: string }) => x.draftId)).toEqual([draftId]);
    const preview = (await editor.get(`/drafts/${draftId}/preview`)).body;
    expect(preview.items[0].problems).toContain('נעצרה בבדיקה המשפטית: 2 סוגיות מחכות להחלטה');
    const refused = await publish(draftId);
    expect(refused.status).toBe(422);
    expect(refused.body.message).toContain('נעצרה בבדיקה המשפטית');
  });

  it('publishes with extra caution only after the editor approves the safer wording', async () => {
    const suspect = (await review(draftId)).issues.find((i: { flag: string }) => i.flag === 'private_suspect');
    expect((await editor.post(`/drafts/${draftId}/review/issues/${suspect.id}/decide`, { action: 'caution' })).status).toBe(409); // no wording yet
    expect((await viewer.post(`/drafts/${draftId}/review/issues/${suspect.id}/fix`)).status).toBe(403);
    expect((await editor.post(`/drafts/${draftId}/review/issues/${suspect.id}/fix`)).status).toBe(202);
    await ctx.drain();
    const fixed = (await review(draftId)).issues.find((i: { id: string }) => i.id === suspect.id);
    expect(fixed.fix).toMatchObject({ status: 'ready', after: `לכאורה, ${SUSPECT}` });
    // Nothing changed in the article until the editor approves it.
    const [before] = await ctx.db.select({ body: articleDrafts.bodyText }).from(articleDrafts).where(eq(articleDrafts.id, draftId));
    expect(before!.body).not.toContain('לכאורה');

    const decided = await editor.post(`/drafts/${draftId}/review/issues/${suspect.id}/decide`, { action: 'caution' });
    expect(decided.status).toBe(200);
    expect(decided.body.openCount).toBe(1);
    const [after] = await ctx.db.select({ body: articleDrafts.bodyText, status: articleDrafts.status }).from(articleDrafts).where(eq(articleDrafts.id, draftId));
    expect(after).toMatchObject({ status: 'text_final' });
    expect(after!.body).toContain(`לכאורה, ${SUSPECT}`);
    const revisions = await ctx.db.select({ source: draftRevisions.source }).from(draftRevisions).where(eq(draftRevisions.draftId, draftId));
    expect(revisions.at(-1)!.source).toBe('human_checkpoint');
  });

  it('waits for a response, notes that none came, and then lets it be published', async () => {
    const rumor = (await review(draftId)).issues.find((i: { flag: string }) => i.flag === 'market_rumor');
    expect((await editor.post(`/drafts/${draftId}/review/issues/${rumor.id}/decide`, { action: 'approve' })).status).toBe(422); // a reason is required
    const waiting = await editor.post(`/drafts/${draftId}/review/issues/${rumor.id}/decide`, { action: 'awaiting_response' });
    expect(waiting.body).toMatchObject({ state: 'flagged', openCount: 1 });
    expect((await publish(draftId)).status).toBe(422);

    const done = await editor.post(`/drafts/${draftId}/review/issues/${rumor.id}/decide`, { action: 'no_response' });
    expect(done.body).toMatchObject({ state: 'resolved', openCount: 0 });
    const [row] = await ctx.db.select({ body: articleDrafts.bodyText }).from(articleDrafts).where(eq(articleDrafts.id, draftId));
    expect(row!.body.trim().endsWith('פנינו לקבלת תגובה, וזו לא התקבלה עד מועד הפרסום.')).toBe(true);
    const actions = await ctx.db.select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.entity, 'draft_review'));
    expect(actions.map((a) => a.action)).toEqual(['caution', 'awaiting_response', 'no_response']);

    expect((await editor.get('/dashboard')).body.review.waiting).toBe(0);
    expect((await publish(draftId)).status).toBe(202);
    await ctx.drain();
    const [published] = await ctx.db.select({ status: articleDrafts.status }).from(articleDrafts).where(eq(articleDrafts.id, draftId));
    expect(published!.status).toBe('published');
  });

  it('keeps a decision when the same passage is found again, and "don\'t publish" keeps it off the site', async () => {
    const id = await finalArticle('כתבה שנפתחת שוב', SUSPECT);
    await ctx.drain();
    const issue = (await review(id)).issues[0];
    await editor.post(`/drafts/${id}/review/issues/${issue.id}/decide`, { action: 'approve', reason: 'החשוד הוא איש ציבור והשם פורסם רשמית' });
    await editor.post(`/drafts/${id}/reopen`);
    await editor.post(`/drafts/${id}/finalize`);
    await ctx.drain();
    const again = await review(id);
    expect(again).toMatchObject({ state: 'resolved', openCount: 0 });
    expect(again.issues[0].decision).toMatchObject({ action: 'approve', by: 'Test editor' });

    const other = await finalArticle('כתבה שלא תתפרסם', RUMOR);
    await ctx.drain();
    const risk = (await review(other)).issues[0];
    await editor.post(`/drafts/${other}/review/issues/${risk.id}/decide`, { action: 'reject', reason: 'אין מקור' });
    const [row] = await ctx.db.select({ status: articleDrafts.status, reason: articleDrafts.skipReason }).from(articleDrafts).where(eq(articleDrafts.id, other));
    expect(row).toMatchObject({ status: 'skipped', reason: 'אין מקור' });
  });

  it('lets a person publish without a check that did not finish, with a reason', async () => {
    class Down extends FakeText {
      override async review(_req: ReviewRequest): Promise<never> {
        throw new Error('the AI is down');
      }
    }
    const saved = ctx.app.services.ai;
    ctx.app.services.ai = fixedAi(new Down(), new PlaceholderImages());
    const id = await finalArticle('כתבה בלי בדיקה');
    await ctx.drain();
    ctx.app.services.ai = saved;
    expect(await review(id)).toMatchObject({ state: 'failed', error: 'ה-AI לא הצליח לבדוק את הכתבה. אפשר לבדוק שוב.' });
    expect((await publish(id)).status).toBe(422);
    expect((await editor.post(`/drafts/${id}/review/waive`, { reason: '' })).status).toBe(400);
    const waived = await editor.post(`/drafts/${id}/review/waive`, { reason: 'בדקתי בעצמי' });
    expect(waived.body).toMatchObject({ state: 'waived', waived: { by: 'Test editor', reason: 'בדקתי בעצמי' } });
    expect((await publish(id)).status).toBe(202);
  });

  it('can be turned off only by an admin, and then nothing is checked', async () => {
    const settings = (await editor.get('/agent/reviewer-settings')).body;
    expect(settings).toEqual({ enabled: true, emailAdmins: true });
    expect((await editor.put('/agent/reviewer-settings', { ...settings, enabled: false })).status).toBe(403);
    expect((await admin.put('/agent/reviewer-settings', { ...settings, enabled: false })).status).toBe(200);
    const before = (await ctx.db.select().from(jobs).where(eq(jobs.kind, 'review.check'))).length;
    const id = await finalArticle('כתבה כשהבדיקה כבויה', SUSPECT);
    expect((await ctx.db.select().from(jobs).where(eq(jobs.kind, 'review.check'))).length).toBe(before);
    expect((await review(id)).state).toBeNull();
    // The team shows the reviewer and its two skills, in Hebrew.
    const team = (await editor.get('/agents')).body;
    expect(team.agents.find((a: { id: string }) => a.id === 'reviewer').skills.map((x: { key: string }) => x.key)).toEqual(['review.system', 'review.fix']);
  });
});
