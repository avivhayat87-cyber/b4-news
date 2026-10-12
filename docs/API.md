# API reference

Base: `/api/v1`. JSON in and out (camelCase). Request and response shapes are the zod schemas in `packages/shared` (named below).
Every error is `{ code, message, fields? }`; `message` is Hebrew and safe to show. Admin responses are `no-store`.

Auth: readers use the `b4_rs` cookie (site) or `Authorization: Bearer` (app); staff use the `b4_ss` cookie (CMS).
Cookie-authenticated writes must send an allowed `Origin`.

## Public content (`/public`, cacheable)

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/public/home` | `HomeData`: 7 main, 14 trending, latest, sections, podcasts |
| GET | `/public/categories` | `CategoryRef[]` |
| GET | `/public/categories/:slug?cursor=` | `CategoryPage` (keyset pagination) |
| GET | `/public/articles/:slug` | `ArticleFull` (body HTML, tags, editor, source, comment count) |
| GET | `/public/articles/:slug/related` | `ArticleCard[]` |
| GET | `/public/a/:id` | `{ slug }`: the short link used in social posts and push |
| GET | `/public/feed?cursor=&limit=` | `Page<ArticleCard>` (the app's endless feed) |
| GET | `/public/search?q=&cursor=` | `Page<ArticleCard>` |
| GET | `/public/markets` | `MarketQuote[]`: Bank of Israel representative rates (empty when unavailable) |
| GET | `/public/site` | `PublicSite`: links (empty ones omitted), contact, info-page titles |
| GET | `/public/pages/:slug` | `PublicPage`: about, contact, advertise, accessibility, privacy, terms |
| POST | `/public/newsletter` · `/public/newsletter/confirm` | double opt-in |
| POST/DELETE | `/public/devices` · `/public/devices/:pushToken` | push registration (app) |

## Comments and readers

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/public/articles/:id/comments?cursor=` | `CommentList`; the viewer also sees their own comments held for review |
| POST | `/articles/:id/comments` | `CreateCommentInput`; reader session; automatic filter; 5/min, 50/day |
| DELETE | `/comments/:id` | own comment |
| POST | `/comments/:id/report` | `ReportCommentInput`; 3 reports hide the comment |
| POST | `/auth/reader/request-code` | always 204 (no account enumeration) |
| POST | `/auth/reader/verify` | `VerifyCodeInput` → `ReaderSession` (cookie for web, token for the app); 409 `name_required` on first sign-in |
| GET | `/auth/reader/session` | `{ reader \| null }` |
| GET/PATCH | `/auth/reader/me` | profile |
| POST | `/auth/reader/logout` | |

## Staff sign-in

| Method | Path | |
| --- | --- | --- |
| POST | `/auth/staff/login` | `StaffLoginInput` → `StaffDto` + cookie (10 attempts / 15 min) |
| GET | `/auth/staff/me` | `StaffDto` |
| POST | `/auth/staff/logout` | |

## CMS (`/admin`, staff only)

Roles: **viewer** reads only · **editor** content work · **developer** site triggers · **admin** everything, users, social accounts, style rules.

### Dashboard, learning, settings

| Method | Path | Role | |
| --- | --- | --- | --- |
| GET | `/admin/dashboard` | any | `DashboardDto` |
| GET | `/admin/learning` | any | `LearningOverview` |
| POST | `/admin/learning/distill` | editor | learn now from pending corrections |
| POST | `/admin/learning/profiles/:id/activate` | admin | roll back / forward the style rules |
| PUT | `/admin/learning/rules` | admin | `{ rules }` → new active version |
| GET | `/admin/authors` | any | `AuthorDto[]` |
| GET/POST | `/admin/social-accounts` | any / admin | `SocialAccountDto`, `CreateSocialAccountInput` |
| PATCH | `/admin/social-accounts/:id` | admin | `{ isActive }` |
| GET/POST | `/admin/users` | admin | `StaffUserDto`; POST returns a one-time temporary password |
| PATCH | `/admin/users/:id` | admin | `UpdateStaffInput` (can't demote or disable yourself) |
| POST | `/admin/users/:id/reset-password` | admin | one-time temporary password; signs the user out |
| POST | `/admin/me/password` | any | `ChangePasswordInput`; signs out other sessions |

### Settings (admin)

| Method | Path | |
| --- | --- | --- |
| GET | `/admin/integrations` | `IntegrationStatus[]` (Claude, OpenAI, SMTP): configured or not, last 4 characters, source (CMS / environment) |
| PUT | `/admin/integrations/:id` | `UpdateIntegrationInput` (`null` removes a value); secrets stored encrypted |
| POST | `/admin/integrations/:id/test` | `ConnectionTest` |
| PUT | `/admin/social-accounts/:id/token` | `SetTokenInput` (`null` removes) → `SocialAccountDto` |
| POST | `/admin/social-accounts/:id/test` | `ConnectionTest` (Telegram, Facebook, Instagram) |
| GET / PUT | `/admin/site` | `SiteSettings` (read: any staff; write: admin); revalidates the site's `site` tag |

### Site settings

| Method | Path | Role | |
| --- | --- | --- | --- |
| GET | `/admin/sources` | any | `SourceDto[]` |
| POST | `/admin/sources` | editor, developer | `CreateSourceInput` (name + link) → `pending_dev`; emails the developers |
| POST | `/admin/sources/bulk` | editor, developer | `BulkSourcesInput` (up to 50 links) → `BulkSourcesResult`; each gets an automatic setup job |
| POST | `/admin/sources/:id/autodetect` | editor, developer | 202 `{ jobId }`: detect the feed, save and test the trigger |
| POST | `/admin/sources/approve-tested` | developer | approves every configured site whose saved trigger passed its test |
| PUT | `/admin/sources/:id/config` | developer | `ConfigureSourceInput` (method, list URLs, `SelectorConfig`); a changed trigger must be re-tested |
| POST | `/admin/sources/:id/test` | developer | `ConfigureSourceInput` → `SourceTestResult` (dry run, nothing saved) |
| POST | `/admin/sources/:id/approve` | developer | needs a saved config with a passing test → `active` |
| POST | `/admin/sources/:id/status` | developer | `active` (approved only) · `paused` · `archived` |

### Discovery

| Method | Path | Role | |
| --- | --- | --- | --- |
| POST | `/admin/discovery/runs` | editor | 202 `{ runId, created }`; returns the running one if a run is in progress |
| GET | `/admin/discovery/runs?limit=` | any | `RunDto[]` (date, counts, per-source results) |
| GET | `/admin/discovery/runs/latest` | any | `RunDetail \| null` |
| GET | `/admin/discovery/runs/:id` | any | `RunDetail` (items with source, image, title, first paragraph, section) |
| POST | `/admin/discovery/items/:id/pull` | editor | add an item from an older run to the latest run |
| POST | `/admin/discovery/save` | editor | `SaveSelectionInput` (`magazine` or `single` + color) → `SaveSelectionResult`; queues the AI |

### Manual entry and media

| Method | Path | Role | |
| --- | --- | --- | --- |
| POST | `/admin/manual/url` | editor | `ManualUrlInput` → `{ draftId }` (page read through the SSRF guard, AI rewrite queued) |
| POST | `/admin/manual/write` | editor | `ManualWriteInput` → `{ draftId }` |
| POST | `/admin/media` | editor | multipart `file` (+ `alt`, `credit`), ≤ 15 MB → `MediaDto` with all renditions |
| GET/PATCH | `/admin/media/:id` | any / editor | `UpdateMediaInput` (alt, credit, focal point → re-cut renditions) |

### Saved edits and the editor

| Method | Path | Role | |
| --- | --- | --- | --- |
| GET | `/admin/saved` | any | `SavedEdits` (magazines + single articles) |
| GET/PATCH | `/admin/magazines/:id` | any / editor | `MagazineDetail`; rename |
| POST | `/admin/magazines/:id/archive` | editor | |
| GET | `/admin/drafts/:id` | any | `DraftDetail` (canvas, original, nav, active AI job) |
| PUT | `/admin/drafts/:id/content` | editor | `AutosaveInput` → `AutosaveResult`; 409 `version_conflict` / `text_locked` / `ai_busy` |
| PATCH | `/admin/drafts/:id` | editor | `DraftMetaInput`: section, placement, tags, byline, color, push, main image |
| POST | `/admin/drafts/:id/refine` | editor | `RefineInput` → 202 `{ jobId }` |
| GET | `/admin/drafts/:id/chat` | any | `ChatMessageDto[]` |
| POST | `/admin/drafts/:id/retry-ai` | editor | re-run the first rewrite |
| GET/POST | `/admin/drafts/:id/images` | any / editor | batches of 4 · `GenerateImagesInput` → 202 `{ jobId }` |
| POST | `/admin/drafts/:id/finalize` · `/reopen` · `/skip` · `/unskip` | editor | text final (opens social) · back to editing · not for publishing |
| GET | `/admin/drafts/:id/revisions` | any | history |
| POST | `/admin/drafts/:id/revisions/:revisionId/restore` | editor | |
| GET | `/admin/jobs/:id` | any | `JobRef` (poll an AI job) |

### Social networks (after the text is final)

| Method | Path | Role | |
| --- | --- | --- | --- |
| GET | `/admin/drafts/:id/social` | any | `SocialPackageDto` (409 `text_not_final` before) |
| PUT | `/admin/drafts/:id/social` | editor | `UpdateSocialInput` (optimistic version; story image must differ from the main image) |
| POST | `/admin/drafts/:id/social/generate` | editor | `GenerateSocialInput` (`text` / `image` / `both`, optional comment) |
| PUT | `/admin/drafts/:id/social/targets` | editor | `SocialTargetsInput` |
| POST | `/admin/drafts/:id/social/approve` | editor | checks: headline, ≤ 2 sentences, story image ≠ main image |

### Preview and publishing

| Method | Path | Role | |
| --- | --- | --- | --- |
| GET | `/admin/magazines/:id/preview` · `/admin/drafts/:id/preview` | any | `PublishPreview` (date, editor, tags, networks, what's missing) |
| POST | `/admin/magazines/:id/publish` · `/admin/drafts/:id/publish` | editor | `PublishInput` (idempotency key) → 202 `{ publishJobId }`; 422 lists what isn't ready |
| GET | `/admin/publish-jobs/:id` | any | `PublishJobDto` with per-step results (`<draft>:site`, `revalidate`, `<draft>:<platform>:<account>`) |

### Comment moderation

| Method | Path | Role | |
| --- | --- | --- | --- |
| GET | `/admin/comments?status=&reported=` | any | held (`hidden`) and reported first |
| PATCH | `/admin/comments/:id` | editor | `{ status: visible \| hidden \| removed, note? }` |
| POST | `/admin/readers/:id/ban` | editor | `{ reason, hideComments }`; ends the reader's sessions |

## Site cache revalidation (site side)

`POST {site}/api/revalidate` with header `x-revalidate-secret` and `{ "tags": [...] }`. Tags: `home`, `search`, `category:<slug>`, `article:<id>`, `article-slug:<slug>`.
