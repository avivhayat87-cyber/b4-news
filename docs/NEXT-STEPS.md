# Build status and next steps

## Done
- Brand: B4 seal logo set (`brand/`), design canvas with the owner's latest edits
  (white header with large logo + red section links, ticker inside the hero area,
  footer as a separate piece that opens with the red app banner).
- `apps/web`: Next.js site (built before the owner's header/footer edits; needs updating).
- `db/schema.sql`, `docs/ARCHITECTURE.md`, `docs/API.md`: first data model and API design.
- Tooling: Node.js v24.20.0 (portable, `C:\Users\avivh\Tools\node-v24.20.0-win-x64`, on user PATH).
- Root workspace files: `package.json` (npm workspaces), `tsconfig.base.json`, `.gitignore`.

## Decisions made with the owner
- Project folder: `C:\Users\avivh\Projects\b4-news`.
- Comments: registered readers only (email one-time code), published immediately,
  automatic abuse/spam filter, report button, moderation from the CMS.
- New category: תיירות (tourism, slug `tourism`).
- Stack: TypeScript end to end (one language for site, app, API, CMS):
  Fastify + zod + Drizzle ORM (PGlite locally, PostgreSQL in production), Next.js (web, admin),
  Expo (mobile), BullMQ workers.

## Next, in order
1. Git: install (user scope) and make the first commit.
2. `packages/shared` (categories incl. tourism, zod schemas) and `packages/db` (Drizzle schema
   from `db/schema.sql` + readers, sessions, login codes, comments, comment reports,
   `scrape_run_items`, draft color labels; seed with the sample content).
3. `apps/api`: security plugins (helmet, CORS allowlist, rate limits, cookies), public API,
   reader auth, comments, staff auth. Tests with Vitest + PGlite.
4. `apps/web`: apply the owner's design edits, tourism, comments UI, read from the API.
5. `apps/mobile`: Expo app (home carousel of 7, trending 14, feed, categories, saved, search,
   push, deep links `/a/<id>`).
6. `apps/admin` + `apps/worker`: the newsroom CMS following the owner's process
   (discovery runs, run history and pulling items into the latest run, manual entry by link or
   writing, source settings with developer approval, saved edits with color labels and magazines,
   split-screen AI editor with auto-save, 4 AI images, main/trending/category, skip,
   preview + final approval, social package with story image and link in the first comment,
   learning loop from the editors' fixes).
