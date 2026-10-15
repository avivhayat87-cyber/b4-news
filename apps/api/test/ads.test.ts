// Advertising: campaigns run only after an admin approves them, and only in their places, sections
// and dates; views, clicks and leads are counted against a signed token; a lead needs consent, is
// encrypted, reaches the advertiser and their private page; ended campaigns wait in the archive;
// and the ads agent proposes and checks, while a person decides.
import { adLeads, eq } from '@b4/db';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGIN, setup, signInStaff, staffClient } from './helpers';

describe('advertising', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  let admin: ReturnType<typeof staffClient>;
  let editor: ReturnType<typeof staffClient>;
  let adminCookie: string;
  let advertiserId: string;
  let linkCampaign: string;
  let leadCampaign: string;

  beforeAll(async () => {
    ctx = await setup();
    adminCookie = await signInStaff(ctx, 'admin');
    admin = staffClient(ctx, adminCookie);
    editor = staffClient(ctx, await signInStaff(ctx, 'editor'));
  });
  afterAll(() => ctx.close());

  const pub = async <T = any>(method: 'GET' | 'POST', url: string, payload?: object, ip = '10.9.0.1') => {
    const res = await ctx.app.inject({ method, url: `/api/v1/public${url}`, headers: { origin: ORIGIN }, remoteAddress: ip, ...(payload ? { payload } : {}) });
    return { status: res.statusCode, headers: res.headers, body: (res.body ? JSON.parse(res.body) : null) as T };
  };

  async function upload(use: string, width: number, height: number) {
    const png = await sharp({ create: { width, height, channels: 3, background: '#224466' } }).png().toBuffer();
    const boundary = '----b4ads';
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/admin/ads/images?use=${use}`,
      headers: { cookie: adminCookie, origin: ORIGIN, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`),
        png,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
    });
    return { status: res.statusCode, body: JSON.parse(res.body) };
  }

  // The whole place (4 of 4 positions), so these tests always get their ad; the rotation tests below share places.
  const campaign = (over: Record<string, unknown> = {}) => ({
    advertiserId,
    name: 'משכנתא בסתיו',
    slots: ['sidebar', 'article_end'],
    categories: ['real-estate'],
    action: 'link',
    url: 'https://bank.example/offer?utm_source=theirs',
    share: 4,
    ...over,
  });

  it('keeps advertising to admins: editors see neither the campaigns nor the leads', async () => {
    expect((await editor.get('/ads')).status).toBe(403);
    expect((await editor.get('/ads/leads')).status).toBe(403);
    expect((await editor.post('/ads/advertisers', { name: 'עסק' })).status).toBe(403);
  });

  it('runs a campaign only after an admin approves it, and only in its places and sections', async () => {
    const a = await admin.post('/ads/advertisers', { name: 'בנק הדוגמה', email: 'ads@bank.example' });
    expect(a.status).toBe(201);
    advertiserId = a.body.id;
    const c = await admin.post('/ads/campaigns', campaign());
    expect(c.status).toBe(201);
    expect(c.body.status).toBe('draft');
    linkCampaign = c.body.id;

    const ask = (slot: string, query = '') => pub('GET', `/ads/${slot}?device=desktop${query}`);
    expect((await ask('sidebar', '&category=real-estate')).body.ad).toBeNull();
    // Nothing to show yet: it can't be approved.
    expect((await admin.post(`/ads/campaigns/${linkCampaign}/status`, { status: 'active' })).status).toBe(409);

    expect((await admin.post(`/ads/campaigns/${linkCampaign}/creatives`, { format: 'billboard' })).status).toBe(400);
    const added = await admin.post(`/ads/campaigns/${linkCampaign}/creatives`, { format: 'native', headline: 'משכנתא בריבית קבועה', body: 'בדקו את ההצעה', cta: 'לפרטים' });
    expect(added.status).toBe(201);
    const approved = await admin.post(`/ads/campaigns/${linkCampaign}/status`, { status: 'active' });
    expect(approved.status).toBe(200);
    expect(approved.body.approvedBy).toBe('Test admin');

    const shown = (await ask('sidebar', '&category=real-estate')).body.ad;
    expect(shown.sponsor).toBe('בנק הדוגמה');
    expect(shown.headline).toBe('משכנתא בריבית קבועה');
    expect(shown.href).toContain('/api/v1/public/ads/go/');
    // A campaign for a section stays in it, and in its own places.
    expect((await ask('sidebar')).body.ad).toBeNull();
    expect((await ask('sidebar', '&category=health')).body.ad).toBeNull();
    expect((await ask('home_top', '&category=real-estate')).body.ad).toBeNull();
    expect((await ask('sidebar', `&category=real-estate&exclude=${linkCampaign}`)).body.ad).toBeNull();
  });

  it('counts a view, and a click on the way to the advertiser, but never a forged token', async () => {
    const { ad } = (await pub('GET', '/ads/article_end?device=mobile&category=real-estate')).body;
    expect((await pub('POST', '/ads/view', { token: ad.token })).status).toBe(204);
    const forged = ad.token.slice(0, -1) + (ad.token.endsWith('0') ? '1' : '0');
    expect((await pub('POST', '/ads/view', { token: forged })).status).toBe(204);

    const click = await pub('GET', `/ads/go/${ad.token}`);
    expect(click.status).toBe(302);
    const to = new URL(String(click.headers.location));
    expect(to.origin + to.pathname).toBe('https://bank.example/offer');
    expect(to.searchParams.get('utm_source')).toBe('theirs');
    expect(to.searchParams.get('utm_medium')).toBe('native');
    expect(to.searchParams.get('utm_content')).toBe('article_end');
    expect((await pub('GET', `/ads/go/${forged}`)).headers.location).toBe(ORIGIN);

    const totals = (await admin.get(`/ads/campaigns/${linkCampaign}`)).body.totals;
    expect(totals).toMatchObject({ views: 1, clicks: 1 });
    expect(totals.served).toBeGreaterThanOrEqual(2);
  });

  it('takes a lead only with consent, keeps it encrypted, emails the advertiser and shows it on their page', async () => {
    const c = await admin.post('/ads/campaigns', campaign({ name: 'ייעוץ חינם', slots: ['app_feed'], categories: [], action: 'lead', url: '', leadForm: { fields: ['name', 'phone'], question: 'רוצים שנחזור אליכם?' } }));
    leadCampaign = c.body.id;
    await admin.post(`/ads/campaigns/${leadCampaign}/creatives`, { format: 'native', headline: 'ייעוץ משכנתא', cta: 'השאירו פרטים' });
    await admin.post(`/ads/campaigns/${leadCampaign}/status`, { status: 'active' });

    const { ad } = (await pub('GET', '/ads/app_feed?device=mobile')).body;
    expect(ad.href).toBeNull();
    expect(ad.lead.fields).toEqual(['name', 'phone']);
    expect(ad.lead.consent).toContain('בנק הדוגמה');

    // Opening the form is the lead ad's click.
    expect((await pub('POST', '/ads/view', { token: ad.token, kind: 'open' })).status).toBe(204);
    const send = (body: object) => pub('POST', '/ads/lead', { token: ad.token, ...body }, '10.9.0.7');
    expect((await send({ fields: { name: 'דנה כהן', phone: '050-1234567' } })).status).toBe(400);
    const missing = await send({ fields: { name: 'דנה כהן' }, consent: true });
    expect(missing.status).toBe(400);
    expect(missing.body.message).toBe('חסר: טלפון');
    const ok = await send({ fields: { name: 'דנה כהן', phone: '050-1234567', email: 'not asked' }, consent: true });
    expect(ok.status).toBe(201);

    const [row] = await ctx.db.select().from(adLeads).where(eq(adLeads.campaignId, leadCampaign));
    expect(row!.sealed).not.toContain('דנה');
    expect(row!.consentText).toContain('בנק הדוגמה');
    expect(ctx.mailer.lastTo('ads@bank.example')?.text).toContain('050-1234567');

    const listed = (await admin.get('/ads/leads?kind=lead')).body;
    expect(listed[0].fields).toEqual({ name: 'דנה כהן', phone: '050-1234567' });

    const advertiser = (await admin.get('/ads')).body.advertisers.find((x: { id: string }) => x.id === advertiserId);
    const key = String(advertiser.reportUrl).split('/partner/')[1];
    const page = await pub('GET', `/partners/${key}`);
    expect(page.status).toBe(200);
    expect(page.body.leads[0].fields.name).toBe('דנה כהן');
    expect(page.body.campaigns.find((x: { id: string }) => x.id === leadCampaign).totals).toMatchObject({ clicks: 1, leads: 1 });

    // A new link cancels the old one.
    const renewed = await admin.post(`/ads/advertisers/${advertiserId}/new-link`);
    expect((await pub('GET', `/partners/${key}`)).status).toBe(404);
    expect((await pub('GET', `/partners/${String(renewed.body.reportUrl).split('/partner/')[1]}`)).status).toBe(200);
  });

  it('keeps businesses that ask to advertise as inquiries, with a phone and an optional email, and emails the admins', async () => {
    const send = (body: object) => pub('POST', '/ads/inquiry', body, '10.9.0.8');
    expect((await send({ name: 'יוסי', phone: '052-7654321', consent: true, website: 'bot' })).status).toBe(400);
    const noPhone = await send({ name: 'יוסי', consent: true });
    expect(noPhone.status).toBe(400);
    const sent = await send({ name: 'יוסי', company: 'החנות', phone: '052-7654321', interests: ['section', 'lead_ads'], section: 'real-estate', message: 'חנות רהיטים בחיפה', consent: true });
    expect(sent.status).toBe(204);
    const inquiries = (await admin.get('/ads/leads?kind=inquiry')).body;
    expect(inquiries[0].fields).toMatchObject({ name: 'יוסי', company: 'החנות', phone: '052-7654321', email: '', section: 'נדל״ן', interests: 'פרסום במדור מסוים, מודעה עם טופס פניות' });
    expect((await admin.get('/ads')).body.newInquiries).toBe(1);
    // Every admin is told, with the details and a link to the inquiries.
    const mail = ctx.mailer.lastTo('admin@newsroom.test');
    expect(mail?.subject).toBe('פנייה חדשה לפרסום: החנות');
    expect(mail?.text).toContain('052-7654321');
    expect(mail?.text).toContain('/ads?tab=inquiries');
    expect((await admin.get('/dashboard')).body.ads).toEqual({ newLeads: 1, newInquiries: 1 });
    expect((await editor.get('/dashboard')).body.ads).toEqual({ newLeads: 0, newInquiries: 0 });
  });

  it('takes a banner only in its own proportions, and sets one from words in every size', async () => {
    expect((await upload('billboard-desktop', 1000, 500)).status).toBe(422);
    // The old, tall billboard (970x250) no longer fits: the wide place is a thin strip now.
    expect((await upload('billboard-desktop', 1940, 500)).status).toBe(422);
    const ok = await upload('billboard-desktop', 1940, 180);
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ width: 1940, height: 180 });

    const set = await admin.post('/ads/compose', { format: 'billboard', headline: 'משכנתא בריבית קבועה', body: 'לכל החיים', cta: 'לפרטים', sponsor: 'בנק הדוגמה', theme: 'dark' });
    expect(set.status).toBe(201);
    const desktop = await sharp(await ctx.storage.get(set.body.desktop.key)).metadata();
    const mobile = await sharp(await ctx.storage.get(set.body.mobile.key)).metadata();
    expect([desktop.width, desktop.height]).toEqual([1940, 180]);
    expect([mobile.width, mobile.height]).toEqual([640, 100]);
  });

  it('moves an ended campaign to the archive with its numbers, and deletes only by hand, leads and all', async () => {
    const current = (await admin.get(`/ads/campaigns/${linkCampaign}`)).body;
    const past = new Date(Date.now() - 60_000).toISOString();
    const updated = await admin.put(`/ads/campaigns/${linkCampaign}`, { ...campaign(), startsAt: new Date(Date.now() - 86_400_000).toISOString(), endsAt: past, share: current.share });
    expect(updated.status).toBe(200);
    const overview = (await admin.get('/ads')).body;
    const archived = overview.archive.find((x: { id: string }) => x.id === linkCampaign);
    expect(archived.status).toBe('ended');
    expect(archived.totals.views).toBe(1);
    expect((await pub('GET', '/ads/sidebar?device=desktop&category=real-estate')).body.ad).toBeNull();

    // An ad that ran keeps its numbers: it is turned off, not deleted.
    expect((await admin.del(`/ads/creatives/${archived.creatives[0].id}`)).status).toBe(409);
    expect((await admin.del(`/ads/advertisers/${advertiserId}`)).status).toBe(409);
    expect((await admin.del(`/ads/campaigns/${leadCampaign}`)).status).toBe(204);
    expect(await ctx.db.select().from(adLeads).where(eq(adLeads.campaignId, leadCampaign))).toHaveLength(0);
  });

  it('lets the ads agent propose a campaign and check an ad, and saves nothing on its own', async () => {
    const started = await admin.post('/ads/agent/brief', { business: 'סטודיו לעיצוב מטבחים', offer: 'מטבחים בהתאמה אישית, ייעוץ ראשון חינם בבית הלקוח.', goal: 'leads' });
    expect(started.status).toBe(202);
    await ctx.drain();
    const brief = (await admin.get(`/ads/agent/tasks/${started.body.id}`)).body;
    expect(brief.status).toBe('done');
    expect(brief.brief.action).toBe('lead');
    expect(brief.brief.headlines.length).toBeGreaterThan(0);

    const c = await admin.post('/ads/campaigns', campaign({ name: 'בדיקה', slots: ['sidebar'], categories: [] }));
    const withAd = await admin.post(`/ads/campaigns/${c.body.id}/creatives`, { format: 'native', headline: 'המשכנתא הכי זולה בארץ' });
    const creativeId = withAd.body.creatives[0].id;
    const review = await admin.post(`/ads/creatives/${creativeId}/review`);
    await ctx.drain();
    expect((await admin.get(`/ads/agent/tasks/${review.body.id}`)).body.review.verdict).toBe('fix');
    expect((await admin.get(`/ads/campaigns/${c.body.id}`)).body.creatives[0].review.verdict).toBe('fix');
    expect((await admin.get(`/ads/campaigns/${c.body.id}`)).body.status).toBe('draft');

    const team = (await admin.get('/agents')).body;
    expect(team.agents.find((x: { id: string }) => x.id === 'ads').skills.map((x: { key: string }) => x.key)).toEqual(['ads.brief', 'ads.review', 'ads.report']);
  });

  it('shows a section banner only at the top of its sections, and the house banner where none runs', async () => {
    const c = await admin.post('/ads/campaigns', campaign({ name: 'ראש מדור', slots: ['category_top'], categories: ['insurance'] }));
    const set = await admin.post('/ads/compose', { format: 'billboard', headline: 'ביטוח דירה', sponsor: 'בנק הדוגמה' });
    await admin.post(`/ads/campaigns/${c.body.id}/creatives`, { format: 'billboard', desktopImage: set.body.desktop.key, mobileImage: set.body.mobile.key });
    expect((await admin.post(`/ads/campaigns/${c.body.id}/status`, { status: 'active' })).status).toBe(200);
    expect((await pub('GET', '/ads/category_top?device=desktop&category=insurance')).body.ad.format).toBe('billboard');
    const elsewhere = (await pub('GET', '/ads/category_top?device=desktop&category=health')).body;
    expect(elsewhere.ad).toBeNull();
    expect(elsewhere.housePromo).toBe(true);
    await admin.post(`/ads/campaigns/${c.body.id}/status`, { status: 'ended' });
  });

  it('empties every place when ads are switched off', async () => {
    const c = await admin.post('/ads/campaigns', campaign({ name: 'כללי', slots: ['sidebar'], categories: [] }));
    await admin.post(`/ads/campaigns/${c.body.id}/creatives`, { format: 'native', headline: 'הצעה' });
    await admin.post(`/ads/campaigns/${c.body.id}/status`, { status: 'active' });
    expect((await pub('GET', '/ads/sidebar?device=desktop')).body.ad).not.toBeNull();
    await admin.put('/ads/settings', { enabled: false, housePromo: true, appFeedEvery: 8 });
    const off = (await pub('GET', '/ads/sidebar?device=desktop')).body;
    expect(off.ad).toBeNull();
    expect(off.housePromo).toBe(true);
  });

  it('lets Google fill only the places allowed for it where no campaign runs, and asks readers about ad cookies only then', async () => {
    const google = { enabled: true, client: 'pub-1234567890123456', slots: ['sidebar', 'article_end'], units: { sidebar: '1111111111', article_end: '2222222222', home_top: '3333333333' } };
    expect((await admin.put('/ads/settings', { enabled: true, housePromo: true, appFeedEvery: 8, google: { ...google, client: '' } })).status).toBe(400);
    expect((await admin.put('/ads/settings', { enabled: true, housePromo: true, appFeedEvery: 8, google: { ...google, client: 'ca-pub-12' } })).status).toBe(400);
    const saved = await admin.put('/ads/settings', { enabled: true, housePromo: true, appFeedEvery: 8, google });
    expect(saved.status).toBe(200);
    expect(saved.body.google.client).toBe('ca-pub-1234567890123456');

    const site = (await pub('GET', '/site')).body;
    expect(site.consent.adsCookies).toBe(true);
    expect(site.ads.googleClient).toBe('ca-pub-1234567890123456');

    // A place nobody bought, allowed for Google: its unit, with the terms version the reader's consent must match.
    const end = (await pub('GET', '/ads/article_end?device=desktop')).body;
    expect(end.ad).toBeNull();
    expect(end.google).toEqual({ client: 'ca-pub-1234567890123456', unit: '2222222222', consentVersion: site.consent.version });
    // A campaign of ours comes first; a place not allowed (even with a unit) stays ours; the app never.
    const side = (await pub('GET', '/ads/sidebar?device=desktop')).body;
    expect(side.ad).not.toBeNull();
    expect(side.google).toBeNull();
    expect((await pub('GET', '/ads/home_top?device=desktop')).body.google).toBeNull();
    expect((await pub('GET', '/ads/app_article?device=mobile')).body.google).toBeNull();

    // Google off: no unit anywhere, and the banner stops asking about ad cookies.
    await admin.put('/ads/settings', { enabled: true, housePromo: true, appFeedEvery: 8, google: { ...google, enabled: false } });
    expect((await pub('GET', '/ads/article_end?device=desktop')).body.google).toBeNull();
    expect((await pub('GET', '/site')).body).toMatchObject({ consent: { adsCookies: false }, ads: { googleClient: null } });
  });

  describe('rotation: a place shared by a few advertisers', () => {
    const banner = async (name: string, over: Record<string, unknown>) => {
      const c = await admin.post('/ads/campaigns', campaign({ name, slots: ['home_top'], categories: [], ...over }));
      const set = await admin.post('/ads/compose', { format: 'billboard', headline: name, sponsor: 'בנק הדוגמה' });
      await admin.post(`/ads/campaigns/${c.body.id}/creatives`, { format: 'billboard', desktopImage: set.body.desktop.key, mobileImage: set.body.mobile.key });
      return c.body.id as string;
    };
    let quarter: string;
    let threeQuarters: string;

    it('serves a place as its rotation: each campaign in as many positions as it bought, the rest our promo', async () => {
      quarter = await banner('רבע מהשטח', { share: 1 });
      expect((await admin.post(`/ads/campaigns/${quarter}/status`, { status: 'active' })).status).toBe(200);
      const place = (await pub('GET', '/ads/home_top?device=desktop')).body;
      expect(place.rotation).toHaveLength(4);
      expect(place.rotation.filter((a: { campaignId: string } | null) => a?.campaignId === quarter)).toHaveLength(1);
      expect(place.rotation.filter((a: unknown) => a === null)).toHaveLength(3);
      expect(place.ad).toEqual(place.rotation[0]);
      expect(place.rotateSeconds).toBe(30);
      expect(place.google).toBeNull();
      // The app shows one per view.
      expect((await pub('GET', '/ads/app_article?device=mobile')).body.rotateSeconds).toBe(0);
    });

    it('refuses to run a campaign where its share is not free, and says where and when', async () => {
      const whole = await banner('כל השטח', { share: 4 });
      const refused = await admin.post(`/ads/campaigns/${whole}/status`, { status: 'active' });
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe('place_full');
      expect(refused.body.message).toContain('באנר בדף הבית');
      expect(refused.body.message).toContain('פנויות 3 מתוך 4');
      threeQuarters = await banner('שלושה רבעים', { share: 3 });
      expect((await admin.post(`/ads/campaigns/${threeQuarters}/status`, { status: 'active' })).status).toBe(200);
      // Growing a running campaign beyond what is free is refused too.
      const grown = await admin.put(`/ads/campaigns/${quarter}`, campaign({ name: 'רבע מהשטח', slots: ['home_top'], categories: [], share: 2 }));
      expect(grown.status).toBe(409);

      const board = (await admin.get('/ads/availability')).body;
      expect(board.places.find((p: { slot: string }) => p.slot === 'home_top')).toEqual({ slot: 'home_top', positions: 4, rotateSeconds: 30 });
      const home = board.bookings.filter((b: { slots: string[] }) => b.slots.includes('home_top'));
      expect(home.map((b: { name: string; status: string; share: number }) => [b.name, b.status, b.share]).sort()).toEqual([
        ['כל השטח', 'draft', 4],
        ['רבע מהשטח', 'active', 1],
        ['שלושה רבעים', 'active', 3],
      ]);
      // A full place: no unsold position left in the rotation.
      const full = (await pub('GET', '/ads/home_top?device=desktop')).body;
      expect(full.rotation.filter((a: unknown) => a === null)).toHaveLength(0);
    });

    it('counts the ads the rotation moves to, and lets campaigns of different sections hold the same place', async () => {
      const place = (await pub('GET', '/ads/home_top?device=desktop')).body;
      const next = place.rotation[1];
      const before = (await admin.get(`/ads/campaigns/${next.campaignId}`)).body.totals.served;
      expect((await pub('POST', '/ads/view', { token: next.token, kind: 'shown' })).status).toBe(204);
      expect((await admin.get(`/ads/campaigns/${next.campaignId}`)).body.totals.served).toBe(before + 1);

      // Each section's whole place at the end of articles, by a different advertiser: both run.
      const one = await admin.post('/ads/campaigns', campaign({ name: 'נדל"ן', slots: ['article_end'], categories: ['real-estate'] }));
      const two = await admin.post('/ads/campaigns', campaign({ name: 'ביטוח', slots: ['article_end'], categories: ['insurance'] }));
      for (const c of [one, two]) {
        await admin.post(`/ads/campaigns/${c.body.id}/creatives`, { format: 'native', headline: c.body.name });
        expect((await admin.post(`/ads/campaigns/${c.body.id}/status`, { status: 'active' })).status).toBe(200);
      }
      // One for the whole site there meets both: no room in those sections.
      const everywhere = await admin.post('/ads/campaigns', campaign({ name: 'בכל האתר', slots: ['article_end'], categories: [], share: 1 }));
      await admin.post(`/ads/campaigns/${everywhere.body.id}/creatives`, { format: 'native', headline: 'בכל האתר' });
      expect((await admin.post(`/ads/campaigns/${everywhere.body.id}/status`, { status: 'active' })).status).toBe(409);
    });

    it('shrinks a place from the settings, and shares an overbooked place pro rata', async () => {
      const settings = (await admin.get('/ads')).body.settings;
      const saved = await admin.put('/ads/settings', { ...settings, places: { ...settings.places, home_top: { positions: 2, rotateSeconds: 15 } } });
      expect(saved.status).toBe(200);
      const place = (await pub('GET', '/ads/home_top?device=desktop')).body;
      // 1 + min(3, 2) shares in a place of 2: all three positions are sold, none is ours.
      expect(place.rotation).toHaveLength(3);
      expect(place.rotation.every((a: unknown) => a !== null)).toBe(true);
      expect(place.rotateSeconds).toBe(15);
      expect((await admin.put('/ads/settings', { ...settings, places: { ...settings.places, home_top: { positions: 2, rotateSeconds: 7 } } })).status).toBe(400);
    });
  });
});
