# The cloud server

The live site, CMS and API on one Google Compute Engine server in Tel Aviv (`me-west1`),
operated from the workshop computer with `npm run cloud -- <command>` (`scripts/cloud.mjs`).
Releases, backups and rollbacks on the server are `scripts/live.mjs`, exactly as on a computer
(docs/WORKFLOW.md); only where things live differs.

```
readers ─▶ Cloudflare (DNS, HTTPS, cache, WAF) ─▶ tunnel ─▶ server: site 3100 · CMS 3101 · API 4100
                    └─▶ media.b4news.co.il = the R2 bucket b4-media             └─▶ PostgreSQL 17 (local)
owner ─▶ gcloud (Google sign-in) ─▶ IAP tunnel ─▶ SSH        server ─▶ Vertex AI (its own identity, no key)
```

- **No open ports.** Readers come in through the Cloudflare tunnel (`cloudflared` connects out);
  SSH is accepted only from Google's IAP range, after the owner's Google sign-in.
- **The data:** PostgreSQL on the server (`/srv/b4/live/live.env` has its address); images and
  reels in the R2 bucket `b4-media`; nightly backups on the server and in the R2 bucket
  `b4-backups`; a snapshot of the whole disk every night, kept 7 days.
- **Secrets** are in `live.env` only (mode 600, user `b4`). Values are typed by the owner with
  `npm run cloud -- set <NAME>`; they travel in a file that is deleted at once.

## Files

| File | What |
| --- | --- |
| `setup.sh` | First-time install (Node 22, PostgreSQL 17, cloudflared, Ops Agent, security updates, swap, the `b4` user, `live.env`, systemd). Safe to run again. |
| `systemd/b4-live.service` | Starts the live environment at boot. |
| `systemd/b4-watchdog.*` | Every 3 minutes: starts it again if any part stopped answering. |
| `systemd/b4-backup.*` | Every night at 03:15: `live.mjs backup nightly` (also outside the server). |
| `ops-agent.yaml` | The live logs go to Cloud Logging. |
| `set-env.mjs` | Puts one value into `live.env` from a file (used by `cloud.mjs set`). |

## From nothing to live

1. **Owner:** install the Google Cloud CLI and sign in: `winget install Google.CloudSDK`,
   `gcloud auth login`, `gcloud config set project <project-id>`.
2. `npm run cloud -- create`: APIs, the server's identity (Vertex AI, logs, metrics only), the
   firewall (IAP SSH only; the default rules open to the internet are removed), the server,
   nightly disk snapshots, a budget alert.
3. `npm run cloud -- setup`
4. **Owner, in Cloudflare:** the domain's DNS on Cloudflare; R2 buckets `b4-media` (public
   through the custom domain `media.<domain>`) and `b4-backups` (private, a lifecycle rule
   deleting objects after 30 days); an R2 API token for both; a tunnel whose public hostnames
   point `<domain>` → `http://localhost:3100`, `cms.<domain>` → `http://localhost:3101`,
   `api.<domain>` → `http://localhost:4100`.
5. **Owner:** `npm run cloud -- set R2_ACCOUNT_ID`, `set R2_ACCESS_KEY_ID`,
   `set R2_SECRET_ACCESS_KEY`, then `npm run cloud -- tunnel` (the tunnel's token).
6. `npm run cloud -- move-data`: the computer's live database, media and secrets, once.
7. `npm run cloud -- release`
8. In the live CMS: Settings > Connections > Gemini: the model names Vertex AI serves.

## Day to day

`npm run cloud -- release [ref]` · `status` · `logs [api|web|cms]` · `backup` · `rollback`.
Restoring a backup, or anything else, is `live.mjs` on the server:
`gcloud compute ssh b4-server --zone me-west1-b --tunnel-through-iap`, then
`sudo -u b4 B4_LIVE_HOME=/srv/b4/live node /srv/b4/repo/scripts/live.mjs restore`.
