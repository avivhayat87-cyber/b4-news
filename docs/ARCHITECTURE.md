# Architecture

One TypeScript monorepo (npm workspaces). Every part shares the same types and validation from `packages/shared`, so a change to a contract is a compile error everywhere it matters.

```
                 ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
  readers ──────▶│ apps/web     │   │ apps/mobile  │   │ apps/admin   │◀── newsroom
                 │ Next.js SSR  │   │ Expo         │   │ Next.js CMS  │
                 └──────┬───────┘   └──────┬───────┘   └──────┬───────┘
                        │ /public/*        │ /public/*         │ /admin/* (staff cookie)
                        │                  │ Bearer (comments) │
                        ▼                  ▼                   ▼
                 ┌──────────────────────────────────────────────────────┐
                 │ apps/api  Fastify · zod · Drizzle                     │
                 │  routes ─▶ services ─▶ db                             │
                 │  job runner (inline, or `npm run worker` processes)   │
                 └──────┬──────────────────┬───────────────┬────────────┘
                        ▼                  ▼               ▼
                 PostgreSQL          media files      Anthropic · Gemini (key or Vertex AI)
                 (PGlite locally)    (disk / R2)      Meta Graph · Telegram · Expo push
```

## Packages

| Path | What | Notes |
| --- | --- | --- |
| `packages/shared` | zod schemas + types: categories, public content, comments, auth, CMS contracts (`cms.ts`), the article body format (`doc.ts`) | Shipped as TS source; Next transpiles it |
| `packages/db` | Drizzle schema (`src/schema.ts`), migrations (`drizzle/`), seeds | `createDb(url)`: `memory:`, `pglite:<dir>` or `postgres://` |
| `apps/api` | Fastify API, background jobs, scraper, AI, publishing | `src/routes` (HTTP) → `src/services` (domain) → `@b4/db` |
| `apps/web` | Public site | ISR with cache tags; the API calls `/api/revalidate` after publishing |
| `apps/admin` | CMS | Client app; talks to `/api/v1/admin` with the staff cookie |
| `apps/mobile` | iOS/Android app | See `apps/mobile/README.md` |

## API layout (`apps/api/src`)

```
app.ts            buildApp(): plugins, error format, route registration, media serving
server.ts         process entry: config, migrations, seeds, inline job runner
worker.ts         standalone job runner (production scale-out, needs PostgreSQL)
config.ts         every environment variable, validated; refuses unsafe production settings
plugins/          security (helmet, CORS allowlist, rate limits, CSRF origin check), auth (sessions)
routes/           public content, comments, reader/staff auth, audience, admin/* (the CMS)
services/
  context.ts      Services = { db, config, settings, ai, storage, fetch, mailer, capture, log }, built once (createServices)
  settings.ts     SettingsStore: CMS-managed settings and encrypted secrets (30 s cache); integration values = CMS, then env
  site-settings.ts public links, contact details and info pages (defaults included)
  connection-tests.ts  the "test connection" calls (Anthropic, Gemini, SMTP, the Meta app, Telegram, Facebook/Instagram incl. the token's expiry)
  social-accounts.ts   the accounts posts go to; a pasted personal Meta token → long-lived (the app's secret) → the page's own token from me/accounts, which never expires
  scraper/        parse (RSS/Atom, sitemap, HTML, article incl. JSON-LD), collect (delta, canonical URLs, sitemap indexes),
                  robots (robots.txt), autodetect + setup (feed discovery from a link), run, test-source
  drafts.ts       selections → drafts, AI rewrite/refine/images, autosave, finalize/skip, reading models
  research.ts     the research reporter: a link or screenshots → a research file → an article written from it; proof of every source
  social.ts       the social package (headline, 2 sentences, story image, targets, approval)
  social-adapters.ts  Facebook / Instagram / Telegram posting (feed; FB/IG stories); others prepared for manual posting
  social-share.ts the social page: published articles → AI kit → branded post + story → publishing
  social-design.ts    the four branded frames, rendered server-side (sharp + Pango, fonts in assets/fonts)
  translate.ts    language detection; Hebrew headlines after discovery, full translation for the editor
  publish.ts      preview, final approval, publish job (site → revalidate → push → social → learning)
  learning.ts     feedback from AI draft vs. final text; distillation into house-style rules
  handlers.ts     job kind → handler (the only place that maps queued work to code)
  ai/             AiHub resolves TextAI / ImageAI per call (CMS key, env key, or dev stand-ins); cost tracking
lib/              jobs (queue), safe-fetch (SSRF guard), images (renditions), storage, crypto, mailer, …
dev/              development-only sample news sites and seeds
```

Rules of thumb: routes validate input (zod), check the role, call one service function, return a DTO from `@b4/shared`. Services never touch HTTP. Nothing reads `process.env` except `config.ts`.

## The newsroom workflow in data

```
sources ──(discovery.run job)──▶ scrape_runs ─┬─ scrape_run_sources   (per source: since, new watermark, counts, error)
                                              └─ scrape_run_items ──▶ scraped_items (+ scraped_item_payloads)
                                                     found | pulled        url_hash unique, content_hash
scraped_items ──(save selection)──▶ magazines ─▶ article_drafts ─┬─ draft_revisions   (ai_initial, ai_refine, autosave, checkpoint)
                                                                 ├─ ai_chat_messages
                                                                 ├─ image_batches ─▶ media_assets (4 per click; renditions)
                                                                 ├─ draft_reviews (the legal review: risks and decisions; publishing waits for it)
                                                                 ├─ social_plans (the distribution plan; becomes article_shares on publish)
                                                                 └─ social_packages ─▶ social_posts (one per account; older, used when there is no plan)
research_tasks ──(research.run)──▶ article_drafts (origin research; the file stays on the task as proof)
article_drafts ──(publish job)──▶ articles + article_tags + homepage_slots
                                  style_feedback ──(learning.distill)──▶ style_profiles (active one feeds every rewrite)
every AI call ─▶ ai_jobs (provider, model, tokens, latency, error)
```

Draft status: `queued_ai → ai_processing → editing ⇄ text_final → published`, plus `ai_failed` and `skipped`.
The social module opens at `text_final`; reopening the text marks the social package stale.

### The agent team and their skills (CMS > הגדרות > צוות הסוכנים)

The AI work is done by a fixed team (`services/agent/team.ts`): the chief editor (the chat, which runs the others through the tools), the research reporter, the rewrite editor, the legal reviewer, the social editor, the visual agent (Google; one, shared by all), the translator and the learning. Each has **skills**: its instructions, the editable rows of `prompt_templates`, in Hebrew (owner's decision, 2026-10-14), except the two templates sent to the image and video models, which stay English. `services/agent/skills.ts` maps agents to their skill keys, shows every version, lets an admin write a new version (in use at once, audited; the markers the code fills, such as `{{style_rules}}`, must stay) or bring back an older one (copied as a new version under the admin). On every start `seedPrompts` adds any default skill that isn't in the database yet as its key's next version, and makes the newest default the active one only while the active version is itself a default: a skill an admin wrote or restored is never replaced by a release.

Every agent that writes something for publication (rewrite, refine, the research and its article, the social plan and kit, the chief editor) reads, after its own skill, the newsroom rules (`newsroom.rules`, editable; `writerPrompt` in `services/ai/index.ts`), and the code adds the fixed rules no skill can turn off (`NEWSROOM_FIXED_RULES` in `@b4/shared`: no investment advice, no copied wording, no identifying minors or victims). The CMS screen shows the map, each agent's model, its calls, tokens and estimated cost in the period the editor picks (since the start, today, this month, this year, or between two days, Israel time; `/admin/agents/usage`), its skills and its settings. Costs come from `ai_jobs` (`services/ai/prices.ts`): a text call by its tokens at Anthropic's list prices; an image by its model and size at Google's prices, and a reel video by its seconds, both recorded with the call (2026-10-15; earlier images have no price and mark the cost as partial, as does the visual agent's Gemini text model).

### The newsroom agent (CMS > סוכן AI, and the Claude app)

`services/agent/tools.ts` is one list of tools over the CMS services (overview, sites, discovery results, saved edits, a draft with its fact check, published articles, social status, the distribution plans, learning, the research and their files, the editorial meetings; and changes: start discovery, add/approve sites, save for editing, ask the AI to edit, mark final, publish, prepare/post social, change a distribution plan, editor-agent settings, learn now, research a link or an idea, hold a meeting, approve or set aside a pitch). A change that costs money says what it costs on its approval card (a research: its depth and price range). Every tool validates its input (zod) and checks the role like the CMS screens; viewers get read tools only.

- **Chat in the CMS** (`services/agent/chat.ts`): each message is an `agent.turn` job. The model (Claude Opus 5.5 by default, `agent/engine.ts`; a rule-based stand-in without a key) calls tools; read tools run at once, a tool that changes something stops the turn and shows an approve/decline card (`agent_messages`), and the turn continues with all tool results in one message after the decision. The Messages API history is stored append-only in `agent_conversations.history`. Requests use prompt caching, effort `medium`, and the server-side refusal fallback.
- **The Claude app (MCP)**: `apps/api/mcp/b4-news-mcp.mjs` is a dependency-free stdio MCP server the app starts; it lists and calls the same tools through `/admin/agent/tools` with a personal access token (`staff_api_tokens`, `b4s_…`, hash only). A token reaches only those endpoints; tools that change something are annotated `destructiveHint`, so the app asks before running them. The CMS ("חיבור לאפליקציית Claude") creates tokens and shows the config to paste. The config runs `node` from the PATH and the script at `MCP_SCRIPT`: on the live environment that is `b4-news-live/mcp/b4-news-mcp.mjs`, copied there from the running version every time it starts, so neither a release nor a Node update breaks a config already pasted into the app.
- **Editor agent** (`services/agent/editor.ts`): settings in `app_settings` (`agent.editor`): divergence from the source (light/medium/strong), length, voice, standing instructions, appended to every rewrite prompt, with a fixed rule that factual data stays as in the source. `lib/facts.ts` compares numbers, percentages, amounts and years of the source (its Hebrew translation when there is one) with the draft; the editor shows what is missing or added.
- **Social editor** (`services/agent/social.ts`, CMS > הגדרות > צוות הסוכנים > עורך הרשתות): its settings (`agent.social`: write a plan on every final text, send it on publishing, instructions, when a reel is worth it) and the plans the editors changed, which every new distribution plan reads (see "The distribution plan" below).
- **Learning per publish batch** (`learning.batch` job after every publish): all the articles of the batch (source excerpt, the AI-to-final diff, the image choice) in one AI call that updates the style rules and writes a Hebrew report (`learning_reports`).
- **Visual agent** (`services/agent/visual.ts`, Google Gemini through `ai/gemini-visual.ts`, the model is a Gemini connection setting): it writes the Hebrew description of an article's main image (`visual.image` prompt) and the reel's two prompts (`reel.prompts`), with the newsroom's settings (`app_settings` `agent.visual`: article style, reel style, standing instructions, what to avoid) and its learned rules. Every publish records how the main image came about (`visual_feedback`: each round's description and who wrote it, which drawn image was chosen and which were passed over); every approved reel records the agent's suggestion against the approved prompts, the editor's directions and the tries. Every 5 pending cases (unless the newsroom turned auto-learning off), or on "learn now", a `visual.learn` job sends them in one Gemini call, with small JPEGs of the chosen and passed-over pictures, and stores the new rules and a Hebrew summary as the active `visual_profiles` version; an admin can edit the rules or restore an older version. Tracked in `ai_jobs` as `visual_prompt` and `visual_learning`.

### International sites and translation

`sources.region` (`local` | `international`) splits the sites: the CMS lists them in two tabs, and `scrape_runs.region` gives each kind its own runs ("איתור כתבות" / "איתור מחו״ל"), one running run per region. Automatic setup keeps an international site's own-language feeds and records its `<html lang>`. Every discovered item gets `language` by its script (Hebrew → null); after a run, an `items.translate` job writes Hebrew headlines and intros (`title_he`, `intro_he`) in batches with the fast model. When a foreign item goes to the editor, the rewrite job first translates the whole original (`body_he`, main model) and then writes the new article in Hebrew; the editor's "המקור" pane opens on the translation with the original one click away, and the copy check compares the draft with the translation. Translations are logged in `ai_jobs` as `translate`.

### The social page (CMS > רשתות חברתיות)

Every published article, filtered by whether it went out (`article_share_posts` and the editor module's `social_posts` with status `posted`). For the articles the editor picks, a `social.kit` job asks the AI (`social.kit` prompt in `prompt_templates`) for a frame (`headline`, `breaking`, `quote`, `explainer`), a label, the headline on the image, the opening sentence, a caption ending in a question for comments, and hashtags; `article_shares` keeps one kit per article. `social-design.ts` renders a 4:5 post (1080×1350) and a 9:16 story (1080×1920; the top ~200px and bottom ~330px stay clear for the apps' own controls) from the article's main image or an uploaded one, in Rubik/Heebo through Pango, so Hebrew shaping and right-to-left lines are correct. Every save re-renders; file names change, so a CDN never serves an old design. `social.publish` posts each (article, account, format) once: links carry UTM tags, go in the first comment on Facebook and Instagram and inline on Telegram; stories go out automatically on Facebook and Instagram; anything without a token or an API is prepared for manual posting and can be marked as posted by hand.

The editor chooses per article what to make (`article_shares.formats`: post, story, reel); only those are drawn. A reel is made in steps the editor approves one by one, recorded in `article_shares.reel_plan` (`stage`: `prompts` → `image` → `video` → `approved`), each step its own job in `social-reel.ts`:

1. `social.reel_prompts`: the visual agent (Gemini) reads the article and looks at its main image and the original report's photo, and writes two prompts in Hebrew (`reel.prompts`): what the picture shows, and what happens in the video. The editor edits them (the agent's own version is kept as `reel_plan.suggested`, to learn from). Nothing costly runs.
2. `social.reel_image` (one attempt): the approved picture prompt is translated to English (`toEnglish`, the fast model), and Gemini makes a new portrait picture in the spirit of the article's pictures, never a copy (`reel.image`, `reel_image_media_id`). The story frame with the headline is drawn on it as the reel's cover. A new picture drops the old video.
3. `social.reel_video` (one attempt): Google Veo animates the clean picture (no text in it to warp) by the approved video prompt, in English, with the settings in `reel_settings` (model, 4/6/8 seconds, 720p/1080p, camera motion; `reel.video`, tracked as `social_video` with its price). By default Veo 3.1 Lite at 720p (`DEFAULT_VIDEO_MODEL`, owner's decision 2026-10-15: less than half the price of Fast at 1080p); the editor picks a better model or 1080p for one reel.
4. The editor approves the video; only an approved reel is published, with the cover as Instagram's `cover_url`. The approval is a learning case for the visual agent.

Instagram's API can't attach music from its library (only original audio), so a song is added in the app; `reel_audio` is no longer used. Publishing a reel needs a public HTTPS media URL.

### The research reporter (CMS > העלאה ידנית > מקישור או צילום מסך)

A link, or up to four screenshots (Telegram, X, WhatsApp), with an optional note, become a `research_tasks` row and a `research.run` job (`services/research.ts`; one attempt, since searches are paid). Before anything is paid for, the CMS asks `POST /admin/research/similar` whether we already have a story from that link (articles by `source_url`, drafts by the item's `url_hash`); after the research, a free headline overlap (`topicOverlap` in `lib/similarity.ts`) adds recent articles and drafts that look like the same story. Either way the editor is offered to open the existing one and update it.

1. **The research** (`TextAI.research`, skill `research.system`): Claude with Anthropic's server-side web search and web fetch, capped by the depth the editor chose (quick, the default: 3 searches; regular: 8; deep: 15, on Claude Opus), prompt caching and the refusal fallback; a long research that pauses is resumed. The search tools are called directly with strict inputs (otherwise calls came back `invalid_tool_input`; failed searches are logged). When no detail in the file it hands in is verified and searches are left, it is sent back once to look for the official source itself (`site:gov.il`, `site:boi.org.il`, the government decision, the company's filing). The link's page as we read it and the screenshots go in as data. The model hands in the file through one strict tool (`submit_dossier`): what was reported (who, when, what), a summary, every detail with its label (verified, reported, claimed, estimate, suspicion, unverified, debunked) and the addresses of its sources, the background, the open questions, who must be asked for a response, and the sources with who published them.
2. **The check** (`checkDossier`): every source is judged by its address before the model's word (`agent/researcher.ts`, with the lists in `@b4/shared`): official sites (`gov.il`, `muni.il`, Bank of Israel, TASE, the UN, the OECD…) always back a fact; news sites never do (a lead only, whatever the model called them); a social post only from an account on the newsroom's approved list (`agent.research` in `app_settings`, admin only); Wikipedia only background; any other site when the model marked it as the subject's own or official (the editor sees which). A detail labelled verified, suspicion or debunked without such a source is marked down (verified → reported or unverified; a suspicion → unverified, so it stays out of the article), with a note why. The sources line is built here, names only (`מקורות: משרד החינוך, רשתות חברתיות`), from the sources of verified details, of what a party said itself, of a suspicion or a refutation, and of the background; a source behind a mere report isn't named, since the line would read as if it confirmed it.
3. **The article** (`TextAI.researchWrite`, skill `research.write`, the main model): written from the file alone, each detail by its label ("לפי", "לטענת", "לכאורה"; unverified details stay out), with the house style and the editor-agent settings. The code adds the sources line at the end. The draft (`origin = 'research'`, purple by default, the link's page as its original when it could be read) enters the usual editing, legal review and distribution plan.
4. **The proof** (`research.archive` job): for every source the article rests on, and the report itself, a copy of the page's text (kept in the file, read through `s.fetch`) and, when a browser is installed, a screenshot of the page (`s.capture`, `lib/page-capture.ts`: the machine's own Chrome, Edge or Chromium driven by `playwright-core`; every request the page makes passes the same public-address check as `safeFetch`; `PAGE_CAPTURE`, `BROWSER_PATH`), stored with the media. The editor's "תיק התחקיר" tab shows all of it.

When no detail rests on an official source, the research list and the file say so in red: the article rests on reports alone, and the editor decides. A month's research stops at its budget (`agent.research`, default $60): each task records its estimated cost (tokens at list prices plus a cent a search, `services/ai/prices.ts`). A writing failure keeps the file, and "try again" only writes. Tracked in `ai_jobs` as `research` (the reporter's card in the agent team).

**The official-sources registry** (`official_sources`, `services/official-sources.ts`; in the reporter's settings): bodies (a ministry, the central bank, a regulator, the government portal…) with their official site, their own domains (a host, or a host and a path such as `gov.il/he/departments/ministry_of_finance`) and their social accounts. `checkDossier` reads it first: a page under a body's domains (the most specific body wins, so a ministry's page isn't the portal's) or a post from one of its verified accounts (`lib/social-links.ts` matches a post to its account whatever form the link takes) is official, and the sources line names the body. An account is verified when the body's own page links to it, read as a browser draws it (`s.capture.links`: many official sites build their pages in the browser or refuse plain requests), else from the HTML. The first eleven bodies are seeded with the accounts their sites linked on 2026-10-15. A weekly job (`registry.update`, booked every six hours by `registry.tick` on the live site only, or "לבדוק עכשיו") reads every body's page again: new accounts are added, accounts no longer linked are marked missing (kept for the admin), and an account linked from several bodies' pages (a portal footer) goes only to the body whose page is that portal. Then up to five bodies without an account on X or Telegram are searched (skill `research.accounts`, two searches each, within the reporter's budget); a found account is verified only when its evidence page is under the body's domains and really links to it, else it waits for an admin. Only an admin adds, changes or removes bodies and accounts (audited).

**From an idea** ("רעיון לתחקיר"): the newsroom's own question or topic is a research of kind `idea`: no report, the idea is the whole input, and the reporter looks for the official data and decisions that answer it. The free check before it compares the idea's words with recent headlines (`POST /admin/research/similar` with `text`).

### The editorial meeting (CMS > העלאה ידנית > ישיבת מערכת)

`services/editorial-meeting.ts`, the chief editor's skill `meeting.pitch`. A meeting (`editorial_meetings`, a `meeting.run` job, one attempt) reads what discovery found in the last 36 hours (up to 300 items, the Hebrew headline of a foreign one) and groups it into topics for free (`groupTopics`: headlines sharing enough subject words, `topicOverlap`); the topics covered by more sites come first. One call on the main model, without search, gets the 25 hottest topics with their headlines and sites, what we published in the last three days, and an optional focus, and returns a short summary and up to six original pitches: a working headline (a question, not a fact), our angle, why now, what to check and in which official sources, the section, a depth, and the topics it grew from. A pitch that names no topic it was given is dropped (it would be invented); each kept one carries its leads (the discovered articles, never sources), how many sites covered it, and a free overlap check against our articles and drafts. Below five discovered articles there is no meeting.

Nothing is researched until a person approves a pitch (audited, with who decided): it can be edited first, and the chosen depth applies. Approving claims the pitch inside a transaction, so two clicks never start two paid research, and starts an `idea` research whose text is the pitch with its leads marked as hints only; a research that can't start (the budget) gives the pitch back. "Not now" sets it aside. The meeting's cost counts toward the reporter's monthly budget, and its calls are tracked in `ai_jobs` as `meeting` (on the chief editor's card).

**The morning meeting** (`agent.meeting` in `app_settings`, admin only, in the chief editor's settings: on by default at 08:00, no Saturdays, an optional standing focus): a `meeting.tick` job every 15 minutes, a database look only, starts a discovery of the Israeli sites in the half hour before that hour (`trigger = schedule`, once a day: scraping is free), then holds a meeting by itself (`created_by` empty) at that hour in Israel when none was held that day, and when its pitches are ready it emails them to every active admin and editor with a link to the tab (`/manual?tab=meeting`). A day with too little discovered, a meeting already running or no budget left is skipped and logged. The tick is booked only on the live site (`config.production`), so a workshop never mails the admins too.

### The legal review (before publishing)

Marking a draft's text final queues a `review.check` job (`services/legal-review.ts`; the reviewer's settings are `agent.review`, `services/agent/reviewer.ts`; only an admin turns it off). The reviewer (Claude, the fast model, skill `review.system`) reads the final text and returns only the risks a person must decide on: a suspicion against a named private person, a minor or a sex-crime victim, a possible gag order, security information that may need the military censor, an unverified report about a listed company, an accusation without the other side's response. Each risk keeps the exact passage, where it is, who it is about, why and what to do (`draft_reviews.issues`). When any is found, every active admin is emailed with the risks and a link to the draft (`CMS_URL`).

Publishing waits (`problemsOf` in `publish.ts`, at the preview, the start and inside the publish job) while the check runs, while any risk is undecided or waiting for a response, and when the check didn't finish. The decisions, each recorded with who and when and audited: publish as is (a reason is required); publish with extra caution (a `review.fix` job: the main model, skill `review.fix`, rewrites only the passage without adding a fact or a source; the editor sees before and after, and approving puts it into the text through `amendFinalText`, which keeps the text final, saves a revision and has the distribution plan written again); wait for a response, then add the response or note that none came (a paragraph at the end); don't publish (the draft is skipped). A check that failed can be waived with a reason. A new check (the text was reopened) keeps the decision on any risk found again in the same words. Drafts marked final before the review existed aren't stopped, and an edit to an article that is already on the site isn't checked again. The CMS shows a red bar and a tab in the editor, a counter in the menu, a card on the dashboard, and every waiting article on `/review`. The review is a safety net, not legal advice.

### The distribution plan (before publishing)

Marking a draft's text final queues a `social.plan` job (`services/social-plan.ts`): the social editor (Claude, the fast model, prompt `social.plan`) decides how the article goes out and writes the kit texts, in one call. It is given a catalog of every option, generated from the code and the accounts (`optionsCatalog`: the frames and what each is for, feed/story/reel with sizes and the reel's price per length from the video settings, the camera moves, each active account and what it posts automatically), so a new frame or account is known without editing the prompt; and the newsroom's guidance (`agent.social` in `app_settings`: instructions, when a reel is worth it) with the latest plans the editors changed (`services/agent/social.ts`). That is how it learns: no learning call of its own. It returns the frame, feed and/or story, a reel recommendation (reason, a Hebrew idea, camera move, length) and a Hebrew reason for each choice, stored in `social_plans` (one row per draft, with `ai_choice` kept apart from what the editors chose, and preview designs drawn on the plan's photo, the main image by default).

The AI never puts `reel` in `formats`; a person does, with one click (audited). The report (CMS > רשתות חברתיות > לפני פרסום) lists every draft whose text is final and not yet published, with quick controls; the editor's social tab shows the same plan in full. A person's change of frame, formats or reel sets `choices_by = 'editor'`, and a new text from the AI keeps those choices. Reopening the text marks the plan stale; finalizing it again rewrites the texts.

Publishing (step 2 of the publish job) applies the plan once (`applied_at`): it creates the article's `article_shares` row from it (a share the newsroom already made is kept), renders the designs, and, unless the plan is off or `autoPost` is off, queues the still designs to every active account that takes them (`queueAutoPosts`: what the network posts automatically, or, without a token, prepared for posting by hand). An approved reel starts in "express" mode: the reel prompts (from the plan's idea), the picture and the video jobs follow one another by themselves and stop at the video, which waits for the editor's approval on the social page; approving it posts the reel to the accounts that take reels. A draft with no plan falls back to the editor's older social package.

### Adding sites from links

`POST /admin/sources/bulk` creates each site and queues a `source.setup` job: read the page (`<link rel=alternate>` feeds, feed links, usual feed paths), read `robots.txt` for sitemaps, evaluate every candidate by how many dated articles of the last week it lists, prefer live RSS, skip other-language editions, add a section filter when the link was a section (`/economy`) and the best source is a whole-site sitemap, then run the same test a developer would. A passing site waits for approval (`approve-tested`).

### Discovery and delta fetch

Each active source has a watermark (newest `published_at` seen by its last successful run). A run lists the source (feed, sitemap or listing page), keeps items newer than the watermark, drops URLs already known (`url_hash` of the canonical URL: lower-case host, no `www`, no tracking parameters, no fragment) and bodies already known (`content_hash`), opens the remaining article pages (only where robots.txt allows) with the developer's selectors or automatic detection (schema.org JSON-LD first, then the largest text block); a page that can't be opened falls back to the feed's headline and summary, assigns a section (URL rules → source default → keyword classifier; the AI refines it later), and stores the run's items. The watermark moves only when the source succeeds; five failures in a row mark the source `broken`.

### AI

- **Rewrite** (`rewrite.system` skill, editable in the CMS): "an external reporter" rewrite with the same facts, structured JSON output (title, subtitle, paragraphs, section, tags, image prompt). The active house-style rules are injected into the prompt.
- **Refine** (`refine.system` skill): the editor's comment, optionally on a selected passage, applied to the current text; the reply goes to the chat.
- **Images**: 3 quick landscape drafts per click for the article (the chosen one is redrawn at full quality); 2 portrait options for stories (the first is preselected). Unless the editor wrote their own description, the visual agent writes it in Hebrew in the job (knowing the descriptions already tried); a Hebrew description reaches the image model in English (`toEnglish`). `image_batches.prompt_by` says who wrote it. Every image goes through `lib/images.ts`.
- **Where images and reels are made**: with the Gemini API key from the CMS (`gemini-images.ts`, `gemini-video.ts`), or, on the cloud server (`VERTEX_PROJECT`), through Vertex AI (`vertex-images.ts`, `vertex-video.ts`): the same Google models, billed to the Google Cloud account and authorized by the server's own identity (`lib/google-auth.ts`, no key). The model names come from the CMS either way. The visual agent always uses the key.
- **Learning loop**: at publish, the AI's first version and the final text are diffed (`edit_ratio`); after 5 meaningful corrections (or on demand) the AI distills them into numbered house-style rules, kept as versioned `style_profiles` that an admin can edit or roll back.
- Untrusted text (scraped articles, editor comments) is passed inside tags the system prompt marks as data; the output is validated with zod and passed through `sanitizeDoc`.

### Article body format

The canvas edits ProseMirror JSON (TipTap) limited to paragraphs, h2/h3, quotes, lists, bold, italic and links. `sanitizeDoc` (in `packages/shared/src/doc.ts`) rebuilds every incoming document from that whitelist; `docToHtml` renders the published HTML from it, escaping everything, so the published HTML needs no HTML sanitizer. `docToText`/`textToDoc` convert to the plain-text form the AI reads and writes.

### Images ("automatic pixel management")

Uploads and AI images are validated (type by content, at least 400×225, max 50 MP), rotated by EXIF, stripped of metadata and stored as a WebP master, then cut into `hero` 1600×900, `card` 800×450, `thumb` 320×180, `og` 1200×630, `square` 1080×1080 and `story` 1080×1920 around a focal point the editor can move. Rendition names carry a random tag so a CDN never serves an old crop. The files live on local disk (`MEDIA_DIR`, served at `/media`) in the workshop, and in a Cloudflare R2 bucket (`MEDIA_STORAGE=r2`, `BucketStorage`) in the cloud, where `MEDIA_BASE_URL` is the bucket's public address and every file is marked immutable.

### Publishing

`POST …/publish` with an idempotency key creates a `publish_jobs` row and a job. The job publishes each ready draft in its own transaction (article, tags, homepage zone: new first, pinned slots keep their place, 7 main / 14 trending), revalidates the site's cache tags, sends the push (Expo) if requested, then posts to the networks with the article's short link `/a/<id>`; on Facebook, Instagram and X the link goes in the first comment. Every step is recorded in `publish_jobs.steps`; a retry skips what already happened.

### Background jobs

`jobs` table + `lib/jobs.ts`. Workers claim one row at a time with `SELECT … FOR UPDATE SKIP LOCKED`, retry with backoff (`PermanentJobError` skips retries), recover jobs from dead workers after 15 minutes, and call `onFailed` hooks to put domain state back in order (for example a draft becomes `ai_failed`). Locally the API runs the worker in-process; in production run the API with `WORKER=off` and any number of `npm run worker` processes against PostgreSQL.

## Security

- **Staff**: argon2id passwords, server-side sessions (only `sha256(token)` is stored), httpOnly `SameSite=Strict` cookie, 12 h. Roles: `admin`, `editor`, `developer`, `viewer` (read-only). Every `/admin` route requires a session before the body is read; routes check roles. Password change and role changes sign out other sessions. Sensitive actions are written to `audit_log`.
- **Readers** (comments): one-time email codes (HMAC with a pepper, 5 attempts, per-IP and per-email limits), 30-day sessions; the app uses a Bearer token in the device's secure storage.
- **CSRF**: cookie-authenticated writes must carry an `Origin` from `CORS_ORIGINS`.
- **SSRF**: every outbound fetch of a user- or source-supplied URL goes through `lib/safe-fetch.ts`: http/https only, no credentials, standard ports, every resolved address must be public (checked at connect time, so DNS rebinding can't bypass it), redirects re-checked hop by hop, size and time limits.
- **Content**: the published HTML is generated from a whitelisted document; scraped text is shown in the CMS through the same path. The CMS sets a strict CSP, `X-Frame-Options: DENY` and `noindex`; the API sends `default-src 'none'`.
- **Secrets**: API keys and social tokens entered in the CMS are encrypted with AES-256-GCM under `SECRETS_KEY` (environment only), bound to their name, never returned to the browser (only `••••last4`), and changes are audited without values. Environment variables (`ANTHROPIC_API_KEY`, `SOCIAL_SECRET_<NAME>`, …) remain a fallback. Production refuses to start without `SECRETS_KEY`, with development fallbacks (pepper, AI stand-ins, sample sites) or a missing revalidate secret; email without SMTP fails rather than logging sign-in codes.- **Rate limits**: global 300/min per IP, plus tighter limits on login, codes, comments, uploads, AI requests and source tests.

## Legal: consent, removal requests, compliance checks

- **Terms version**: `site.legal.version` (a date) in the site settings; only "publish a new version" in the CMS changes it. `GET /public/site` gives it to the site and the app.
- **Consent**: every acceptance goes to `consents` (subject `reader` / `subscriber` / `visitor`, version, channel, keyed IP hash). The site shows a non-blocking bar until the visitor accepts (kept in `localStorage`); the app shows a welcome screen over every route; sign-up (comments, newsletter) requires the "18 and over, I accept" checkbox, and the API refuses without it. A reader who accepted an older version is asked again before their next comment (`409 terms_required`).
- **Account deletion**: `DELETE /auth/reader/me` (site `/account`, app account screen). Comments, reports, sessions and consents cascade; `audit_log` keeps the event without the reader.
- **Newsletter**: `services/newsletter.ts` builds every message with a signed one-click unsubscribe link, `List-Unsubscribe` headers and the "פרסומת" label when it carries an ad.
- **Notice and takedown**: `takedown_requests` from the public form (`/report`), answered from the CMS queue with a 48-hour answer-by time; decisions are audited and mailed to the requester.
- **Legal pages**: defaults in `services/legal-pages.ts`; `{שם החברה}` and the other tokens are filled from the company details at render time.
- **Copy check**: `lib/similarity.ts` compares the draft with the original (6-word sequences); the editor and the publish preview warn when wording is copied. The AI prompts carry fixed newsroom rules (no investment advice in the newsroom's voice, no copied sentences, no identifying minors or victims).

## Testing

`npm test` runs the API suite against PGlite in memory: public content, comments and reader auth, security (CSRF, roles, sessions), the configuration guards, the real network path of `safe-fetch`, and the whole newsroom process end to end (site request → developer approval → two discovery runs proving the delta → magazine → AI draft and images → autosave conflicts → AI refine → social package → preview → publish → homepage → learning). `packages/shared` tests the document sanitizer and renderer.
