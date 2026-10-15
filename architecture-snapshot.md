# B4 NEW'S: architecture snapshot

**Status: binding. Fixed on 2026-10-13, at about half of the planned development.**

This file records the structure of the project and the conventions its code follows. Every new
piece of code and every new request follows it:

- new code goes where this file says it goes;
- it is written the way this file says code is written here.

If a request doesn't fit, the structure is not bent quietly. The change to this file is proposed
first, approved by the owner, and made in the same commit as the code, with the reason.

How the system works at runtime lives in other documents, which this one doesn't repeat:

| Document | What it covers |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Data flow, the newsroom process, AI, security |
| [docs/API.md](docs/API.md) | The endpoints |
| [docs/WORKFLOW.md](docs/WORKFLOW.md) | The workshop and live environments, releases, data safety |

---

## 1. The system in one paragraph

B4 NEW'S is a Hebrew, right-to-left economic news platform with four faces:

- a **public site** for readers;
- a **mobile app** for readers;
- a **newsroom CMS** where editors find articles on other sites, have the AI rewrite them,
  edit, illustrate and publish;
- **distribution** to social networks, push notifications and the newsletter.

One TypeScript monorepo (npm workspaces) holds all of it. One API is the only process that
touches the database and the outside world. Every part shares the same contracts from
`packages/shared`.

---

## 2. Folder map

```
b4-news/
├── apps/
│   ├── api/        THE BACKEND: the only code that touches the database, AI, scraping,
│   │               social networks, email and push. Fastify + zod + Drizzle.
│   ├── web/        THE PUBLIC SITE (readers): Next.js App Router, server-rendered with ISR.
│   ├── admin/      THE NEWSROOM CMS (editors): Next.js, a client-side app over /api/v1/admin.
│   └── mobile/     THE APP (readers, iOS/Android): Expo Router.
├── packages/
│   ├── shared/     CONTRACTS: zod schemas and their types, the article document format,
│   │               constants (categories, roles, statuses). Used by all four apps.
│   └── db/         DATA: the Drizzle schema, SQL migrations, seeds, the migration check.
├── scripts/
│   ├── live.mjs    The live environment and releases, on a computer or the cloud server
│   │               (see docs/WORKFLOW.md).
│   └── cloud.mjs   The cloud server, operated from the workshop computer through gcloud:
│                   create, setup, values, the tunnel, moving the data, releases.
├── deploy/
│   └── cloud/      How the cloud server is built and run: setup.sh (first install),
│                   systemd units (start at boot, watchdog, nightly backup), the Ops Agent
│                   config, set-env.mjs; README.md has the steps.
├── docs/           ARCHITECTURE · API · WORKFLOW · NEXT-STEPS.
├── brand/          Logo and brand sources (SVG, Facebook covers, generator scripts);
│                   apps/*/public/brand hold copies.
├── .github/workflows/ci.yml   The checks on every push (same gate as a release).
├── docker-compose.yml         Optional local PostgreSQL (the default is embedded PGlite).
├── architecture-snapshot.md   This file.
├── CLAUDE.md                  Points AI assistants to this file.
├── package.json               Workspaces, root scripts, dependency overrides (one React).
└── tsconfig.base.json         The shared strict TypeScript settings.
```

Two folders sit outside the repository and are never edited by hand:

- `../b4-news-live`: the live environment (its own data, releases and backups). On the cloud
  server it is `/srv/b4/live`, with its database in PostgreSQL and its media in the R2 bucket.
- `.data/`: the workshop's local database and media (git-ignored).

`deploy/` and `scripts/cloud.mjs` were added on 2026-10-14 with the owner's approval: the live
site moves to a Google Cloud server, and how that server is built and operated must be
repeatable from files rather than done by hand.

### 2.1 `apps/api/`: the backend

```
src/
  app.ts            buildApp(): plugins, the error format, route registration, media serving
  server.ts         Process entry: config, migrations, seeds, the inline job runner, clean shutdown
  worker.ts         A job runner without HTTP (scale-out against PostgreSQL)
  config.ts         Every environment variable, validated with zod; refuses unsafe production settings
  errors.ts         AppError (status, code, a Hebrew message that is safe to show) and errors.* helpers
  plugins/          security.ts (helmet, CORS, rate limits, the CSRF Origin check) · auth.ts (sessions, roles)
  routes/           HTTP only. One plugin per domain:
                      the public ones directly here, the CMS ones in routes/admin/ (registered in admin/index.ts)
  services/         Domain logic (no HTTP). One file or folder per domain:
    context.ts        Services = { db, config, settings, ai, storage, fetch, mailer, capture, log }, wired once
    handlers.ts       Job kind → handler: the only place that maps queued work to code
    ai/               AiHub and providers (Anthropic text; Gemini images, video and the visual agent; Google Vision's
                        reverse image search;
                        development stand-ins), types
    agent/            The newsroom agent and the agent team: tools over the services, chat, model engine,
                        the team (team.ts: who the agents are, their models and usage), their skills
                        (skills.ts: versions in prompt_templates), editor-agent settings, the visual agent
                        (visual.ts: image and reel prompts, and its learning), the social editor (social.ts:
                        its settings, and the corrections it learns from), the research reporter (researcher.ts:
                        its settings, and which source may back a fact)
    scraper/          Discovery: parse, collect, robots, autodetect, setup, run, test-source
    drafts.ts         Selections → drafts, AI rewrite/refine/images, autosave, finalize, reading models
    image-brief.ts    What image generation is asked for (the article, the brief, a reference)
    legal-review.ts   The legal review of every final text: the risks, the decisions, the safer wording
    research.ts       The research reporter: a link, screenshots or an idea → a research file → an article from it; proof of the sources
    official-sources.ts   The official-sources registry: bodies, their domains and verified accounts; the weekly check
    editorial-meeting.ts  The editorial meeting: discovery's topics → story pitches; an approved pitch becomes an idea research;
                      the morning meeting (a recurring job, live only) that emails the admins
    publish.ts        Preview, final approval, the publish job
    social*.ts        Distribution: the distribution plan before publishing (social-plan.ts), the social
                        package, network adapters, the social page, branded designs, reels
    newsletter.ts · digest.ts (the personal issue) · feed.ts (the reader's feed) · consent.ts ·
      translate.ts · learning.ts · classify.ts
    article-transfer.ts · workshop-copy.ts   Moving articles, and a safe copy of the live data, between environments
    data-move.ts      The computer's live data to the cloud, once (the database as SQL, the media into the bucket)
    settings.ts · site-settings.ts · legal-pages.ts · connection-tests.ts
  lib/              Generic building blocks without newsroom knowledge:
                      jobs (the queue), safe-fetch (SSRF guard), storage (local disk or the R2 bucket),
                      images (renditions), google-auth (the server's own Google Cloud token), mailer,
                      crypto, secret-box, password, audit, similarity, facts, moderation, markets, cards, text-diff,
                      page-capture (a screenshot, or the links, of a public page with the machine's own browser),
                      social-links (which network account a link is)
  cli/              Command-line entry points (create-admin, live-db)
  dev/              Development only: sample news sites, illustrations, dev seeds
test/               vitest integration tests (one file per area) + helpers.ts
scripts/            Dry-run helpers for setting up real sites (they never save anything)
mcp/                The stdio MCP server for the Claude app (dependency-free .mjs)
assets/fonts/       Fonts for server-side image rendering (with their licenses)
```

### 2.2 `apps/web/`: the public site

```
app/              Routes (App Router): home, article/[slug], category/[slug], search, markets,
                    account, my (the reader's feed), newsletter/*, report, [page] (info pages), a/[id] (short links),
                    api/revalidate (cache refresh after publishing), sitemap.ts, robots.ts
components/       Flat, one file per piece of UI: header, footer, hero, carousels, comments,
                    sidebar, share…; primitives in ui.tsx; hooks named use-*.ts
lib/              api.ts (server-only reads with cache tags) · client-api.ts (browser calls: comments,
                    sign-in) · site.ts (site constants, link builders) · format.ts · markets.ts · types.ts
public/brand/     Logo files
```

### 2.3 `apps/admin/`: the newsroom CMS

```
app/(cms)/        One folder per CMS screen, behind the sign-in shell ((cms)/layout.tsx):
                    page.tsx (dashboard) · discovery/ (Israeli sites, international/, runs/) · sources/
                    saved/ · magazines/[id] (+ preview) · drafts/[id] (+ preview) · review/ · manual/
                    social/ · comments/ · takedowns/ · learning/ · agent/ · settings/
app/login/        Sign-in
components/       Shared screens and the shell; feature folders: editor/, settings/, social/, agent/, review/, research/
                    primitives in ui.tsx (Button, Card, Field, Badge, Loading, ErrorBox, Empty,
                    PageHeader, Thumb, inputClass, cx, useToast)
lib/              api.ts (the only way to call the server) · auth.tsx (session, useCan) ·
                    labels.ts (every Hebrew label for statuses, colors, platforms…)
```

### 2.4 `apps/mobile/`: the app

```
src/app/          Screens only (Expo Router): (tabs)/ (home, my feed, categories, saved, search),
                    article/[slug], category/[slug], a/[id], account, _layout.tsx
src/components/   UI pieces (top bar, tabs, article body, comments, welcome…)
src/lib/          api.ts · token.ts (Bearer token in secure storage) · push.ts · saved.ts ·
                    consent.ts · theme.ts · format.ts
AGENTS.md         Expo rules (versioned docs, `npx expo install`); binding inside apps/mobile
```

### 2.5 `packages/shared/` and `packages/db/`

```
shared/src/       One file per domain, all re-exported by index.ts:
                    categories · content (public shapes) · comments · auth · cms (CMS DTOs and inputs) ·
                    settings (integrations, site settings) · legal · social · agent · doc (article body format)
shared/test/      Tests of the pure logic (the document sanitizer and renderer)
db/src/           schema.ts (every table, in sections) · client.ts (createDb: memory: | pglite:<dir> | postgres://)
                    seed.ts (reference data, prompts, development sample content) · scripts/ (migrate, seed, check-migrations)
db/drizzle/       Generated SQL migrations + meta/ (journal, snapshots). Append-only.
```

---

## 3. Domains: where each part of the business lives

| Domain | API | CMS | Site / app | Main tables |
| --- | --- | --- | --- | --- |
| **Discovery and sources** (איתור כתבות) | `services/scraper/*`, `routes/admin/sources.ts`, `discovery.ts` | `discovery/`, `sources/` | | `sources`, `scrape_runs`, `scrape_run_items`, `scraped_items` |
| **Newsroom editing** | `services/drafts.ts`, `image-brief.ts`, `legal-review.ts` (the legal review before publishing), `research.ts` (the research reporter), `editorial-meeting.ts`, `lib/similarity.ts`, `lib/facts.ts`, `lib/page-capture.ts`, `routes/admin/drafts.ts`, `review.ts`, `research.ts`, `media.ts` | `saved/`, `magazines/`, `drafts/`, `review/`, `manual/` (its tabs: from a link or screenshots, an idea, the editorial meeting, writing), `components/editor/`, `components/review/`, `components/research/` | | `magazines`, `article_drafts`, `draft_revisions`, `draft_reviews`, `research_tasks`, `editorial_meetings`, `official_sources`, `image_batches`, `media_assets` |
| **AI** | `services/ai/*`, `translate.ts`, `learning.ts`; prompts in `prompt_templates` | `learning/` | | `ai_jobs`, `prompt_templates`, `style_*`, `learning_reports` |
| **Newsroom agent and the agent team** | `services/agent/*` (chat, the team and their skills, editor agent, social editor, visual agent), `routes/admin/agent.ts`, `mcp/` | `agent/` (the chat), the "צוות הסוכנים" tab of `settings/`, `components/agent/` | | `agent_conversations`, `agent_messages`, `staff_api_tokens`, `prompt_templates` (the skills), `visual_feedback`, `visual_profiles` |
| **Publishing** | `services/publish.ts`, `articles.ts` (published articles: edit in place, remove, restore, delete), `article-content.ts` (draft → article), `article-transfer.ts` (articles from one environment to another), `routes/admin/articles.ts` | the preview pages, `articles/` ("כתבות באתר") | `app/api/revalidate` | `articles`, `article_tags`, `homepage_slots`, `publish_jobs` |
| **Distribution** (הפצה) | `services/social*.ts`, `newsletter.ts`, `digest.ts` (the personal issue at the reader's hour, a self-rescheduling job), push in `publish.ts`, `routes/admin/social.ts`, `routes/audience.ts` | `social/`, `components/social/`, `editor/social-panel.tsx` | newsletter pages (incl. preferences), "העיתון שלי" in account, app `lib/push.ts` | `social_*` (incl. `social_plans`), `article_share*`, `newsletter_subscribers`, `devices`, `push_notifications` |
| **Reader content** | `routes/content.ts`, `routes/site.ts`, `lib/cards.ts` | | `apps/web/app`, `apps/mobile/src/app` | `articles`, `categories`, `authors`, `tags` |
| **Audience and community** | `routes/comments.ts`, `reader-auth.ts`, `admin-comments.ts`, `takedowns.ts`, `routes/admin/audience.ts`, `services/consent.ts`, `audience.ts` (readers and subscribers for the CMS), `reader-signin.ts` (the code and the one-click link), `comments.ts` (threads, likes, the editors' pick), `notifications.ts` (the bell, phone pushes, the hourly mail), `feed.ts` (the reader's feed), `lib/expo-push.ts` | `comments/`, `takedowns/`, `audience/` ("מנויים וגולשים") | comments, the bell, account (notification settings), `my/` (the feed), report; app comments, account and the "הפיד שלי" tab | `readers`, `comments`, `comment_reports`, `comment_likes`, `reader_notifications`, `consents`, `takedown_requests`, `newsletter_subscribers` |
| **Settings and integrations** | `services/settings.ts`, `site-settings.ts`, `legal-pages.ts`, `connection-tests.ts`, `routes/admin/settings.ts` | `settings/`, `components/settings/` | info pages, footer | `app_settings`, `secrets`, `social_accounts` |
| **Platform** | `lib/*`, `plugins/*`, `config.ts`, `server.ts`, `worker.ts`, `cli/*`, `services/workshop-copy.ts` (a safe copy of the live data for the workshop), `services/data-move.ts`, `services/two-factor.ts` + `lib/totp.ts` (staff two-step sign-in), `routes/staff-auth.ts`, `routes/admin/security.ts`, `scripts/*`, `deploy/cloud/*` | `components/shell.tsx`, `lib/api.ts`, `lib/auth.tsx` | `lib/api.ts` in each app | `users`, `sessions`, `jobs`, `audit_log` |

---

## 4. Dependency rules

1. **The direction is fixed:**
   - apps may depend on packages;
   - `packages/db` may depend on `packages/shared`;
   - `packages/shared` depends only on zod;
   - nothing depends on an app.
2. **Only `apps/api` touches the outside world.** That means the database, AI providers, scraped
   sites, social networks, email and push. The site, CMS and app reach data only through the
   HTTP API (`/api/v1`).
3. **Inside the API, `routes → services → (lib, @b4/db)`:**
   - routes do HTTP work only: validate, check the role, call a service, return a DTO;
   - services never import routes or Fastify;
   - `lib/` never imports services.
4. **Shapes are defined once, in `@b4/shared`.** The API validates against them, and the
   clients import their types. The site re-exports them through `lib/types.ts`. Never
   redeclare a shape by hand.
5. **Environment variables are read in one place per app:**
   - API: `config.ts` (process entry points may read process-level settings);
   - site: `lib/api.ts`, `lib/site.ts`, `next.config.mjs`, route handlers;
   - CMS: `lib/api.ts`, `next.config.mjs`;
   - app: `lib/api.ts`.
6. **Background work is a job.** Anything slow or external (AI, scraping, publishing, posting,
   translation, learning) runs as a job (`enqueue` → `services/handlers.ts`), never inside a
   request.
7. **External access goes through the service objects:**
   - URLs: `s.fetch` (SSRF guard, robots);
   - screenshots of web pages: `s.capture` (`lib/page-capture.ts`: the machine's own browser,
     every request it makes held to the same public-address rule as `safeFetch`). Added on
     2026-10-15 with the owner's approval: the research reporter keeps a picture of every source
     as proof, which a plain fetch can't make;
   - AI: `s.ai` (wrapped in `tracked()`);
   - files: `s.storage`;
   - email: `s.mailer`;
   - keys and settings: `s.settings`.

---

## 5. Conventions

### 5.1 Language and direction

- **English** for code identifiers, comments, docs and commit messages.
- **Hebrew** for everything a person sees in the product:
  - UI text, written in place (there is no i18n layer);
  - the `message` of every `AppError`;
  - emails and push text.
- CMS labels for enums live in `apps/admin/lib/labels.ts`.
- **The agents' skills (their prompts) are written in Hebrew** and require Hebrew output, so the
  owner can read and edit them. They are stored in `prompt_templates` (seeded in
  `packages/db/src/seed.ts`), shown and edited in the CMS ("הגדרות" > "צוות הסוכנים") with
  every version kept, and a release never replaces a skill an admin wrote. Exceptions, in
  English on purpose: the templates sent to the image and video models (`reel.image`,
  `reel.video`), and the technical output rules inside the code (JSON fields, limits).
  Changed at the owner's request on 2026-10-14 (until then the instructions were English).
- **Every writing agent reads the newsroom rules** (`newsroom.rules`, through `writerPrompt`)
  after its own skill, and the code adds the fixed rules no skill can turn off
  (`NEWSROOM_FIXED_RULES` in `@b4/shared`). A new writing agent does the same.
- **Image and video prompts the editor sees are Hebrew.** The editor reads, edits and approves
  them in Hebrew, and the system sends the model an English translation of the approved text
  (`TextAI.toEnglish`, the fast model). Changed at the owner's request on 2026-10-13.
- **Who writes what:** Claude (`s.ai.text()`) writes the articles and the social text. The
  visual agent, Google Gemini (`s.ai.visual()`, `services/agent/visual.ts`), writes the
  descriptions for article images and the reel prompts. It learns from the editors' choices
  into versioned rules (`visual_profiles`), the way the house style is learned. Decided by the
  owner on 2026-10-13: the owner manages it from the CMS ("הגדרות" > "צוות הסוכנים" > "סוכן
  התמונות והווידאו"; every agent's settings moved there on 2026-10-14, and "סוכן AI" keeps only
  the chat with the chief editor and the Claude app connection).
- **Every article passes the legal review before it is published.** When its text is marked
  final, the reviewer (`services/legal-review.ts`) looks for the risks a person must decide on,
  and publishing waits until each one is decided (and recorded with who decided). Changing a
  final text on the review's behalf goes through `amendFinalText` in `drafts.ts`. Only an admin
  turns the review off. Decided by the owner on 2026-10-14.
- **A researched article rests on official sources only.** The research reporter
  (`services/research.ts`) may base a fact only on an official source, the subject's own
  channel, or a source on the newsroom's approved list; news sites only lead to the source, and
  the code marks down a detail whose source doesn't qualify, whatever the model said. The article
  is written from the research file alone and ends with the sources by name, without links; the
  CMS keeps a copy and a screenshot of every source. Searches cost money: one attempt per
  research, quick by default, and a monthly budget. Decided by the owner on 2026-10-14.
- **The editorial meeting only proposes.** The chief editor (`services/editorial-meeting.ts`)
  pitches stories from what discovery found (topics grouped for free, one AI call without
  search); a person approves each pitch before it is researched, and a pitch that grew from no
  discovered topic is dropped. Decided by the owner on 2026-10-14.
- **Who decides how an article goes out:** the social editor (Claude, the fast model,
  `services/social-plan.ts`) chooses the frame, the post and the story when the text is marked
  final, and only recommends a reel. A person approves a reel (it costs a video), and its video
  again before it goes out. The options it chooses from are generated from the code, never
  listed by hand in a prompt. Decided by the owner on 2026-10-14.
- **Right to left:** "start" is the right side.
  - The site and the CMS set `dir="rtl"` on `<html>`, plus the editor canvas.
  - The app sets direction in its component styles.

### 5.2 Names and files

| What | Convention | Example |
| --- | --- | --- |
| Files | kebab-case | `hero-carousel.tsx`, `safe-fetch.ts` |
| React components | PascalCase, named exports (default export only where Next/Expo require it) | `export function HeroCarousel` |
| Hooks | `use-*.ts` exporting `useX` | `use-drag-scroll.ts` |
| Functions and variables | camelCase, verb first for actions | `requestImages`, `runDiscovery` |
| Constants | SCREAMING_SNAKE | `INTERVAL_MS`, `PAGE_SLUGS` |
| Value lists | `as const` arrays in shared; zod enums and `pgEnum` built from them | `STAFF_ROLES` |
| zod schema + type | The same name | `export const ArticleCard = z.object(…); export type ArticleCard = z.infer<typeof ArticleCard>` |
| Contracts | `XxxDto` (CMS read), `XxxInput` (request body), `XxxResult` (action result); public shapes are plain nouns | `DraftDetail`, `GenerateImagesInput`, `HomeData` |
| Job kinds | `domain.action`, exported constant when used in several files | `draft.rewrite`, `KIT_JOB` |
| API paths | `/api/v1/public/*` (cacheable, no auth) · `/auth/{reader,staff}/*` · `/admin/*` (staff); kebab-case; actions as `POST` sub-paths | `POST /admin/drafts/:id/rewrite-copied` |
| Cache tags | Fixed vocabulary | `home`, `site`, `search`, `markets`, `category:<slug>`, `article:<id>`, `article-slug:<slug>` |
| Tables and columns | snake_case in SQL, camelCase in TypeScript (Drizzle `casing`); plural table names | `article_drafts.hero_media_id` ↔ `heroMediaId` |
| IDs | uuid. Published articles have a numeric id for short links (`/a/<id>`) | |

### 5.3 How code is written

- **TypeScript strict** (`tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`), ESM.
  Avoid `any`; cast only at a boundary, deliberately.
- **Style:**
  - 2 spaces, single quotes, semicolons, trailing commas, long lines are fine;
  - there is no formatter config, so match the surrounding code;
  - imports go `node:` built-ins first, then packages, then local files, with `type` imports
    marked.
- **Comments:**
  - each file opens with one or two lines on what it is and why;
  - comments explain *why* (a constraint, a decision), not what the next line does;
  - `/** … */` on exported functions and on fields whose meaning isn't obvious.
- **Small, plain functions** with `s: Services` as the first argument in services.
  No classes for domain logic. Classes are for providers and infrastructure (`SettingsStore`,
  `GeminiImages`, `JobRunner`).
- **No module-level singletons** in the API. Everything comes from `Services`, so tests can
  swap any piece.

### 5.4 API patterns

- **Route plugin per domain:**
  `export const xRoutes: FastifyPluginAsyncZod<{ s: Services }> = async (app, { s }) => { … }`.
  Register it in `app.ts` (public) or `routes/admin/index.ts` (CMS).
- **Every route declares its schema** (`params`, `querystring`, `body`, `response`) with
  schemas from `@b4/shared`.
- **Inside a handler:**
  - check identity with `requireStaff(req, ...roles)` or `requireReader(req)`;
  - call one service function;
  - return the DTO;
  - record changes that matter with `audit(...)`;
  - put tighter `config: { rateLimit }` on expensive endpoints.
- **Errors:** throw `AppError(status, code, hebrewMessage)` or `errors.*`. The client always
  receives `{ code, message }`. Never send a raw error.
- **Jobs:**
  - `enqueue(db, 'kind', payload, { draftId, createdBy, maxAttempts })`;
  - each handler has `run`, plus `onFailed` (to put domain state back in order) and
    `maxAttempts`;
  - throw `PermanentJobError` when a retry can't help;
  - handlers must be safe to run twice.
- **AI:**
  - `await s.ai.text()` / `image()` / `video()` / `visual()` inside `tracked(...)` (cost and
    errors go to `ai_jobs`);
  - output is validated with zod;
  - untrusted text (scraped articles, comments) is passed as marked data;
  - providers implement `TextAI` / `ImageAI` / `VideoAI` / `VisualAI` (`services/ai/types.ts`),
    with a development stand-in for each.
- **Configuration:**
  - every new environment variable goes into `config.ts` (validated, with production guards)
    and `.env.example`;
  - a key the owner enters goes into `INTEGRATIONS` (`shared/settings.ts`) and is stored
    encrypted through `SettingsStore`;
  - keys are never returned to a browser.
- **Content:**
  - article bodies are the whitelisted document format (`sanitizeDoc`);
  - published HTML comes only from `docToHtml`;
  - untrusted HTML is never rendered.

### 5.5 Database

- **Change the schema in `schema.ts`, then generate the migration:**
  - run `npm run db:generate`;
  - commit the generated SQL with the snapshot;
  - never write a migration's number or journal entry by hand.
- **Migrations only add** (expand, then contract in a later release):
  - `npm run db:check` refuses DROP, DELETE, TRUNCATE, RENAME, type changes and SET NOT NULL
    unless the line above says `-- data-safe: <reason>`;
  - a migration that went live is never edited.
- **Reference data** (categories, prompts) is seeded idempotently. Sample content exists only
  in development.

### 5.6 The site (`apps/web`)

- **Server components by default.** Use `'use client'` only for interaction (carousels, forms,
  comments, consent).
- **Data access:**
  - reads go through `lib/api.ts` (server-only, with cache tags and `revalidate`);
  - browser calls go through `lib/client-api.ts`;
  - a non-critical outage (market data) must never take a page down.
- **Styling:**
  - Tailwind v4 with the brand tokens in `app/globals.css` (`brand`, `ink`, `muted`, `line`,
    `stone`, `night`…), not raw colors;
  - shared pieces come from `components/ui.tsx` (`wrap`, `SectionHeader`, `ArticleImage`,
    `CategoryTag`…);
  - fonts are Heebo (text) and Rubik (headings).
- **Images:**
  - `next/image` with the configured hosts;
  - the hero rendition for large slots.
- **Accessibility:** visible focus, Hebrew `aria-*` labels, and motion that stops for
  `prefers-reduced-motion`.

### 5.7 The CMS (`apps/admin`)

- **A client app:**
  - screens live under `app/(cms)/<feature>/page.tsx`;
  - the shell and sign-in guard are in `(cms)/layout.tsx`;
  - roles are checked in the UI with `useCan(role)`, and enforced by the API.
- **Server state uses TanStack Query:**
  - reads: `useQuery({ queryKey: ['entity', id], queryFn: () => admin.get<Dto>(…) })`;
  - writes: `useMutation` with `onError: (e) => toast(errorMessage(e), 'danger')`, then
    invalidate the affected keys.
- **Every call goes through `lib/api.ts`** (`admin.get/post/put/patch/upload`). Never call
  `fetch` directly.
- **UI comes from `components/ui.tsx`.** A feature with several components gets a folder under
  `components/` (`editor/`, `settings/`, `social/`, `agent/`).

### 5.8 The app (`apps/mobile`)

- **`src/app` holds screens only.** Components go in `src/components`, logic in `src/lib`.
- **Follow `apps/mobile/AGENTS.md`:** the Expo docs for the installed SDK, and
  `npx expo install` for packages.
- **Readers authenticate with a Bearer token** kept in secure storage (`lib/token.ts`), never
  with cookies.
- **Colors and spacing come from `lib/theme.ts`.**

### 5.9 Tests

- **API:** vitest integration tests in `apps/api/test/<area>.test.ts`:
  - built through `app.inject` on PGlite in memory, with `setup()` from `helpers.ts`;
  - AI, storage and email are stand-ins;
  - `ctx.drain()` runs the queued jobs;
  - there is no network, except `safe-fetch`'s own test.
- **Shared logic:** `packages/shared/test`.
- **Test names are plain sentences about behavior**, e.g. "waits for approval before a
  change, and runs it only when approved".
- **What needs a test:** every new route or service behavior gets one, and every bug fix gets a
  test that would have caught it.
- **`npm run check`** (types, tests, migration check) must pass before a commit. It is the
  same gate a release runs.

### 5.10 Security in every change

- Validate all input with zod.
- Check the role.
- Audit sensitive actions.
- Rate-limit costly endpoints.
- Fetch outside URLs only through `safeFetch`.
- Store secrets only through `SettingsStore` or `config.ts`.
- Keep personal data out of URLs and logs.
- Make error messages safe to show.

### 5.11 Working on the project

- **Workshop and live are separate:**
  - develop with `npm run dev`;
  - only committed work reaches the live site, through `npm run release`
    (docs/WORKFLOW.md).
- **Commits are small and coherent:**
  - the subject is English, `Area: what changed` (e.g. `Images: Google Gemini (Nano Banana)
    instead of OpenAI`);
  - the body says why;
  - never commit someone else's unfinished work.
- **One task per branch and folder (worktree)** when several sessions or people work at once.
- **Docs change with the code:**
  - ARCHITECTURE.md for how something works;
  - API.md for endpoints;
  - WORKFLOW.md for the process;
  - this file only for a deliberate change of structure or conventions.

---

## 6. Recipes: where something new goes

- **New data for readers:**
  1. the shape in `shared/src/content.ts`;
  2. the route in `routes/content.ts`;
  3. the site: `lib/api.ts` (with a cache tag), then the page or component;
  4. the app: `lib/api.ts`, then the screen;
  5. if publishing changes it, revalidate the tag.
- **New CMS feature:**
  1. DTO and input in `shared/src/cms.ts` (or the domain's file);
  2. a function in the domain's service;
  3. a route in `routes/admin/<domain>.ts`, registered in `admin/index.ts`;
  4. a screen in `app/(cms)/<feature>/`, with components in `components/<feature>/`;
  5. labels in `lib/labels.ts`;
  6. a test.
- **New background work:**
  1. a `run…` function in the domain's service;
  2. an entry in `services/handlers.ts`;
  3. `enqueue` from the service that starts it;
  4. a test that drains the queue.
- **New table or column:**
  1. `schema.ts`;
  2. `npm run db:generate`;
  3. `npm run db:check`;
  4. a test that uses it.
- **New external service:**
  1. the integration in `shared/settings.ts`;
  2. its environment fallback in `config.ts` and `services/settings.ts`;
  3. a connection test in `connection-tests.ts`;
  4. the provider in its domain folder (e.g. `services/ai/`);
  5. a stand-in for development and tests.
- **New environment variable:** `config.ts`, then `.env.example`, then (for the live
  environment) `scripts/live.mjs`.
- **New dev-only tool:** `apps/api/scripts/` (dry runs that save nothing) or
  `apps/api/src/dev/`. Never in a path production code imports.

---

## 7. Known deviations

These places don't follow the conventions yet. Don't copy them; fix them when touching that
code.

- `apps/api/src/server.ts` reads `SHUTDOWN_TOKEN` straight from `process.env` (it belongs in
  `config.ts`).
- `apps/mobile/src/app/article/[slug].tsx` builds its own `SITE_URL` from
  `EXPO_PUBLIC_SITE_URL` instead of importing it from `lib/api.ts`.
- `brand/` and the `public/brand/` copies in the apps are kept in sync by hand.
- The rewrite still asks Claude for an English `image_prompt` (`article_drafts.image_prompt`),
  which nothing uses since the visual agent writes the descriptions. Drop it with the next
  version of the `rewrite.system` prompt.
- `apps/admin/app/(cms)/comments/page.tsx` declares its comment shape locally instead of in
  `@b4/shared`.
- The editor's older social package (`services/social.ts`, `social_packages`, `social_posts`,
  `/admin/drafts/:id/social*`) is no longer shown in the CMS since the distribution plan
  (2026-10-14); it stays only so packages approved before it still go out. Don't build on it;
  remove it in a later release.
