# B4 NEW'S

News platform: public site, AI-assisted CMS and mobile app. "B4" reads "before".
Design source: the "BIFOR NEW'S Design" canvas (homepage, mobile home, brand sheet).

```
apps/web/        Next.js public site (App Router, Tailwind v4)       ← built
services/api/    FastAPI backend + Celery workers                   ← next
apps/admin/      CMS (split-screen AI editor)                       ← later
apps/mobile/     Expo app                                           ← later
db/schema.sql    PostgreSQL schema (source of truth until Alembic)
docs/            ARCHITECTURE.md, API.md
brand/           Seal logo: b4-logo (light, dark, white), b4-mark (seal only), b4-icon (app);
                 options/ = the B4 directions considered; previous/ = earlier logos
```

## Run the site

Requires Node.js 20+.

```bash
cd apps/web
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000. With `API_URL` empty the site runs on built-in sample data
(`lib/mock.ts`), so the design can be reviewed before the backend exists.

Pages: `/` home · `/article/<slug>` · `/category/<slug>` · `/search?q=` · `/a/<id>` (short link, redirects).

## Run the database

Requires Docker.

```bash
docker compose up -d db redis
```

On first start PostgreSQL loads `db/schema.sql` (tables, enums, the 12 categories, the rewrite prompt).
To reload it from scratch: `docker compose down -v && docker compose up -d db`.

## How the site gets fresh content

Pages are server-rendered and cached (ISR). Every API fetch is tagged; after publishing, the backend calls:

```
POST /api/revalidate
x-revalidate-secret: <REVALIDATE_SECRET>
{ "tags": ["home", "category:real-estate", "article:123", "article-slug:<slug>"] }
```

| Tag | Covers |
|---|---|
| `home` | homepage, ticker, trending sidebar, sitemap |
| `category:<slug>` | category page, related articles |
| `article:<id>` / `article-slug:<slug>` | article page |
| `markets` | market quotes (also refreshed every 60 s) |

The public API returns camelCase JSON matching `apps/web/lib/types.ts`.

## Open items

- Social profile and channel URLs: `apps/web/lib/site.ts` (`SOCIAL`, `CHANNELS`) are `#` placeholders.
- Podcasts ("BIFOR TALK") are sample data; the schema has no podcasts table yet.
- Static pages linked from the footer (about, contact, accessibility statement, privacy, terms) are not written yet.
