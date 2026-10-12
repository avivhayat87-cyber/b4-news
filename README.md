# B4 NEW'S

News platform: public site, mobile app, and an AI-assisted newsroom CMS. "B4" reads "before".

```
apps/web/       Public site: Next.js 15 (App Router, SSR/ISR), Tailwind v4       :3000
apps/admin/     Newsroom CMS: Next.js, TipTap canvas, TanStack Query             :3001
apps/api/       API + background jobs: Fastify 5, Drizzle, zod                    :4000
apps/mobile/    App: Expo SDK 57 (iOS, Android; web build for preview)            :8081
packages/db/    Database schema, migrations, seeds (PostgreSQL; PGlite locally)
packages/shared/ Types and validation shared by all of the above (zod)
brand/          Seal logo files and icon renderer
docs/           ARCHITECTURE.md (start here), API.md, NEXT-STEPS.md
```

## Run everything locally

Needs Node.js 20.18+ only. No database or Docker install: the API embeds PostgreSQL (PGlite) and stores it in `.data/`.

```bash
npm install
```

```bash
npm run dev
```

This starts the API (http://localhost:4000), the site (http://localhost:3000) and the CMS (http://localhost:3001).
On the first start the API creates a development admin and writes its password to `.data/dev-admin.txt`.

The app: `npm run dev:app`, then press `w` for the web build or scan the QR code with Expo Go.

### What works out of the box

- Sample articles on the site and in the app.
- Three made-up sample news sites served by the API (`/dev/sites/*`): an RSS feed, an HTML listing page and a news sitemap.
  Each publishes a new article every 10 minutes, so "איתור כתבות" shows the delta fetch in action.
- AI stand-ins: without API keys, rewriting is simulated and images are abstract placeholders, and the CMS says so in a banner.
  Add `ANTHROPIC_API_KEY` (text) and `OPENAI_API_KEY` (images) in `apps/api/.env` for the real thing.
- Social posts are prepared but not sent until an account has a token (`SOCIAL_SECRET_<NAME>`, see `apps/api/.env.example`).

## The newsroom process (CMS)

1. **הגדרות אתרים**: an editor adds a site (name + link); the developer gets an email, builds the trigger (RSS / sitemap / HTML selectors), tests it against the live site and approves it.
2. **איתור כתבות**: one click fetches only what was published since the last run, from every active site. Every run is kept with its date and count; an article from an older run can be moved into the latest one.
3. Results are grouped by section with source, thumbnail, headline and first paragraph. Tick articles, then **save as a magazine** (or as single articles with a color label) in **עריכות שמורות**.
4. **The editor**: the original (read-only) beside the canvas. The AI has already written its own version "as an external reporter" and 4 images. Ask the AI for changes in the chat (on a selected passage, or the whole article), edit by hand; everything autosaves. Choose main / trending / section, tags, byline, push. "Not for publishing" sets an article aside.
5. **Social networks** open after the text is marked final: a story image different from the article image, a headline and two sentences; regenerate, edit, upload, or comment to the AI. On Facebook, Instagram and X the link goes in the first comment.
6. **Preview and final approval**: every article with its date, editor and tags. Publishing goes to the site first, then to the networks; each correction goes back to the AI (see **למידת ה-AI**).

## Commands

```bash
npm run typecheck          # all workspaces
npm test                   # API (PGlite in memory) and shared tests
npm run db:generate        # new migration after editing packages/db/src/schema.ts
npm run create-admin -w @b4/api -- --email you@example.com --name "Your Name" --role admin
```

Stop the API before `create-admin` when using the local database (PGlite allows one process).

## Configuration

Each app has a `.env.example`. Production needs at least: `DATABASE_URL` (PostgreSQL), `HASH_PEPPER`, `SMTP_URL`,
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `REVALIDATE_SECRET` (same value in the API and the site), `CORS_ORIGINS`,
`PUBLIC_SITE_URL`, `PUBLIC_API_URL`, `MEDIA_BASE_URL`. The API refuses to start in production with unsafe settings.
