# Next steps

## To go live

1. **Infrastructure**: managed PostgreSQL (`DATABASE_URL`), object storage + CDN for `MEDIA_DIR`/`MEDIA_BASE_URL`, the API behind a reverse proxy (`TRUST_PROXY=true`), HTTPS everywhere, `COOKIE_DOMAIN` set to the parent domain of the site, CMS and API.
2. **Keys**: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `SMTP_URL`, `HASH_PEPPER`, `REVALIDATE_SECRET` (also on the site). The API refuses to start in production without them.
3. **Real sources**: add each site in "הגדרות אתרים"; a developer configures and approves its trigger. Check each site's terms of use; the published article credits its source.
4. **Social accounts**: Facebook page token, Instagram business account (`instagram_content_publish`), Telegram bot as channel admin, each as `SOCIAL_SECRET_<NAME>`. Images must be on a public HTTPS URL (the CDN) for Meta to fetch them.
5. **App stores**: EAS project (`EAS_PROJECT_ID`), `APP_DOMAIN` for universal links, push credentials, store listings.
6. **Scale-out**: run the API with `WORKER=off` and one or more `npm run worker` processes.

## Product backlog

- Scheduled discovery (sources already have `scrape_interval_min`; a scheduler only needs to call `startRun(…, 'schedule')`).
- X and TikTok posting once API access is approved; WhatsApp channels have no posting API (posts are prepared for manual posting).
- Edit locks with presence ("X is editing") on top of the existing optimistic versioning.
- Market data provider for the ticker (`/public/markets` returns placeholders).
- Headless rendering (`html_js`) for sources that need JavaScript.
- Editable prompt templates in the CMS (they are versioned in `prompt_templates` already).
