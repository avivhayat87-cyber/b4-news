# Next steps

## To go live

1. **Infrastructure**: managed PostgreSQL (`DATABASE_URL`), object storage + CDN for `MEDIA_DIR`/`MEDIA_BASE_URL`, the API behind a reverse proxy (`TRUST_PROXY=true`), HTTPS everywhere, `COOKIE_DOMAIN` set to the parent domain of the site, CMS and API.
2. **Server secrets**: `HASH_PEPPER`, `SECRETS_KEY`, `REVALIDATE_SECRET` (also on the site). Then, in the CMS (הגדרות > חיבורים): Claude, Gemini (images) and SMTP keys.
3. **Real sources**: paste the sites' links in "הגדרות אתרים" (automatic setup), approve the ones that pass, configure the rest by hand. Check each site's terms of use; the published article credits its source, and the crawler respects robots.txt.
4. **Social accounts** (הגדרות > חיבורים): Facebook page token, Instagram business account (`instagram_content_publish`), Telegram bot as channel admin. Images must be on a public HTTPS URL (the CDN) for Meta and Telegram to fetch them.
5. **Site details** (הגדרות > פרטי האתר): social and app links, contact details, and the company details (name, registration number, address, privacy email, accessibility coordinator, last accessibility review), which fill the legal pages. Have a lawyer review the terms, privacy policy, comment rules and accessibility statement (defaults in `apps/api/src/services/legal-pages.ts`); after any material change, "פרסום גרסה חדשה של התנאים" asks every reader to accept again.
6. **App stores**: EAS project (`EAS_PROJECT_ID`), `APP_DOMAIN` for universal links, push credentials, store listings.
7. **Scale-out**: run the API with `WORKER=off` and one or more `npm run worker` processes.

## Product backlog

- Scheduled discovery (sources already have `scrape_interval_min`; a scheduler only needs to call `startRun(…, 'schedule')`).
- X and TikTok posting once API access is approved; WhatsApp channels have no posting API (posts are prepared for manual posting).
- Edit locks with presence ("X is editing") on top of the existing optimistic versioning.
- Index quotes (TA-35, S&P 500…) need a licensed market-data provider; the ticker shows official exchange rates today.
- Podcast management (the homepage band appears once episodes exist).
- Headless rendering (`html_js`) for sources that need JavaScript.
- Editable prompt templates in the CMS (they are versioned in `prompt_templates` already).
