#!/usr/bin/env bash
# First-time setup of the cloud server (Ubuntu 24.04 on Google Compute Engine). Run once,
# as root, by `npm run cloud -- setup`; safe to run again (each step checks what is there), also
# on the live server: it neither upgrades every package nor restarts the database there.
#
#   sudo bash setup.sh <site-domain>        e.g. b4news.co.il
#
# What it leaves behind:
#   - Node.js 22, git, Google Chrome (screenshots of research sources), PostgreSQL 17 (local only, a "b4" role and database), cloudflared
#     (the tunnel to Cloudflare; started later with the token), the Google Ops Agent (logs
#     and metrics to Cloud Logging / Monitoring), automatic security updates, 2 GB of swap.
#   - A "b4" user that owns /srv/b4: repo/ (the code, updated by releases) and live/ (the
#     live environment of scripts/live.mjs: live.env, data, releases, backups, logs).
#   - systemd: b4-live (starts the site at boot), b4-watchdog (restarts it if it stops),
#     b4-backup (a nightly backup, also outside the server when R2_BACKUP_BUCKET is set).
set -euo pipefail

DOMAIN="${1:?usage: setup.sh <site-domain>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
export DEBIAN_FRONTEND=noninteractive

say() { echo "[setup] $*"; }

say "Israel time (backups, logs and release names read in local time)"
timedatectl set-timezone Asia/Jerusalem

# A server that is already live (it has live.env) only gets what is missing: a full upgrade could
# restart the database under the running site, and unattended-upgrades keeps it patched anyway.
LIVE=false
[ -f /srv/b4/live/live.env ] && LIVE=true

say "System updates and automatic security updates"
apt-get update -q
$LIVE || apt-get upgrade -yq
apt-get install -yq ca-certificates curl gnupg git unattended-upgrades
dpkg-reconfigure -f noninteractive unattended-upgrades

say "Swap (the site build needs room next to the running site)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

say "Node.js 22"
if ! node --version 2>/dev/null | grep -q '^v22\.'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -yq nodejs
fi

say "Google Chrome (the research reporter keeps a screenshot of every source as proof)"
if ! command -v google-chrome >/dev/null 2>&1; then
  curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor --yes -o /usr/share/keyrings/google-chrome.gpg
  echo 'deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main' > /etc/apt/sources.list.d/google-chrome.list
  apt-get update -q
  # Hebrew fonts, so a page's screenshot shows its text.
  apt-get install -yq google-chrome-stable fonts-noto-core
fi

say "PostgreSQL 17 (the same major version as the embedded database it replaces)"
if ! command -v /usr/lib/postgresql/17/bin/postgres >/dev/null; then
  install -d /usr/share/postgresql-common/pgdg
  curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(. /etc/os-release && echo "$VERSION_CODENAME")-pgdg main" > /etc/apt/sources.list.d/pgdg.list
  apt-get update -q
  apt-get install -yq postgresql-17
fi
# Only this server talks to it (restarted only when that changes: the live site uses it).
if ! grep -q "^listen_addresses = 'localhost'" /etc/postgresql/17/main/postgresql.conf; then
  sed -i "s/^#\?listen_addresses.*/listen_addresses = 'localhost'/" /etc/postgresql/17/main/postgresql.conf
  systemctl restart postgresql
fi

say "cloudflared (the tunnel; it is connected later with: npm run cloud -- tunnel)"
if ! command -v cloudflared >/dev/null; then
  mkdir -p --mode=0755 /usr/share/keyrings
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg
  echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' > /etc/apt/sources.list.d/cloudflared.list
  apt-get update -q
  apt-get install -yq cloudflared
fi

say "Google Ops Agent (logs and metrics)"
if ! systemctl list-unit-files | grep -q google-cloud-ops-agent; then
  curl -fsSL https://dl.google.com/cloudagents/add-google-cloud-ops-agent-repo.sh -o /tmp/add-ops-agent.sh
  bash /tmp/add-ops-agent.sh --also-install
fi
install -m 0644 "$HERE/ops-agent.yaml" /etc/google-cloud-ops-agent/config.yaml
systemctl restart google-cloud-ops-agent || true

say "The b4 user and /srv/b4"
id b4 >/dev/null 2>&1 || useradd --system --create-home --home-dir /srv/b4 --shell /bin/bash b4
install -d -o b4 -g b4 /srv/b4/live

say "The database: role b4 (may create the rehearsal's copy) and database b4"
if [ ! -f /srv/b4/live/live.env ]; then
  PW="$(openssl rand -hex 24)"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE ROLE b4 LOGIN CREATEDB PASSWORD '$PW'" 2>/dev/null || sudo -u postgres psql -v ON_ERROR_STOP=1 -c "ALTER ROLE b4 WITH LOGIN CREATEDB PASSWORD '$PW'"
  sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='b4'" | grep -q 1 || sudo -u postgres createdb -O b4 b4
  PROJECT="$(curl -fsS -H 'Metadata-Flavor: Google' http://metadata.google.internal/computeMetadata/v1/project/project-id)"
  # The secrets (HASH_PEPPER, SECRETS_KEY, REVALIDATE_SECRET) come from the live environment being moved
  # (npm run cloud -- move-data); R2_ACCOUNT_ID and the R2 keys are added by the owner (npm run cloud -- set <NAME>).
  install -m 0600 -o b4 -g b4 /dev/null /srv/b4/live/live.env
  cat > /srv/b4/live/live.env <<EOF
# The live environment on the cloud server. Created by deploy/cloud/setup.sh; keep it private.
DATABASE_URL=postgres://b4:$PW@127.0.0.1:5432/b4
PUBLIC_SITE_URL=https://$DOMAIN
CMS_URL=https://cms.$DOMAIN
PUBLIC_API_URL=https://api.$DOMAIN
MEDIA_STORAGE=r2
MEDIA_BASE_URL=https://media.$DOMAIN
R2_BUCKET=b4-media
R2_BACKUP_BUCKET=b4-backups
VERTEX_PROJECT=$PROJECT
# Behind the Cloudflare tunnel: the visitor's address comes from the proxy headers.
TRUST_PROXY=true
EOF
fi

say "systemd: start at boot, watchdog, nightly backup (the watchdog starts with the first release)"
install -m 0644 "$HERE"/systemd/*.service "$HERE"/systemd/*.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable b4-live.service b4-watchdog.timer b4-backup.timer
systemctl start b4-backup.timer

say "Done. Next: the code (npm run cloud -- release) after the data is moved (npm run cloud -- move-data)."
