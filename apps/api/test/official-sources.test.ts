// The official-sources registry: social accounts recognised in any form, a post from a verified
// account or a page of a body's site counted as official under the body's name, and the weekly
// check that adds the accounts a body's own site links (never the portal's footer) and verifies
// what a search found against the body's own page.
import { eq, officialSources } from '@b4/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PageCapture } from '../src/lib/page-capture';
import { accountOf, belongsTo } from '../src/lib/social-links';
import { fixedAi } from '../src/services/ai';
import { FakeText, PlaceholderImages } from '../src/services/ai/fake';
import type { AccountsRequest } from '../src/services/ai/types';
import { registryForResearch, runRegistryUpdate } from '../src/services/official-sources';
import { checkDossier } from '../src/services/research';
import { setup, signInStaff, staffClient } from './helpers';

const MOF = 'https://www.gov.il/he/departments/ministry_of_finance';
const TAX = 'https://www.gov.il/he/departments/israel_tax_authority';
const FOOTER = ['https://www.facebook.com/israelGov', 'https://twitter.com/israelgov', 'https://twitter.com/intent/tweet?url=x'];

/** A browser that answers from a table: the pages as the test wants them drawn. */
function fakeBrowser(pages: Record<string, string[]>): PageCapture {
  return {
    available: true,
    screenshot: async () => Buffer.from(''),
    links: async (url) => {
      const links = pages[url];
      if (!links) throw new Error('page not found');
      return links;
    },
  };
}

describe('official-sources registry', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  let admin: ReturnType<typeof staffClient>;
  let editor: ReturnType<typeof staffClient>;

  beforeAll(async () => {
    ctx = await setup();
    admin = staffClient(ctx, await signInStaff(ctx, 'admin'));
    editor = staffClient(ctx, await signInStaff(ctx, 'editor'));
  });
  afterAll(() => ctx.close());

  it('recognises an account in any form a page links it, and never a share button', () => {
    expect(accountOf('https://twitter.com/Israel_MOF?lang=he')).toEqual({ platform: 'x', key: 'x.com/israel_mof' });
    expect(accountOf('https://x.com/israel_mof/status/123')).toEqual({ platform: 'x', key: 'x.com/israel_mof' });
    expect(accountOf('https://t.me/s/MOF_Israel')).toEqual({ platform: 'telegram', key: 't.me/mof_israel' });
    expect(accountOf('https://www.linkedin.com/company/bank-of-israel/')).toEqual({ platform: 'linkedin', key: 'linkedin.com/company/bank-of-israel' });
    expect(accountOf('https://twitter.com/intent/tweet?url=x')).toBeNull();
    expect(accountOf('https://facebook.com/sharer.php?u=x')).toBeNull();
    expect(accountOf('https://www.youtube.com/playlist?list=PL1')).toBeNull();
    expect(accountOf('https://www.gov.il/he')).toBeNull();
    expect(belongsTo('https://t.me/MOF_Israel/4521', 't.me/mof_israel')).toBe(true);
    expect(belongsTo('https://t.me/other/4521', 't.me/mof_israel')).toBe(false);
  });

  it('starts with the main official bodies and the accounts their sites link', async () => {
    const res = await editor.get('/official-sources');
    expect(res.status).toBe(200);
    const names = res.body.sources.map((s: { name: string }) => s.name);
    expect(names).toEqual(expect.arrayContaining(['בנק ישראל', 'משרד האוצר', 'הלשכה המרכזית לסטטיסטיקה', 'ממשלת ישראל']));
    const mof = res.body.sources.find((s: { name: string }) => s.name === 'משרד האוצר');
    expect(mof.accounts.map((a: { key: string }) => a.key)).toContain('t.me/mof_israel');
    expect(res.body.lastRun).toBeNull();
    // Every seeded key is exactly what its link reads as (a hand-typed key would never match a post).
    for (const s of res.body.sources) for (const a of s.accounts) expect(accountOf(a.url)?.key, a.url).toBe(a.key);
  });

  it("counts a body's posts and pages as official, under its name, the most specific body first", async () => {
    const registry = await registryForResearch(ctx.db);
    const d = checkDossier(
      {
        original: { who: '', when: '', what: '', url: '' },
        summary: '',
        claims: [
          { text: 'האוצר הודיע', label: 'verified', source_urls: ['https://x.com/Israel_MOF/status/1'], note: '' },
          { text: 'הודעת המשרד', label: 'verified', source_urls: [`${MOF}/govil-landing-page`], note: '' },
          { text: 'הודעה אחרת בפורטל', label: 'verified', source_urls: ['https://www.gov.il/he/pages/press-release-1'], note: '' },
          { text: 'פוסט של חשבון לא מוכר', label: 'verified', source_urls: ['https://x.com/someone/status/2'], note: '' },
        ],
        background: [],
        open_questions: [],
        response_needed: [],
        sources: [],
      },
      null,
      [],
      registry,
    );
    expect(d.sources.map((x) => [x.publisher, x.approved])).toEqual([
      ['משרד האוצר ברשתות החברתיות', true],
      ['משרד האוצר', true],
      ['ממשלת ישראל', true],
      ['רשתות חברתיות', false],
    ]);
    expect(d.claims.map((c) => c.label)).toEqual(['verified', 'verified', 'verified', 'reported']);
    expect(d.creditLine).toBe('מקורות: משרד האוצר ברשתות החברתיות, משרד האוצר, ממשלת ישראל');
  });

  it("adds what a body's site links, keeps the portal's footer to the portal, and verifies a search against the body's own page", async () => {
    class Searcher extends FakeText {
      override async findAccounts(req: AccountsRequest) {
        const base = await super.findAccounts(req);
        if (req.body.name !== 'הלשכה המרכזית לסטטיסטיקה') return base;
        return {
          ...base,
          data: {
            accounts: [
              { platform: 'x' as const, url: 'https://x.com/cbs_israel', evidence_url: 'https://www.cbs.gov.il/he/contact' },
              { platform: 'telegram' as const, url: 'https://t.me/cbs_fake', evidence_url: 'https://fan-site.example/cbs' },
            ],
          },
        };
      }
    }
    const saved = { ai: ctx.app.services.ai, capture: ctx.app.services.capture };
    ctx.app.services.ai = fixedAi(new Searcher(), new PlaceholderImages());
    ctx.app.services.capture = fakeBrowser({
      [MOF]: ['https://t.me/MOF_Israel', 'https://www.threads.net/@israel_mof', ...FOOTER],
      [TAX]: [],
      'https://www.gov.il': FOOTER,
      // Bank of Israel no longer links its LinkedIn page, and now links its X account.
      'https://www.boi.org.il': ['https://www.youtube.com/user/thebankofisrael', 'https://www.facebook.com/bankisraelvc', 'https://www.instagram.com/bank_of_israel', 'https://x.com/bank_of_israel'],
      'https://www.cbs.gov.il': [],
      // The Tax Authority's page drawn without any account (a check page): its accounts stay.
      'https://www.cbs.gov.il/he/contact': ['https://twitter.com/CBS_Israel'],
    });
    try {
      const run = await runRegistryUpdate(ctx.app.services, { createdBy: null } as never);
      expect(run).toMatchObject({ added: 3, pending: 1 });
      const rows = await ctx.db.select().from(officialSources);
      const by = (name: string) => rows.find((r) => r.name === name)!;
      expect(by('משרד האוצר').accounts.map((a) => a.key)).toContain('threads.net/@israel_mof');
      expect(by('משרד האוצר').accounts.map((a) => a.key)).not.toContain('x.com/israelgov');
      expect(by('ממשלת ישראל').accounts.find((a) => a.key === 'x.com/israelgov')).toMatchObject({ status: 'verified' });
      expect(by('רשות המסים').accounts.every((a) => a.status === 'verified')).toBe(true);
      expect(by('רשות המסים').lastError).toContain('החשבונות נשארו כמו שהם');
      const boi = by('בנק ישראל').accounts;
      expect(boi.find((a) => a.key === 'x.com/bank_of_israel')).toMatchObject({ status: 'verified', foundBy: 'site', evidence: 'https://www.boi.org.il' });
      expect(boi.find((a) => a.key === 'linkedin.com/company/bank-of-israel')).toMatchObject({ status: 'missing' });
      const cbs = by('הלשכה המרכזית לסטטיסטיקה').accounts;
      expect(cbs.find((a) => a.key === 'x.com/cbs_israel')).toMatchObject({ status: 'verified', foundBy: 'search', evidence: 'https://www.cbs.gov.il/he/contact' });
      expect(cbs.find((a) => a.key === 't.me/cbs_fake')).toMatchObject({ status: 'pending' });
      // A body whose page couldn't be read keeps what it had, and says why.
      expect(by('הכנסת').lastError).toBe('לא הצלחנו לקרוא את האתר. ננסה שוב בבדיקה הבאה.');
      expect((await editor.get('/official-sources')).body.lastRun).toMatchObject({ added: 3, pending: 1 });
    } finally {
      Object.assign(ctx.app.services, saved);
    }
  });

  it('lets only an admin add a body or decide on an account', async () => {
    expect((await editor.post('/official-sources', { name: 'משרד החינוך', homepage: 'https://www.gov.il/he/departments/ministry_of_education' })).status).toBe(403);
    const created = await admin.post('/official-sources', { name: 'משרד החינוך', kind: 'government', homepage: 'https://www.gov.il/he/departments/ministry_of_education', domains: ['gov.il/he/departments/ministry_of_education'] });
    expect(created.status).toBe(201);
    expect((await admin.post(`/official-sources/${created.body.id}/accounts`, { url: 'https://www.gov.il/he' })).status).toBe(422);
    const added = await admin.post(`/official-sources/${created.body.id}/accounts`, { url: 'https://t.me/edu_il' });
    expect(added.body.accounts).toEqual([expect.objectContaining({ key: 't.me/edu_il', status: 'verified', foundBy: 'admin' })]);
    const [cbs] = await ctx.db.select().from(officialSources).where(eq(officialSources.name, 'הלשכה המרכזית לסטטיסטיקה'));
    const approved = await admin.post(`/official-sources/${cbs!.id}/accounts/approve`, { url: 'https://t.me/cbs_fake' });
    expect(approved.body.accounts.find((a: { key: string }) => a.key === 't.me/cbs_fake')).toMatchObject({ status: 'verified' });
    const removed = await admin.post(`/official-sources/${cbs!.id}/accounts/remove`, { url: 'https://t.me/cbs_fake' });
    expect(removed.body.accounts.map((a: { key: string }) => a.key)).not.toContain('t.me/cbs_fake');
    expect((await admin.post('/official-sources', { name: 'כפול', homepage: 'https://www.boi.org.il' })).status).toBe(409);
  });
});
