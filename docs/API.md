# BIFOR NEW'S: Backend API v1

Companion to [ARCHITECTURE.md](ARCHITECTURE.md). Table and column names refer to [`db/schema.sql`](../db/schema.sql).

## Conventions

- Base path `/api/v1`, JSON, UTF-8.
- Two surfaces:
  - `/public/*`: no auth, CDN-cacheable. Consumed by the Next.js site (server side) and the mobile app.
  - `/admin/*`: JWT bearer token (15 min), refresh token in an httpOnly cookie, role checks per route.
- Errors use `application/problem+json`: `{ "type", "title", "status", "detail", "code" }`.
- Lists use cursor pagination: `?cursor=&limit=` → `{ "items": [...], "next_cursor": "..." }`.
- Slow work returns **202** `{ "job_id" }`. Progress arrives on the SSE stream `GET /admin/events`.
- Draft and social-package writes carry `version`. A stale version returns **409** with the current server copy.
- `POST /admin/scrape-runs` and `POST /admin/magazines/{id}/publish` require an `Idempotency-Key` header.

Roles: **A** admin · **E** editor · **D** developer · **V** viewer. A route marked E is also open to A.

---

## Auth

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/auth/login` | – | Email + password → access token; sets refresh cookie |
| POST | `/auth/refresh` | – | Rotate tokens |
| POST | `/auth/logout` | any | Revoke refresh token |
| GET | `/auth/me` | any | Current user and role |

## Dashboard & system (tab 1)

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/admin/dashboard` | V | Drafts by status, magazines by status, last 5 scrape runs, sources waiting for a developer, failed social posts, AI spend today/month, weekly avg `edit_ratio` |
| GET | `/admin/system/health` | V | DB, Redis, queue depths, worker heartbeat, provider status, social tokens expiring within 7 days |
| GET | `/admin/events` | V | **SSE**: `scrape.progress`, `scrape.finished`, `draft.ai_ready`, `draft.ai_failed`, `images.ready`, `social.ready`, `publish.step`, `source.status_changed` |

## Source Management: הגדרות אתרים (tab 4)

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/admin/sources?status=` | V | List with health (last success, failures) |
| POST | `/admin/sources` | E | `{ name, base_url, list_urls?, default_category_id? }` → `pending_dev`; notifies developers |
| GET | `/admin/sources/{id}` | V | Detail, including `selector_config` |
| PATCH | `/admin/sources/{id}` | E | Name, list URLs, default category, interval |
| PUT | `/admin/sources/{id}/config` | D | `{ method, selector_config }` → `in_development` |
| POST | `/admin/sources/{id}/test` | D | Dry run with the current config: 5 parsed sample items + extraction warnings. Writes nothing except `last_test_passed_at` |
| POST | `/admin/sources/{id}/approve` | D | Requires a passing test in the last 24 h → `active` |
| POST | `/admin/sources/{id}/pause` | E | → `paused` |
| POST | `/admin/sources/{id}/resume` | E | → `active` |
| DELETE | `/admin/sources/{id}` | A | → `archived` (history kept) |

## Discovery: איתור כתבות (tab 2)

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/admin/scrape-runs` | E | `{ source_ids? }` (default: all active) → **202** `{ run_id }`. Delta fetch per source |
| GET | `/admin/scrape-runs` | V | History: time, trigger, user, found/new counts, status |
| GET | `/admin/scrape-runs/{id}` | V | Per-source breakdown with errors |
| GET | `/admin/scrape-runs/{id}/items?category_id=&source_id=` | V | Grid data grouped by category: source name, thumbnail, title, intro |
| GET | `/admin/scraped-items?q=&source_id=&category_id=&from=&to=&status=` | V | Search the whole archive (to pull older articles) |
| GET | `/admin/scraped-items/{id}` | V | Full original for the editor's left pane |
| PATCH | `/admin/scraped-items/{id}` | E | `{ category_id }` re-categorize · `{ status: "ignored" }` |

## Magazines: עריכות שמורות (tab 5) and Preview

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/admin/magazines` | E | **Save** from Discovery: `{ title?, scraped_item_ids[] }` → magazine + one draft per item, rewrite jobs queued → **201** |
| GET | `/admin/magazines?status=` | V | Cards with status color and progress (`ready / total`) |
| GET | `/admin/magazines/{id}` | V | Magazine + draft summaries in order |
| PATCH | `/admin/magazines/{id}` | E | Rename · archive |
| POST | `/admin/magazines/{id}/drafts` | E | `{ scraped_item_id }`: pull an older article into this magazine |
| PUT | `/admin/magazines/{id}/order` | E | `{ draft_ids[] }` |
| GET | `/admin/magazines/{id}/preview` | V | **Preview Magazine**: every non-skipped draft with its readiness checklist |
| POST | `/admin/magazines/{id}/publish` | E | **Publish All** → **202** `{ publish_job_id }`; **422** lists drafts that are not ready |
| GET | `/admin/publish-jobs/{id}` | V | Step-by-step status (articles, revalidate, social, feedback, push) |
| POST | `/admin/publish-jobs/{id}/retry` | E | Retry failed steps only |

## Drafts & the split-screen editor (tab 3 + editor)

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/admin/drafts` | E | Manual Entry: `{ mode: "url", url }` (fetch + extract + rewrite) or `{ mode: "scratch" }`; optional `magazine_id` |
| GET | `/admin/drafts?standalone=true&status=` | V | Single saved articles |
| GET | `/admin/drafts/{id}` | V | `{ draft, original, chat, image_batches, social_package, lock }`: everything the editor needs in one call |
| PATCH | `/admin/drafts/{id}` | E | **Autosave** `{ version, title?, subtitle?, body_doc? }` → `{ version, saved_at }` · **409** on conflict |
| PATCH | `/admin/drafts/{id}/meta` | E | `{ category_id, placement: main\|trending\|none, author_id, tag_names[], send_push }` |
| POST | `/admin/drafts/{id}/lock` | E | Take or renew the 60 s edit lock (heartbeat) |
| DELETE | `/admin/drafts/{id}/lock` | E | Release |
| POST | `/admin/drafts/{id}/rewrite` | E | Re-run the full rewrite → **202**. Replaces canvas and AI baseline (previous text kept as a revision) |
| POST | `/admin/drafts/{id}/chat` | E | `{ message, selection? }` → **SSE** stream; the change is applied as an `ai_refine` revision |
| GET | `/admin/drafts/{id}/chat` | V | Chat history |
| GET | `/admin/drafts/{id}/revisions` | V | Snapshot list |
| POST | `/admin/drafts/{id}/revisions/{rev_id}/restore` | E | Restore (creates a `restore` revision) |
| POST | `/admin/drafts/{id}/skip` | E | `{ reason? }` → `skipped`; frees the scraped item |
| POST | `/admin/drafts/{id}/finalize-text` | E | → `text_final`; unlocks the social module |
| POST | `/admin/drafts/{id}/reopen-text` | E | → `editing`; marks the social package stale |

### Images

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/admin/drafts/{id}/images` | E | `{ purpose: "article", prompt? }` → **202** `{ batch_id }`; 4 options. Call again for 4 new ones |
| GET | `/admin/drafts/{id}/images?purpose=article` | V | Batches, newest first |
| PUT | `/admin/drafts/{id}/hero` | E | `{ media_id }`: select the article image |
| POST | `/admin/media` | E | Multipart upload → normalized to site renditions → `{ media }` |
| POST | `/admin/media/import` | E | `{ url }`: fetch a remote image into the pipeline |
| PATCH | `/admin/media/{id}` | E | `{ focal_x, focal_y, alt_text, credit }` → renditions re-cropped |

## Social distribution

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/admin/drafts/{id}/social` | V | Package + per-platform previews (exact payloads) |
| POST | `/admin/drafts/{id}/social/generate` | E | **409** unless `text_final`. Caption + social image → **202** |
| POST | `/admin/drafts/{id}/social/caption` | E | New AI caption only |
| POST | `/admin/drafts/{id}/social/image` | E | New AI social image only |
| PATCH | `/admin/drafts/{id}/social` | E | `{ version, caption?, posts: [{ social_account_id, format, enabled, caption_override? }] }` |
| POST | `/admin/drafts/{id}/social/approve` | E | Approve → draft can become `ready` |
| GET | `/admin/social-accounts` | V | Connected accounts and token expiry |
| GET | `/auth/social/{platform}/start` | A | Begin OAuth connect |
| GET | `/auth/social/{platform}/callback` | – | OAuth callback; token goes to the secrets manager |
| POST | `/admin/social-accounts/{id}/test` | A | Verify the token and permissions |
| PATCH | `/admin/social-accounts/{id}` | A | Enable/disable |
| GET | `/admin/social-posts?status=failed` | V | Failed posts and comments |
| POST | `/admin/social-posts/{id}/retry` | E | Retry (only the comment, if the post already exists) |

## Push notifications

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/admin/push` | E | `{ article_id, title, body, topic }`: breaking-news alert |
| GET | `/admin/push` | V | History with delivery status |

## AI settings & learning loop

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/admin/ai/prompts` | A | All prompt keys with versions |
| POST | `/admin/ai/prompts/{key}` | A | New version `{ body, activate }` |
| GET | `/admin/ai/style-profile` | E | Active house-style rules + example pairs |
| POST | `/admin/ai/style-profile/rebuild` | A | **202**: distill pending feedback into a new profile version |
| POST | `/admin/ai/style-profile/{id}/activate` | A | Activate or roll back |
| GET | `/admin/ai/feedback?category_id=&cursor=` | E | Diffs with `edit_ratio` |
| PATCH | `/admin/ai/feedback/{id}` | E | `{ status: "excluded" }`: keep a bad example out of training |
| GET | `/admin/ai/usage?from=&to=` | A | Tokens, images and cost by job type and model |

## Published content & homepage

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/admin/articles?q=&category_id=&cursor=` | V | Published articles |
| PATCH | `/admin/articles/{id}` | E | Post-publish correction → revalidates the page |
| POST | `/admin/articles/{id}/unpublish` | E | Remove from site, slots and feeds |
| GET | `/admin/homepage` | V | The 7 main + 14 trending slots |
| PUT | `/admin/homepage/{zone}` | E | `{ items: [{ article_id, pinned }] }` in order (max 7 / 14) |

---

## Public API (Next.js site + mobile app)

| Method | Path | Cache | Purpose |
|---|---|---|---|
| GET | `/public/home` | tag `home` | `{ main[7], trending[14], sections: [{ category, items[≤6] }] }`: the whole homepage in one call |
| GET | `/public/feed?cursor=` | 60 s | Mixed-category infinite feed (mobile home) |
| GET | `/public/categories` | 1 h | Category list with order and parent |
| GET | `/public/categories/{slug}?cursor=` | tag `category:<slug>` | Category page |
| GET | `/public/articles/{slug}` | tag `article:<id>` | Article + author/editor + tags + hero renditions + attribution |
| GET | `/public/articles/{slug}/related` | tag `article:<id>` | 6 related: shared tags first, then same category |
| GET | `/public/a/{id}` | tag `article:<id>` | Resolve the short deep-link path to the article |
| GET | `/public/tags/{slug}?cursor=` | 5 min | Tag page |
| GET | `/public/authors/{slug}?cursor=` | 5 min | Author page (columnists) |
| GET | `/public/search?q=&cursor=` | none | Full-text search |
| GET | `/public/markets` | 60 s | Ticker quotes (provider to be decided) |
| POST | `/public/newsletter` | – | `{ email }` → double opt-in mail |
| GET | `/public/newsletter/confirm?token=` | – | Confirm subscription |
| POST | `/public/devices` | – | `{ platform, push_token, topics[] }` |
| PATCH | `/public/devices/{push_token}` | – | Update topics |
| DELETE | `/public/devices/{push_token}` | – | Unregister |

Bookmarks and offline reading are stored on the device in v1, so they need no API.

## Outbound calls (backend → others)

| Call | When |
|---|---|
| `POST {SITE_URL}/api/revalidate` `{ tags[] }` with a shared secret | After publish, correction or unpublish |
| LLM provider | rewrite, refine (chat), classify, social caption, style distill |
| Image provider | article images (4 per batch), social image |
| Meta Graph API / X API / Telegram Bot API | Social posting + first comment |
| FCM | Push notifications |
