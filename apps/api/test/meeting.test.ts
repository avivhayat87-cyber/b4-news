// The editorial meeting: discovery's articles grouped into topics for free, story pitches from one
// AI call, and research only for the pitches a person approves.
import { auditLog, eq, researchTasks, scrapedItems } from '@b4/db';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixedAi } from '../src/services/ai';
import { FakeText, PlaceholderImages } from '../src/services/ai/fake';
import type { MeetingOutput, MeetingRequest } from '../src/services/ai/types';
import { MeetingSettings } from '@b4/shared';
import { groupTopics, holdMorningMeeting, isMorningDue } from '../src/services/editorial-meeting';
import { setup, signInStaff, staffClient } from './helpers';

const DISCOVERED = [
  ['https://www.globes.co.il/news/a1', 'בנק ישראל הותיר את הריבית ללא שינוי ברמה של 4.5%'],
  ['https://www.calcalist.co.il/news/a2', 'הריבית ללא שינוי: בנק ישראל הותיר את הריבית על 4.5%'],
  ['https://www.themarker.com/news/a3', 'בנק ישראל הותיר את הריבית ללא שינוי, והנגיד מזהיר'],
  ['https://www.ynet.co.il/economy/a4', 'מחירי הדירות עלו ב-0.8% בחודש האחרון'],
  ['https://www.bizportal.co.il/a5', 'מחירי הדירות עלו שוב: עלייה של 0.8% בחודש'],
  ['https://www.maariv.co.il/a6', 'רשת הסופרמרקטים תפתח עשרה סניפים חדשים בצפון'],
] as const;

describe('editorial meeting', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  let editor: ReturnType<typeof staffClient>;

  beforeAll(async () => {
    ctx = await setup();
    editor = staffClient(ctx, await signInStaff(ctx, 'editor'));
  });
  afterAll(() => ctx.close());

  const discover = async (rows: readonly (readonly [string, string])[]) => {
    for (const [url, title] of rows) {
      await ctx.db
        .insert(scrapedItems)
        .values({ url, urlHash: createHash('sha256').update(url).digest('hex'), title, status: 'new', publishedAt: new Date(Date.now() - 3600_000) })
        .onConflictDoNothing();
    }
  };

  it('groups headlines about the same thing, the topics covered by more sites first', () => {
    const at = new Date();
    const topics = groupTopics(DISCOVERED.map(([url, title], i) => ({ id: `i${i}`, title, url, source: new URL(url).hostname, category: null, at })));
    expect(topics.map((t) => [t.sites, t.items.length])).toEqual([
      [3, 3],
      [2, 2],
      [1, 1],
    ]);
  });

  it('does not meet without enough discovered articles: it would only invent', async () => {
    await discover(DISCOVERED.slice(0, 2));
    const res = await editor.post('/meetings', { focus: '' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('nothing_to_meet');
  });

  it('proposes stories from what discovery found, and researches only the ones approved', async () => {
    await discover(DISCOVERED);
    const started = await editor.post('/meetings', { focus: 'ריבית ודיור' });
    expect(started.status).toBe(202);
    expect(started.body).toMatchObject({ status: 'queued', focus: 'ריבית ודיור', pitches: [] });
    expect((await editor.post('/meetings', {})).status).toBe(409);
    await ctx.drain();

    const held = (await editor.get(`/meetings/${started.body.id}`)).body;
    expect(held).toMatchObject({ status: 'ready', itemsRead: 6, topics: 3 });
    expect(held.pitches).toHaveLength(3);
    // The hottest topic first, with the articles it grew from as leads (never as sources).
    expect(held.pitches[0]).toMatchObject({ status: 'pending', coverage: 3, research: null, depth: 'quick' });
    expect(held.pitches[0].leads).toHaveLength(3);
    // Nothing is paid for until someone approves.
    expect(await ctx.db.select().from(researchTasks)).toHaveLength(0);

    const approved = await editor.post(`/meetings/${held.id}/pitches/p1/approve`, { depth: 'regular', angle: 'כמה זה עולה למשפחה עם משכנתא' });
    expect(approved.status).toBe(200);
    expect(approved.body.pitches[0]).toMatchObject({ status: 'approved', depth: 'regular', angle: 'כמה זה עולה למשפחה עם משכנתא', decidedBy: 'Test editor', research: { status: 'queued' } });
    expect((await editor.post(`/meetings/${held.id}/pitches/p1/approve`, {})).status).toBe(409);
    const rejected = await editor.post(`/meetings/${held.id}/pitches/p2/reject`);
    expect(rejected.body.pitches[1]).toMatchObject({ status: 'rejected', research: null });

    await ctx.drain();
    const [task] = await ctx.db.select().from(researchTasks);
    expect(task).toMatchObject({ kind: 'idea', depth: 'regular', status: 'done' });
    expect(task!.note).toContain('כמה זה עולה למשפחה עם משכנתא');
    expect(task!.note).toContain('רמזים בלבד, לא מקור');
    expect(task!.note).toContain('https://www.globes.co.il/news/a1');
    const after = (await editor.get(`/meetings/${held.id}`)).body;
    expect(after.pitches[0].research).toMatchObject({ status: 'done', draftId: task!.draftId });
    const audited = await ctx.db.select().from(auditLog).where(eq(auditLog.entity, 'meeting'));
    expect(audited.map((a) => a.action).sort()).toEqual(['approve', 'start']);
  });

  it('drops a pitch that names no topic it was given', async () => {
    class Inventive extends FakeText {
      override async meeting(req: MeetingRequest) {
        const real = await super.meeting(req);
        const made: MeetingOutput['pitches'][number] = { ...real.data.pitches[0]!, title: 'סיפור שלא קיים', cluster_ids: ['t99'] };
        return { ...real, data: { ...real.data, pitches: [made, ...real.data.pitches] } };
      }
    }
    const saved = ctx.app.services.ai;
    ctx.app.services.ai = fixedAi(new Inventive(), new PlaceholderImages());
    try {
      const started = await editor.post('/meetings', {});
      await ctx.drain();
      const held = (await editor.get(`/meetings/${started.body.id}`)).body;
      expect(held.pitches.map((p: { title: string }) => p.title)).not.toContain('סיפור שלא קיים');
      expect(held.pitches).toHaveLength(3);
    } finally {
      ctx.app.services.ai = saved;
    }
  });

  it('lists the latest meetings, newest first', async () => {
    const list = (await editor.get('/meetings')).body;
    expect(list).toHaveLength(2);
    expect(new Date(list[0].createdAt) >= new Date(list[1].createdAt)).toBe(true);
  });

  it('holds the morning meeting at its hour in Israel, once a day, and not on Saturday', () => {
    const settings = MeetingSettings.parse({});
    const thursday0830 = new Date('2026-10-15T05:30:00Z');
    expect(isMorningDue(settings, null, thursday0830)).toBe(true);
    expect(isMorningDue(settings, new Date('2026-10-14T06:00:00Z'), thursday0830)).toBe(true);
    // Someone already held one today, by hand or by itself.
    expect(isMorningDue(settings, new Date('2026-10-15T04:00:00Z'), thursday0830)).toBe(false);
    expect(isMorningDue(settings, null, new Date('2026-10-15T06:30:00Z'))).toBe(false);
    expect(isMorningDue(settings, null, new Date('2026-10-17T05:30:00Z'))).toBe(false);
    expect(isMorningDue({ ...settings, skipSaturday: false }, null, new Date('2026-10-17T05:30:00Z'))).toBe(true);
    expect(isMorningDue({ ...settings, morning: false }, null, thursday0830)).toBe(false);
  });

  it('holds the morning meeting by itself and emails its pitches to the admins', async () => {
    const admin = staffClient(ctx, await signInStaff(ctx, 'admin'));
    expect((await editor.put('/agent/meeting-settings', { morning: true, hour: 7, focus: 'צרכנות', skipSaturday: true })).status).toBe(403);
    expect((await admin.put('/agent/meeting-settings', { morning: true, hour: 7, focus: 'צרכנות', skipSaturday: true })).status).toBe(200);

    expect(await holdMorningMeeting(ctx.app.services)).toBe(true);
    // A second one while it runs is skipped quietly, not an error.
    expect(await holdMorningMeeting(ctx.app.services)).toBe(false);
    await ctx.drain();
    const [held] = (await editor.get('/meetings')).body;
    expect(held).toMatchObject({ status: 'ready', auto: true, createdBy: '', focus: 'צרכנות' });
    const mail = ctx.mailer.lastTo('admin@newsroom.test');
    expect(mail?.subject).toBe(`ישיבת הבוקר: ${held.pitches.length} הצעות לכתבות`);
    expect(mail?.text).toContain(held.pitches[0].title);
    expect(mail?.text).toContain('/manual?tab=meeting');
  });
});
