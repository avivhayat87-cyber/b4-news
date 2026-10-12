# Working without breaking the live site

Real work (articles, comments, readers, the CMS settings) and development never share a
place. Code changes are made and tried in the **workshop**; the **live environment** runs a
fixed, checked version and changes only through a release that can't leave it half-updated.

## Two environments

|                | Workshop (this repository)                | Live (`../b4-news-live`)                                   |
| -------------- | ----------------------------------------- | ---------------------------------------------------------- |
| What for       | Writing and trying code                    | The site readers use and the CMS editors work in           |
| Addresses      | API 4000 · site 3000 · CMS 3001            | API 4100 · site **3100** · CMS **3101**                    |
| Runs           | `npm run dev`: reloads on every file change | A built version, untouched by edits in the workshop        |
| Data           | `.data/b4`: sample articles, test runs     | `b4-news-live/data`: the real data, never seeded or reset  |
| AI, email      | Stand-ins when no key is set               | Real only (keys in the live CMS, Settings > Connections)   |
| Changes by     | Editing files                              | `npm run release` only                                     |

Breaking the workshop is fine and expected. The live environment only ever gets code that is
**committed** and has passed every check below. Uncommitted work in progress, or a session
halfway through a change, can't reach it.

## Releasing

```bash
npm run release              # the latest commit (HEAD)
npm run release -- <commit>  # or a specific commit, tag or branch
```

`scripts/live.mjs` then runs these steps, and stops at the first failure:

1. **A clean copy.** The committed version is exported into `b4-news-live/releases/<id>` with
   its own freshly installed packages. Nothing comes from the workshop's folders.
2. **Checks.** Type check (API, site, CMS, shared code), all tests, and the database change
   check (below).
3. **Rehearsal on a copy of the live data.** The live database is copied (the live API pauses
   for a few seconds), the new version's database changes run on the copy, and the counts of
   articles, comments, readers, drafts, media and the rest must not go down.
4. **Build** the site and the CMS. The site's first pages are rendered from the rehearsal.
5. **Test the rehearsal.** The home page, an article, a category, the sitemap and the CMS
   sign-in page must all load. The rehearsal never runs scans, AI, publishing or social posts.
6. **Switch over.** The live environment stops, the data is backed up, and the new version
   starts. Its database changes run on the real data.
7. **Test live.** The same pages are checked again. If anything fails, the release **rolls
   itself back**: the backup from step 6 is put back and the previous version starts again.

A failure in steps 1–5 never touches the live site. A failure in 6–7 leaves it as it was
before the release. Each release writes a full log to `b4-news-live/logs/release-<id>.log`.

## Rollback and backups

```bash
npm run live -- status            # running version, previous one, latest backups
npm run live -- rollback          # previous version, keeping the current data
npm run live -- backup            # copy the data now
npm run live -- restore           # list backups
npm run live -- restore <name>    # put one back (the replaced data is kept aside, never deleted)
npm run live -- start | stop | restart
npm run live -- logs [api|web|cms]
npm run live -- import-sources <file.json>   # news sites set up and tested in the workshop
```

The live environment keeps running when the terminal that started it closes. After the
computer restarts, start it again with `npm run live -- start`, or double-click
`b4-news-live\start-live.cmd`.

A backup is taken before every release, and the last 10 are kept. **Rollback** changes only
the code. Articles and comments written since the release stay. **Restore** goes back in
time and loses what was written after the backup, so it is for real emergencies.

## Rules that keep the data safe

**Database changes only add.** Add tables and columns, give new required columns a default,
and backfill in code. To remove or rename something, do it in two releases: first stop using
it, and only in a later release drop it. `npm run db:check` (part of every release) fails on
any of these unless the line above it says `-- data-safe: <why no live data is lost>`:

- DROP TABLE or DROP COLUMN
- DELETE or TRUNCATE
- RENAME
- changing a column's type
- SET NOT NULL

**Never edit a migration that went live.** It would not run again, and the live schema would
quietly differ from the code. Make a new one with `npm run db:generate`. The release compares
against the live version's migrations and refuses edits.

**The API stays backward compatible.** Add fields; don't rename or remove them in the same
release. The site, CMS and API always ship together, so they match. The mobile app on
people's phones doesn't, and keeps calling the old shapes until it is updated.

**Sample content and development settings never reach live.** The live API runs in
production mode, which refuses sample data, the sample sites, AI stand-ins and fetching
private addresses.

**Secrets are made once.** `b4-news-live/live.env` holds the live secrets. Never change
`SECRETS_KEY`: it decrypts the API keys saved in the CMS.

## Working in parallel

Several people or Claude sessions editing the same folder at once is how changes get tangled
and half-finished work gets mixed in. Instead:

- Give each task its own git branch and folder (a worktree):
  `git worktree add ../b4-news-<task> -b <task>`. In the Claude app, start the session in a
  worktree. Each one runs `npm run dev` on its own ports or at its own time.
- Commit when `npm run check` passes, and merge into `main` when the task is done.
- Release from `main`.

`npm run check` is the same gate the release runs: types, tests and database changes. Run it
before every commit. `.github/workflows/ci.yml` runs it on every push once the repository is
on GitHub.

## First time on a computer

The first `npm run release` creates `b4-news-live` with new secrets, an empty database
(categories only) and a first admin. The admin's password is in `b4-news-live/admin.txt`;
change it after signing in. Then, in the live CMS:

- Settings > Connections: the Claude, Gemini and email keys.
- Site settings: the news sites to scan.

`node` and `git` must be on the PATH.

## Moving to real hosting

The same flow carries over:

- The checks run in CI.
- The rehearsal becomes a staging server with a copy of production.
- The switch-over becomes a deploy with a health check.
- Production data goes to managed PostgreSQL with point-in-time backups, and media to object
  storage with versioning.

The rules above stay exactly the same.
