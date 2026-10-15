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
| GET | `/public/site` | `PublicSite`: links (empty ones omitted), contact, info-page titles, `consent` (terms version to accept) |
| GET | `/public/pages/:slug` | `PublicPage`: about, contact, advertise, accessibility, privacy, terms, comment-rules (company details filled in) |
| POST | `/public/newsletter` · `/public/newsletter/confirm` | `NewsletterSignupInput` (terms checkbox required, recorded in `consents`); double opt-in. `confirm` answers `{ id, token }` so the page can offer the personal issue right away |
| GET / PUT | `/public/newsletter/preferences/:id/:token` | `DigestPrefs` of a subscriber without an account (the signed link in every issue): topics in order, the hour, daily or weekly; always by mail |
| POST | `/public/newsletter/unsubscribe` | `UnsubscribeInput` (signed link from every newsletter) |
| POST | `/public/newsletter/unsubscribe/:id/:token` | one-click unsubscribe from the mail client (RFC 8058, the `List-Unsubscribe` header) |
| POST | `/public/consent` | `VisitorConsentInput`: the consent banner (site) or welcome screen (app); 409 `terms_changed` for an old version |
| POST | `/public/takedown` | `TakedownInput`: a content-removal request from anyone; 5/hour; mails a confirmation |
| POST/DELETE | `/public/devices` · `/public/devices/:pushToken` | push registration (app); with the reader's bearer token the device is linked to them (replies and likes reach it), without it the link is cleared |
| POST | `/public/notifications/mail-off/:id/:token` | one-click stop of the mails about replies and likes (the List-Unsubscribe header of those mails) |
| POST | `/public/digest/mail-off/:id/:token` | one-click stop of a reader's personal issue by mail (the List-Unsubscribe header of that mail) |

## Comments and readers

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/public/articles/:id/comments?sort=top\|new&cursor=` | `CommentList` (`top`: the editors' picks, then the most liked); each comment has `likeCount`, `likedByMe`, `picked` and `replyTo` ("@name"); the viewer also sees their own comments held for review |
| POST / DELETE | `/comments/:id/like` | → `LikeResult`; one like each, never your own (400 `own_comment`); the author is notified (likes on one comment gather into one notice) |
| POST | `/articles/:id/comments` | `CreateCommentInput`; reader session; automatic filter; 5/min, 50/day; 409 `terms_required` after a new terms version |
| DELETE | `/comments/:id` | own comment |
| POST | `/comments/:id/report` | `ReportCommentInput`; 3 reports hide the comment |
| POST | `/auth/reader/request-code` | `RequestCodeInput` (`email`, `acceptTerms?`, `returnTo?` a path on the site) → always 204 (no account enumeration). The mail has the code and a one-click link, `<site>/signin#t=<token>` |
| POST | `/auth/reader/verify` | `VerifyCodeInput` → `ReaderSession` (cookie for web, token for the app); 409 `name_required` on first sign-in, 409 `terms_required` without `acceptTerms` (new readers, or a new terms version) |
| POST | `/auth/reader/verify-link` | `VerifyLinkInput` (the token from the link's `#`, `displayName?`, `acceptTerms?`) → `ReaderLinkSession` with `returnTo`, and the session cookie; the same 409s as `verify`; 400 `link_invalid`. Single use, and it uses up the code too |
| GET | `/auth/reader/session` | `{ reader \| null }`; `reader.termsAccepted` is false after a new terms version |
| GET/PATCH | `/auth/reader/me` | profile |
| POST | `/auth/reader/terms` | `AcceptTermsInput` → `ReaderDto`; 409 `terms_changed` for an old version |
| DELETE | `/auth/reader/me` | deletes the account, its comments, reports, sessions and consents (also allowed for banned readers) |
| POST | `/auth/reader/logout` | |
| GET | `/auth/reader/notifications` | `ReaderNotificationList`: the latest 30 (replies, likes, the editors' pick) and the unread count |
| POST | `/auth/reader/notifications/read` | `{ ids? }` → 204; without ids, all. Seen notices are not mailed |
| GET / PUT | `/auth/reader/prefs` | `ReaderPrefs` (`notifyEmail`: one gathered mail at most an hour after the first notice; `notifyPush`) |
| GET / PUT | `/auth/reader/digest` | `DigestPrefs`, "העיתון שלי": topics in the reader's order, the hour (Israel time), `daily` or `weekly` (Sunday), by mail and/or phone push. Off until the reader turns a channel on |
| GET | `/auth/reader/feed?mode=for-you\|new\|popular&cursor=&seed=` | `FeedPage`: articles in the reader's topics (all topics when none are chosen) with the comment count and the top comment (the editors' pick, then the most liked) and its replies. `for-you` mixes fresh and lively with a light shuffle per `seed` (one per visit); `popular` is the week's most discussed |

## Staff sign-in

| Method | Path | |
| --- | --- | --- |
| POST | `/auth/staff/login` | `StaffLoginInput` → `StaffLoginResult`: signed in (`staff` + cookie), or `twoFactor: code \| setup` with a `challenge` (5 minutes, 5 tries) when two-step sign-in is on or required (10 attempts / 15 min) |
| POST | `/auth/staff/login/2fa-setup` | `{ challenge }` → `TwoFactorSetupDto` (QR code and secret), when required but not set up yet |
| POST | `/auth/staff/login/2fa` | `{ challenge, code }` (6 digits from the app, or a recovery code) → `StaffTwoFactorResult` + cookie; right after a setup, the 10 recovery codes once. 400 `code_invalid`, 401 `challenge_expired` |
| GET | `/auth/staff/me` | `StaffDto` |
| POST | `/auth/staff/logout` | |

## CMS (`/admin`, staff only)

Roles: **viewer** reads only · **editor** content work · **developer** site triggers · **admin** everything, users, social accounts, style rules.

### Dashboard, learning, settings

| Method | Path | Role | |
| --- | --- | --- | --- |
| GET | `/admin/dashboard` | any | `DashboardDto` (with `review.waiting`: articles the legal review stopped) |
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
| GET | `/admin/me/2fa` | any | `TwoFactorStatus` (on since, recovery codes left, required by the newsroom) |
| POST | `/admin/me/2fa/setup` · `/admin/me/2fa/enable` | any | the QR code, then `{ code }` from the app → `{ recoveryCodes }` (shown once) |
| POST | `/admin/me/2fa/disable` | any | `{ password, code }`; refused (409 `required`) when the newsroom requires it |
| POST | `/admin/me/2fa/recovery-codes` | any | `{ code }` → ten new recovery codes (the old ones stop working) |
| POST | `/admin/users/:id/reset-2fa` | admin | a lost phone: clears the setup and signs the user out |
| GET / PUT | `/admin/security` | admin | `SecuritySettings` (`requireTwoFactor`); 409 `enable_yourself_first` for an admin without it |

### Settings (admin)

| Method | Path | |
| --- | --- | --- |
| GET | `/admin/integrations` | `IntegrationStatus[]` (Claude, Gemini, SMTP, the Meta app): configured or not, last 4 characters, source (CMS / environment) |
| PUT | `/admin/integrations/:id` | `UpdateIntegrationInput` (`null` removes a value); secrets stored encrypted |
| POST | `/admin/integrations/:id/test` | `ConnectionTest` |
| PUT | `/admin/social-accounts/:id/token` | `SetTokenInput` (`null` removes) → `SocialAccountDto`. Facebook and Instagram: a personal token is made into the page's own, which never expires (needs the Meta app's secret when it is short-lived); a page token that expires is refused (`422`, with what to paste); rate-limited |
| POST | `/admin/social-accounts/:id/test` | `ConnectionTest` (Telegram, Facebook, Instagram; for Meta also that the page token never expires) |
| GET / PUT | `/admin/site` | `SiteSettings` (read: any staff; write: admin; the terms version is never changed by a PUT); revalidates the site's `site` tag |
| GET | `/admin/site/defaults` | the built-in text of every info page ("restore the default text") |
| POST | `/admin/site/legal-version` | publishes a new terms version (today's date): every reader is asked to accept again |

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
| PATCH | `/admin/sources/:id` | editor, developer | `{ name }`: the name shown in discovery and credited in articles |

`CreateSourceInput` and `BulkSourcesInput` take `region`: `local` (default) or `international`. International sites keep their own-language feeds during setup, and their language is recorded (`SourceDto.language`).

### Discovery

| Method | Path | Role | |
| --- | --- | --- | --- |
| POST | `/admin/discovery/runs` | editor | `{ region }` (`local` default · `international`) → 202 `{ runId, created }`; returns the running one if a run of that region is in progress |
| GET | `/admin/discovery/runs?region=&limit=` | any | `RunDto[]` of one region (date, counts, per-source results) |
| GET | `/admin/discovery/runs/latest?region=` | any | `RunDetail \| null`; foreign items carry `language`, and `titleHe` / `introHe` once translated |
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
| PATCH | `/admin/drafts/:id` | editor | `DraftMetaInput`: section, placement, tags, byline, color, push, main image, disclosure |
| GET | `/admin/drafts/:id/similarity` | any | `SimilarityDto`: how much of the draft repeats the original word for word (the Hebrew translation of a foreign original) |
| POST | `/admin/drafts/:id/update-article` | editor | → `{ slug }`: the edited draft of an article already on the site replaces it in place (same id and address, home page position kept) and the site is refreshed; 422 `not_ready` when something is missing |
| GET | `/admin/articles?status=published\|unpublished&q=&category=&cursor=` | any | `PublishedArticleList` ("כתבות באתר"): `PublishedArticleDto[]` and `nextCursor` |
| POST | `/admin/articles/:id/edit` | editor | → `{ draftId }`: opens the article in the editor (its draft reopens, or one is made from it); the site changes only on `update-article` |
| POST | `/admin/articles/:id/unpublish` | editor | 204: off the site and the home page at once; restorable |
| POST | `/admin/articles/:id/republish` | editor | 204: back at its address and date |
| DELETE | `/admin/articles/:id` | admin | 204: deleted for good with its comments; only an article already off the site (409 `still_published`) |
| GET | `/admin/drafts/:id/facts` | any | `FactCheckDto`: numbers, percentages, amounts and years of the source missing from the draft, and ones the source doesn't have |
| POST | `/admin/drafts/:id/refine` | editor | `RefineInput` → 202 `{ jobId }` |
| GET | `/admin/drafts/:id/chat` | any | `ChatMessageDto[]` |
| POST | `/admin/drafts/:id/retry-ai` | editor | re-run the first rewrite |
| GET/POST | `/admin/drafts/:id/images` | any / editor | `DraftImagesDto` (batches of 3 quick drafts, each with its description and `promptBy`) · `GenerateImagesInput` → 202 `{ jobId }`; without a `prompt` the visual agent writes the description |
| POST | `/admin/drafts/:id/finalize` · `/reopen` · `/skip` · `/unskip` | editor | text final (opens social) · back to editing · not for publishing |
| GET | `/admin/drafts/:id/revisions` | any | history |
| POST | `/admin/drafts/:id/revisions/:revisionId/restore` | editor | |
| GET | `/admin/jobs/:id` | any | `JobRef` (poll an AI job) |

### The research reporter (manual entry: from a link or screenshots)

A research is a `research.run` job (one attempt) and then a `research.archive` job (the proof of its sources). A month's research stops at the reporter's budget.

| Method | Path | Role | |
| --- | --- | --- | --- |
| GET | `/admin/research` | any | `ResearchOverviewDto`: the 20 latest research (without their files), this month's estimated spend and the budget, the default depth |
| POST | `/admin/research/similar` | editor | `{ url }` → `SimilarStoryDto[]`: articles and drafts from the same link; or `{ text }`: recent ones with similar headlines (free, no AI) |
| POST | `/admin/research` | editor | `StartResearchInput` (`kind` link · screenshot · idea, `url` or `mediaIds` (≤4 uploaded images), `note` (for an idea, the idea itself, 10+ characters), `depth` quick (default) · regular · deep, magazine or color) → 202 `ResearchTaskDto` (10/min, audited); 409 `research_budget` when the month's budget is spent |
| GET | `/admin/research/:id` | any | `ResearchTaskDto` with its file: every detail with its label and sources, the sources with their proof (`archive`: saved, when, `hasText`, the screenshot's address), the sources line, similar stories |
| POST | `/admin/research/:id/retry` | editor | → 202 `ResearchTaskDto`: a failed research again (a file already made is kept; only the writing is redone); 409 otherwise |
| POST | `/admin/research/:id/archive` | editor | → 202 `ResearchTaskDto`: keep the sources again (the ones not saved yet) |
| GET | `/admin/research/:id/sources/:sourceId/text` | any | `SourceCopyDto`: the copy of a source's text kept as proof |
| GET | `/admin/drafts/:id/research` | any | `ResearchTaskDto` the draft was written from, or `null` |
| GET / PUT | `/admin/agent/researcher-settings` | any / admin | `ResearcherSettings` (`monthlyBudgetUsd`, `defaultDepth`, `approvedSources`: a site or an account address per line, `screenshots`); a change is audited |

### The official-sources registry

| Method | Path | Role | |
| --- | --- | --- | --- |
| GET | `/admin/official-sources` | any | `RegistryOverviewDto`: every body with its domains and accounts (verified · pending · missing, with the evidence page), the last weekly check, whether one is running |
| POST | `/admin/official-sources` | admin | `OfficialSourceInput` (`name`, `kind`, `homepage`, `domains`, `active`) → 201 `OfficialSourceDto` (audited); 409 `source_exists` |
| PUT · DELETE | `/admin/official-sources/:id` | admin | `OfficialSourceInput` → `OfficialSourceDto` · 204 (audited) |
| POST | `/admin/official-sources/:id/accounts` | admin | `{ url }` → `OfficialSourceDto`: an account added by hand, verified (audited); 422 `not_an_account` |
| POST | `/admin/official-sources/:id/accounts/approve` · `/remove` | admin | `{ url }` → `OfficialSourceDto` (audited) |
| POST | `/admin/official-sources/update` | editor | → 202 `{ queued }`: the weekly check now (5/min) |

### The editorial meeting

| Method | Path | Role | |
| --- | --- | --- | --- |
| GET | `/admin/meetings` | any | `MeetingDto[]`: the 5 latest meetings, newest first, each pitch with the research it became (status, draft, whether something rests on an official source) |
| GET | `/admin/meetings/:id` | any | `MeetingDto` |
| POST | `/admin/meetings` | editor | `StartMeetingInput` (`focus`, optional) → 202 `MeetingDto` (5/min, audited): a `meeting.run` job; 409 `meeting_running`, `nothing_to_meet` (fewer than 5 discovered articles in the last 36 hours) or `research_budget` |
| POST | `/admin/meetings/:id/pitches/:pitchId/approve` | editor | `ApprovePitchInput` (`title`, `angle`, `depth`, magazine or color; all optional) → `MeetingDto` (audited): starts an idea research; 409 `pitch_decided`, `research_budget` |
| POST | `/admin/meetings/:id/pitches/:pitchId/reject` | editor | → `MeetingDto`: "not now"; 409 when it is already approved |
| GET / PUT | `/admin/agent/meeting-settings` | any / admin | `MeetingSettings` (`morning`: hold the meeting by itself every day, `hour` 5–12 in Israel, `focus`, `skipSaturday`); a change is audited. A morning meeting's `MeetingDto` has `auto: true` |

### The legal review (after the text is final, before publishing)

Marking the text final queues `review.check` (unless the reviewer is turned off). While a risk waits for a decision, or the check is running or didn't finish, the preview lists it as a problem and publishing answers 422 `not_ready`.

| Method | Path | Role | |
| --- | --- | --- | --- |
| GET | `/admin/reviews` | any | `DraftReviewDto[]`: the final drafts the review stopped (`flagged`) or whose check didn't finish (`failed`) |
| GET | `/admin/drafts/:id/review` | any | `DraftReviewDto`: `state` (checking · clear · flagged · resolved · failed · waived, `null` when never checked), every risk with the passage, why, the advice, the AI's safer wording and the decision |
| POST | `/admin/drafts/:id/review` | editor | → 202 `{ jobId }` (20/min): check again; a decision on a passage that is still there carries over |
| POST | `/admin/drafts/:id/review/issues/:issueId/decide` | editor | `DecideReviewInput` → `DraftReviewDto` (audited): `approve` (needs a `reason`), `caution` (puts the safer wording into the text; 409 `no_fix` before there is one, 422 `passage_gone`), `awaiting_response` (still blocks), `response_added` (needs the `response`, added at the end of the article), `no_response` (adds "no response was received"), `reject` (the draft is marked "don't publish") |
| POST | `/admin/drafts/:id/review/issues/:issueId/fix` | editor | → 202 `{ jobId }` (20/min): the AI writes a safer wording of the passage (the main model); nothing changes in the text until `caution` |
| POST | `/admin/drafts/:id/review/waive` | editor | `WaiveReviewInput` (`reason`) → `DraftReviewDto` (audited): publish without a check that didn't finish; 409 otherwise |

### The distribution plan (after the text is final, before publishing)

Marking the text final queues `social.plan` (unless `autoPlan` is off): the social editor chooses the frame, the formats and whether to recommend a reel, with its reasons, and writes the texts. Publishing the article copies the plan to `article_shares` and posts it (when `autoPost` is on).

| Method | Path | Role | |
| --- | --- | --- | --- |
| GET | `/admin/social/plans` | any | `SocialPlanReport`: every draft whose text is final and not yet published with its plan (`pending`), the plans published in the last 3 days with their posts and reel stage (`recent`), and `autoPost` |
| GET | `/admin/drafts/:id/social-plan` | any | `SocialPlanDto` (`state`: none · writing · ready · stale · failed · off · published) |
| PUT | `/admin/drafts/:id/social-plan` | editor | `UpdateSocialPlanInput` (optimistic version): frame, `formats` (adding `reel` approves the reel; audited), texts, `enabled`, reel idea and length, background image → `SocialPlanDto`, re-rendered; 409 `plan_applied` once published |
| POST | `/admin/drafts/:id/social-plan/regenerate` | editor | `RegenerateSocialPlanInput` (`instruction?`) → 202 `{ jobId }` (20/min): new texts; a person's frame, formats and reel stay |

### Social networks: the older package (after the text is final)

The editor's social tab now shows the distribution plan. These endpoints stay for packages made before it; an approved package goes out on publishing only when the draft has no plan.

| Method | Path | Role | |
| --- | --- | --- | --- |
| GET | `/admin/drafts/:id/social` | any | `SocialPackageDto` (409 `text_not_final` before) |
| PUT | `/admin/drafts/:id/social` | editor | `UpdateSocialInput` (optimistic version; story image must differ from the main image) |
| POST | `/admin/drafts/:id/social/generate` | editor | `GenerateSocialInput` (`text` / `image` / `both`, optional comment) |
| PUT | `/admin/drafts/:id/social/targets` | editor | `SocialTargetsInput` |
| POST | `/admin/drafts/:id/social/approve` | editor | checks: headline, ≤ 2 sentences, story image ≠ main image |

### The social page (articles already on the site)

| Method | Path | Role | |
| --- | --- | --- | --- |
| GET | `/admin/social/articles?filter=&q=&page=` | any | `ShareList`: published articles, `pending` (not posted yet, default) · `shared` · `all` |
| GET | `/admin/social/articles/:articleId` | any | `ShareDto`: the kit, the chosen `formats`, the rendered post (4:5) and story (9:16), the reel (`plan`: stage and Hebrew prompts; picture, cover, video, settings, cost estimate), the text per account, what was posted |
| PUT | `/admin/social/articles/:articleId` | editor | `UpdateShareInput` (optimistic version; `0` creates; optional `formats`, `reelSettings`) → `ShareDto`, re-rendered |
| POST | `/admin/social/generate` | editor | `GenerateSharesInput` (up to 20 articles, optional instruction and `formats`) → 202 `{ jobIds }`; never makes a video |
| POST | `/admin/social/articles/:articleId/reel/prompts` | editor | `ReelPromptsInput` (`instruction?`) → 202 `{ jobId }` (6/min): the AI writes the picture and video prompts in Hebrew; 422 `no_kit` before the post text exists; 409 `reel_busy` while a step runs |
| PUT | `/admin/social/articles/:articleId/reel/prompts` | editor | `UpdateReelPromptsInput` → `ShareDto`: the editor's wording |
| POST | `/admin/social/articles/:articleId/reel/image` | editor | 202 `{ jobId }`: prompts approved, a new picture (Gemini, from the English translation) and its branded cover; a new picture drops the old video |
| POST | `/admin/social/articles/:articleId/reel/video` | editor | 202 `{ jobId }`: picture approved, a Veo video from the clean picture; 409 `no_picture` before there is one |
| POST | `/admin/social/articles/:articleId/reel/approve` | editor | → `ShareDto`: the video is approved; only approved reels are published (`/social/publish` answers 422 `no_reel` otherwise). Recorded as a learning case for the visual agent. A reel approved in the article's distribution plan is posted now, to the accounts that take reels |
| GET | `/admin/social/targets` | any | `ShareTargetDto[]`: active accounts, connected or not, which formats post automatically |
| POST | `/admin/social/publish` | editor | `PublishSharesInput` (articles × formats × accounts) → 202 `{ jobId }`; a post that went out is never sent again |
| POST | `/admin/social/articles/:articleId/posted` | editor | `{ accountId, format }`: a prepared post was posted by hand |

### The agent team and their skills

| Method | Path | Role | |
| --- | --- | --- | --- |
| GET | `/admin/agents` | any | `AgentTeamDto`: every agent (`chief`, `reporter`, `rewrite`, `reviewer`, `social`, `visual`, `translator`, `learning`) with its model, whether it is live, its skills (the version in use, who wrote it), the newsroom rules, and the fixed rules |
| GET | `/admin/agents/usage?period=all\|day\|month\|year\|custom&from=&to=` | any | `AgentUsageReportDto`: what each agent did and cost in the period (calls, tokens, estimated cost; `partial` when some calls have no known price), and all of them together. Days are Israel time; `custom` takes `from` and `to` (YYYY-MM-DD, both included). Default `month` |
| GET | `/admin/skills/:key` | any | `SkillDto`: every version (newest first), which one is in use, the markers a new version must keep; 404 for an unknown key |
| PUT | `/admin/skills/:key` | admin | `SaveSkillInput` → `SkillDto`: a new version, in use at once (audited); 422 `missing_placeholder` when a marker such as `{{style_rules}}` is gone |
| POST | `/admin/skills/:key/versions/:version/restore` | admin | → `SkillDto`: the older version comes back as a new version under the admin (audited) |

### The newsroom agent

| Method | Path | Role | |
| --- | --- | --- | --- |
| GET | `/admin/agent/status` | any | `AgentStatusDto`: live or demo, the model, the tools this person may use |
| GET | `/admin/agent/conversations` · `/:id` | any (own only) | `AgentConversationSummary[]` · `AgentConversationDto` |
| POST | `/admin/agent/messages` | any (viewers get read tools only) | `SendAgentMessageInput` → 202 `{ conversationId }`; 409 while working or awaiting approval |
| POST | `/admin/agent/conversations/:id/decide` | any (the tool checks the role) | `DecideActionInput` (`approve` true/false) for a proposed change |
| GET / PUT | `/admin/agent/editor-settings` | any / editor | `EditorAgentSettings` (divergence, length, voice, instructions; facts are always kept) |
| GET | `/admin/agent/learning-reports` | any | `LearningReportDto[]`: one per publish batch |
| GET / PUT | `/admin/agent/reviewer-settings` | any / admin | `ReviewerSettings` (`enabled`: check every final text; `emailAdmins`); a change is audited |
| GET | `/admin/agent/social` | any | `SocialAgentOverview`: the social editor's settings, the plans the editors changed (which every new plan reads), counts for the last 30 days |
| PUT | `/admin/agent/social-settings` | editor | `SocialAgentSettings` (`autoPlan`, `autoPost`, instructions, when a reel is worth it) |
| GET | `/admin/agent/visual` | any | `VisualAgentOverview`: the visual agent's model, pending and learned cases, recent cases, rule versions with what each pass learned, last learning error |
| GET / PUT | `/admin/agent/visual-settings` | any / editor | `VisualAgentSettings` (article style, reel style, instructions, what to avoid, auto-learning) |
| POST | `/admin/agent/visual/learn` | editor | → 202 `{ jobId }`: learn now from the pending cases (409 `nothing_to_learn` when there are none) |
| PUT | `/admin/agent/visual/rules` | admin | `{ rules }` → 204: the admin's own wording becomes the active version |
| POST | `/admin/agent/visual/profiles/:id/activate` | admin | → 204: restore an older version of the rules |
| GET / POST | `/admin/agent/tokens` | any (own) | `ApiTokenDto[]` · `CreateApiTokenInput` → `CreatedApiToken` (the secret is shown once) |
| POST | `/admin/agent/tokens/:id/revoke` | any (own) | |
| GET | `/admin/agent/mcp-config` | any | `McpConfigDto`: the command for the Claude app's config |
| GET | `/admin/agent/tools` | any | `AgentToolDef[]` (the MCP server lists these) |
| POST | `/admin/agent/tools/:name` | per tool | `RunAgentToolInput` → `AgentToolResult` |

A personal access token (`Authorization: Bearer b4s_…`) reaches only `/admin/agent/tools*`; everything else answers 403.

### Preview and publishing

| Method | Path | Role | |
| --- | --- | --- | --- |
| GET | `/admin/magazines/:id/preview` · `/admin/drafts/:id/preview` | any | `PublishPreview` (date, editor, tags, networks, what's missing, warnings such as wording copied from the original) |
| POST | `/admin/magazines/:id/publish` · `/admin/drafts/:id/publish` | editor | `PublishInput` (idempotency key) → 202 `{ publishJobId }`; 422 lists what isn't ready |
| GET | `/admin/publish-jobs/:id` | any | `PublishJobDto` with per-step results (`<draft>:site`, `revalidate`, `<draft>:<platform>:<account>`) |

### Comment moderation

| Method | Path | Role | |
| --- | --- | --- | --- |
| GET | `/admin/comments?status=&reported=` | any | held (`hidden`) and reported first |
| PATCH | `/admin/comments/:id` | editor | `{ status: visible \| hidden \| removed, note? }` |
| POST | `/admin/readers/:id/ban` | editor | `{ reason, hideComments }`; ends the reader's sessions |

### Readers and newsletter subscribers ("מנויים וגולשים")

| Method | Path | Role | |
| --- | --- | --- | --- |
| GET | `/admin/audience` | any | `AudienceOverview`: counts only (readers, subscribers, app devices) and what this environment still needs (outgoing mail, a sender on the site's domain, company details, HTTPS) |
| GET | `/admin/readers?status=&q=&cursor=` | editor | `ReaderList` (personal details, so not for viewers): comments, hidden comments, signed in now, current terms accepted |
| GET | `/admin/readers/:id/comments` | editor | `AdminReaderComment[]`: everything the reader wrote, with status, likes and picks |
| POST | `/admin/comments/:id/pick` | editor | `{ picked }` → 204: "בחירת העורכים"; shown first, and the author is notified once |
| POST | `/admin/readers/:id/unban` | editor | → 204; comments hidden by the ban stay hidden |
| POST | `/admin/readers/:id/sign-out` | editor | → 204: ends every session of the reader |
| DELETE | `/admin/readers/:id` | admin | → 204: a privacy request; the account and its comments, reports, consents and codes |
| GET | `/admin/newsletter/subscribers?status=active\|pending\|unsubscribed\|all&q=&cursor=` | editor | `SubscriberList` |
| POST | `/admin/newsletter/subscribers/:id/unsubscribe` | editor | → 204: off the list; the row stays with the time, as the law asks |
| DELETE | `/admin/newsletter/subscribers/:id` | admin | → 204: a privacy request; the address and its consent records |

### Content-removal requests (notice and takedown)

| Method | Path | Role | |
| --- | --- | --- | --- |
| GET | `/admin/takedowns?view=open\|closed` | editor | `TakedownDto[]`: open ones oldest first, with the answer-by time (48 hours) |
| PATCH | `/admin/takedowns/:id` | editor | `DecideTakedownInput` (`in_review` · `removed` · `rejected`, note, hide the comment); mails the requester |

## Site cache revalidation (site side)

`POST {site}/api/revalidate` with header `x-revalidate-secret` and `{ "tags": [...] }`. Tags: `home`, `search`, `category:<slug>`, `article:<id>`, `article-slug:<slug>`.
