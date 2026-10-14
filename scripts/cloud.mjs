#!/usr/bin/env node
// The cloud server, operated from the workshop computer with the Google Cloud CLI (gcloud). The
// server has no open ports: commands reach it through Google's IAP tunnel with the owner's Google
// sign-in, and readers reach the site through the Cloudflare tunnel. On the server, releases,
// backups and rollbacks are scripts/live.mjs, the same as on a computer. See docs/WORKFLOW.md.
//
//   npm run cloud -- create              the server and what it needs in Google Cloud (once)
//   npm run cloud -- setup               install the server (deploy/cloud/setup.sh; safe to repeat)
//   npm run cloud -- set <NAME>          one value into the server's live.env, typed here (hidden when secret)
//   npm run cloud -- tunnel              connect the Cloudflare tunnel (its token is typed here, hidden)
//   npm run cloud -- move-data           this computer's live data to the server (once, before the first release)
//   npm run cloud -- release [git-ref]   put a committed version live on the server (default: HEAD)
//   npm run cloud -- status | logs [api|web|cms] | backup | rollback
//
// Optional settings (environment): B4_GCP_PROJECT (default: gcloud's current project),
// B4_GCP_ZONE (me-west1-b, Tel Aviv), B4_SERVER (b4-server), B4_DOMAIN (b4news.co.il).
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const ZONE = process.env.B4_GCP_ZONE ?? 'me-west1-b';
const REGION = ZONE.replace(/-[a-z]$/, '');
const SERVER = process.env.B4_SERVER ?? 'b4-server';
const DOMAIN = process.env.B4_DOMAIN ?? 'b4news.co.il';
const ACCOUNT = 'b4-server';
const LIVE_ENV = '/srv/b4/live/live.env';
const MONTHLY_BUDGET_USD = 80;
/** Google's IAP addresses: the only place SSH is accepted from. */
const IAP_RANGE = '35.235.240.0/20';

class Stop extends Error {}
const fail = (message) => {
  throw new Stop(message);
};
const say = (line) => console.log(`[cloud] ${line}`);

// --- gcloud ---------------------------------------------------------------------------------
/**
 * On Windows gcloud is a .cmd file, which Node can't run without a shell, and a shell would
 * mangle the arguments; so its own Python and gcloud.py are called directly.
 */
function gcloudBinary() {
  if (process.platform !== 'win32') return { cmd: 'gcloud', pre: [] };
  const where = spawnSync('where', ['gcloud.cmd'], { encoding: 'utf8' });
  const cmdPath = (where.stdout ?? '').split(/\r?\n/).find(Boolean);
  if (!cmdPath) fail('The Google Cloud CLI is not installed. Install it with "winget install Google.CloudSDK", then sign in with "gcloud auth login".');
  const root = path.resolve(path.dirname(cmdPath), '..');
  const bundled = path.join(root, 'platform', 'bundledpython', 'python.exe');
  return { cmd: process.env.CLOUDSDK_PYTHON ?? (fs.existsSync(bundled) ? bundled : 'python'), pre: [path.join(root, 'lib', 'gcloud.py')] };
}

let binary = null;
/** Runs gcloud; its output is returned (and shown when `show`). A failure stops, unless `allowFail`. */
function gcloud(args, { allowFail = false, show = false } = {}) {
  binary ??= gcloudBinary();
  const r = spawnSync(binary.cmd, [...binary.pre, ...args], { encoding: 'utf8', stdio: ['inherit', show ? 'inherit' : 'pipe', show ? 'inherit' : 'pipe'], maxBuffer: 256 * 1024 * 1024 });
  if (r.error) fail(`gcloud: ${r.error.message}`);
  if (r.status !== 0 && !allowFail) fail(`gcloud ${args.slice(0, 3).join(' ')} failed${show ? '' : `:\n${(r.stderr || r.stdout || '').trim().split('\n').slice(-15).join('\n')}`}`);
  return { ok: r.status === 0, out: (r.stdout ?? '').trim() };
}

function project() {
  const id = process.env.B4_GCP_PROJECT ?? gcloud(['config', 'get-value', 'project'], { allowFail: true }).out.split(/\r?\n/).at(-1);
  if (!id || id === '(unset)') fail('No Google Cloud project is chosen. Run "gcloud config set project <project-id>" (or set B4_GCP_PROJECT).');
  return id;
}

const at = (p) => ['--project', p, '--zone', ZONE];

/** Files to the server's /tmp through the IAP tunnel. */
function copyUp(p, files, remoteDir = '/tmp/') {
  gcloud(['compute', 'scp', '--recurse', ...files, `${SERVER}:${remoteDir}`, ...at(p), '--tunnel-through-iap', '--quiet']);
}

/** A bash script on the server (sent as a file, so nothing needs quoting), with its output shown. */
function onServer(p, script, files = []) {
  const name = `b4-${randomBytes(4).toString('hex')}.sh`;
  const local = path.join(os.tmpdir(), name);
  fs.writeFileSync(local, `set -euo pipefail\n${script}\nrm -f /tmp/${name}\n`, { mode: 0o600 });
  try {
    copyUp(p, [local, ...files]);
    gcloud(['compute', 'ssh', SERVER, ...at(p), '--tunnel-through-iap', '--quiet', '--command', `bash /tmp/${name}`], { show: true });
  } finally {
    fs.rmSync(local, { force: true });
  }
}

/** live.mjs on the server, as the b4 user, in its own systemd unit so the processes it starts outlive the SSH session. */
const liveOnServer = (args) =>
  `sudo systemd-run --quiet --uid=b4 --wait --pipe --collect -p KillMode=process -p WorkingDirectory=/srv/b4/repo -E B4_LIVE_HOME=/srv/b4/live /usr/bin/node /srv/b4/repo/scripts/live.mjs ${args}`;

// --- create -----------------------------------------------------------------------------------
/** The server in Tel Aviv and what it needs: APIs, its own minimal identity, firewall, daily disk snapshots, a budget alert. */
async function create() {
  const p = project();
  const sa = `${ACCOUNT}@${p}.iam.gserviceaccount.com`;
  say(`Project ${p}, zone ${ZONE}.`);

  say('1/7 Turning on the Google Cloud services the server uses...');
  gcloud(['services', 'enable', 'compute.googleapis.com', 'iap.googleapis.com', 'aiplatform.googleapis.com', 'logging.googleapis.com', 'monitoring.googleapis.com', 'oslogin.googleapis.com', 'billingbudgets.googleapis.com', '--project', p], { show: true });

  say('2/7 The server\'s own identity, allowed only Vertex AI and sending logs and metrics...');
  if (!gcloud(['iam', 'service-accounts', 'describe', sa, '--project', p], { allowFail: true }).ok) {
    gcloud(['iam', 'service-accounts', 'create', ACCOUNT, '--display-name', "B4 NEW'S server", '--project', p]);
  }
  for (const role of ['roles/aiplatform.user', 'roles/logging.logWriter', 'roles/monitoring.metricWriter']) {
    gcloud(['projects', 'add-iam-policy-binding', p, '--member', `serviceAccount:${sa}`, '--role', role, '--condition', 'None', '--quiet']);
  }

  say('3/7 Firewall: SSH only through Google\'s IAP tunnel; nothing else comes in...');
  if (!gcloud(['compute', 'firewall-rules', 'describe', 'b4-allow-iap-ssh', '--project', p], { allowFail: true }).ok) {
    gcloud(['compute', 'firewall-rules', 'create', 'b4-allow-iap-ssh', '--network', 'default', '--direction', 'INGRESS', '--allow', 'tcp:22', '--source-ranges', IAP_RANGE, '--target-tags', 'b4-server', '--project', p]);
  }
  // The default network opens SSH and RDP to the whole internet; this project has only this server.
  for (const rule of ['default-allow-ssh', 'default-allow-rdp']) {
    if (gcloud(['compute', 'firewall-rules', 'describe', rule, '--project', p], { allowFail: true }).ok) {
      gcloud(['compute', 'firewall-rules', 'delete', rule, '--project', p, '--quiet']);
      say(`   removed ${rule} (open to the whole internet)`);
    }
  }

  say('4/7 The server: 2 CPUs, 8 GB, 50 GB disk, Ubuntu 24.04, Tel Aviv...');
  if (!gcloud(['compute', 'instances', 'describe', SERVER, ...at(p)], { allowFail: true }).ok) {
    gcloud([
      'compute', 'instances', 'create', SERVER, ...at(p),
      '--machine-type', 'e2-standard-2',
      '--image-family', 'ubuntu-2404-lts-amd64', '--image-project', 'ubuntu-os-cloud',
      '--boot-disk-size', '50GB', '--boot-disk-type', 'pd-balanced',
      '--service-account', sa, '--scopes', 'cloud-platform',
      '--tags', 'b4-server',
      '--shielded-secure-boot', '--shielded-vtpm', '--shielded-integrity-monitoring',
      '--metadata', 'enable-oslogin=TRUE,block-project-ssh-keys=TRUE',
    ], { show: true });
  }

  say('5/7 A snapshot of the whole disk every night, kept 7 days...');
  if (!gcloud(['compute', 'resource-policies', 'describe', 'b4-daily', '--project', p, '--region', REGION], { allowFail: true }).ok) {
    gcloud(['compute', 'resource-policies', 'create', 'snapshot-schedule', 'b4-daily', '--project', p, '--region', REGION, '--max-retention-days', '7', '--daily-schedule', '--start-time', '00:00', '--storage-location', REGION]);
  }
  gcloud(['compute', 'disks', 'add-resource-policies', SERVER, '--resource-policies', 'b4-daily', ...at(p)], { allowFail: true });

  say(`6/7 A budget alert at $${MONTHLY_BUDGET_USD} a month (50%, 90%, 100%)...`);
  const billing = gcloud(['billing', 'projects', 'describe', p, '--format', 'value(billingAccountName)'], { allowFail: true }).out.replace('billingAccounts/', '');
  if (billing) {
    const existing = gcloud(['billing', 'budgets', 'list', '--billing-account', billing, '--format', 'value(displayName)'], { allowFail: true }).out;
    if (!existing.split(/\r?\n/).includes("B4 NEW'S monthly")) {
      const made = gcloud(
        ['billing', 'budgets', 'create', '--billing-account', billing, '--display-name', "B4 NEW'S monthly", '--budget-amount', `${MONTHLY_BUDGET_USD}USD`, '--threshold-rule', 'percent=0.5', '--threshold-rule', 'percent=0.9', '--threshold-rule', 'percent=1.0'],
        { allowFail: true },
      );
      if (!made.ok) say('   Note: the budget alert was not created; set one in the console (Billing > Budgets & alerts).');
    }
  } else say('   Note: no billing account found for the project; set the budget in the console.');

  say('7/7 Done. Next: npm run cloud -- setup');
}

// --- setup, values, tunnel --------------------------------------------------------------------
function setup() {
  const p = project();
  say(`Installing the server for ${DOMAIN} (a few minutes)...`);
  onServer(
    p,
    [
      'rm -rf /tmp/b4-deploy && mkdir -p /tmp/b4-deploy',
      'cp -r /tmp/cloud/* /tmp/b4-deploy/ && rm -rf /tmp/cloud',
      // A checkout on Windows may have given the files Windows line endings, which bash and systemd refuse.
      "find /tmp/b4-deploy -type f -exec sed -i 's/\\r$//' {} +",
      `sudo bash /tmp/b4-deploy/setup.sh ${DOMAIN}`,
    ].join('\n'),
    [path.join(REPO, 'deploy', 'cloud')],
  );
}

/** Reads a value typed in this terminal; secrets are not echoed. */
function ask(question, hidden) {
  if (!process.stdin.isTTY) fail('This command asks for a value: run it yourself in a terminal.');
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = (s) => process.stdout.write(s.startsWith(question) ? question : s.replace(/[^\r\n]/g, '*'));
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

const SECRET_NAME = /SECRET|KEY|TOKEN|PASSWORD/;
const ALLOWED = /^(R2_[A-Z_]+|SMTP_URL|ANTHROPIC_API_KEY|GEMINI_API_KEY|VERTEX_[A-Z_]+|IMAGE_[A-Z_]+|MAIL_FROM|COOKIE_DOMAIN)$/;

/** One value into the server's live.env; it travels in a file that is deleted at once, never on a command line. */
async function set(name) {
  if (!name || !ALLOWED.test(name)) fail(`Usage: npm run cloud -- set <NAME>, where NAME is one of R2_*, SMTP_URL, ANTHROPIC_API_KEY, GEMINI_API_KEY, VERTEX_*, IMAGE_*, MAIL_FROM, COOKIE_DOMAIN.`);
  const p = project();
  const value = await ask(`${name}: `, SECRET_NAME.test(name));
  if (!value) fail('Nothing was typed; nothing changed.');
  const file = path.join(os.tmpdir(), `b4-value-${randomBytes(4).toString('hex')}`);
  fs.writeFileSync(file, value, { mode: 0o600 });
  try {
    onServer(
      p,
      [
        `sudo node /tmp/set-env.mjs ${LIVE_ENV} ${name} /tmp/${path.basename(file)}`,
        `sudo chown b4:b4 ${LIVE_ENV}`,
        `shred -u /tmp/${path.basename(file)} /tmp/set-env.mjs`,
      ].join('\n'),
      [file, path.join(REPO, 'deploy', 'cloud', 'set-env.mjs')],
    );
  } finally {
    fs.rmSync(file, { force: true });
  }
  say(`${name} is set. The live site reads it at its next start (npm run cloud -- release, or restart).`);
}

/** Connects the server to the Cloudflare tunnel made in the Cloudflare dashboard (Zero Trust > Networks > Tunnels). */
async function tunnel() {
  const p = project();
  const token = await ask('Cloudflare tunnel token: ', true);
  if (!/^[A-Za-z0-9_\-=.]{40,}$/.test(token)) fail('That doesn\'t look like a tunnel token (a long string from the "Install connector" step).');
  const file = path.join(os.tmpdir(), `b4-tunnel-${randomBytes(4).toString('hex')}`);
  fs.writeFileSync(file, token, { mode: 0o600 });
  try {
    onServer(p, [`T="$(cat /tmp/${path.basename(file)})"`, `shred -u /tmp/${path.basename(file)}`, 'sudo cloudflared service uninstall >/dev/null 2>&1 || true', 'sudo cloudflared service install "$T"', 'sudo systemctl enable --now cloudflared'].join('\n'), [file]);
  } finally {
    fs.rmSync(file, { force: true });
  }
  say('The tunnel is connected. Its addresses (site, CMS, API) are set in the Cloudflare dashboard.');
}

// --- code and data ------------------------------------------------------------------------------
function git(args) {
  const r = spawnSync('git', args, { cwd: REPO, encoding: 'utf8' });
  if (r.status !== 0) fail(`git ${args[0]} failed: ${(r.stderr || '').trim()}`);
  return r.stdout.trim();
}

/** The committed version onto the server's /srv/b4/repo (as a git bundle: the server needs no access to GitHub). */
function syncCode(p, ref) {
  const commit = git(['rev-parse', '--verify', `${ref}^{commit}`]);
  const bundle = path.join(os.tmpdir(), 'b4-code.bundle');
  git(['bundle', 'create', bundle, '--all']);
  try {
    say(`Sending ${commit.slice(0, 8)} "${git(['log', '-1', '--format=%s', commit])}" to the server...`);
    onServer(
      p,
      [
        'sudo chmod 644 /tmp/b4-code.bundle',
        'sudo install -d -o b4 -g b4 /srv/b4/repo',
        '[ -d /srv/b4/repo/.git ] || sudo -u b4 git -C /srv/b4/repo init -q',
        "sudo -u b4 git -C /srv/b4/repo fetch -q /tmp/b4-code.bundle '+refs/heads/*:refs/remotes/workshop/*'",
        `sudo -u b4 git -C /srv/b4/repo checkout -q --force --detach ${commit}`,
        'rm -f /tmp/b4-code.bundle',
      ].join('\n'),
      [bundle],
    );
  } finally {
    fs.rmSync(bundle, { force: true });
  }
  return commit;
}

async function release(ref = 'HEAD') {
  const p = project();
  if (git(['status', '--porcelain'])) say('Uncommitted changes in the workshop are not part of it: only committed work goes live.');
  const commit = syncCode(p, ref);
  say('Releasing on the server (checks, rehearsal on a copy of the live data, backup, switch; it rolls back by itself)...');
  // With a version live, the boot service and the watchdog have something to keep running.
  onServer(p, [liveOnServer(`release ${commit}`), 'sudo systemctl start b4-live.service b4-watchdog.timer'].join('\n'));
}

/**
 * The computer's live environment moves to the server, once: the database (as SQL) goes into the
 * server's empty PostgreSQL, the media into the R2 bucket, and the secrets that read the keys saved
 * in the CMS into live.env. The computer's live site keeps running, unchanged.
 */
async function moveData() {
  const p = project();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'b4-move-'));
  const out = path.join(work, 'export');
  const archive = path.join(work, 'b4-move.tgz');
  try {
    say('1/4 Exporting this computer\'s live data...');
    const r = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'live.mjs'), 'export-for-cloud', out], { stdio: 'inherit', env: process.env });
    if (r.status !== 0) fail('The export failed (see above).');
    const counts = fs.readFileSync(path.join(out, 'counts.json'), 'utf8').trim();
    say(`   ${counts}`);
    const t = spawnSync('tar', ['-czf', archive, '-C', out, '.'], { stdio: 'inherit' });
    if (t.status !== 0) fail('Packing the export failed.');
    fs.rmSync(out, { recursive: true, force: true });

    say('2/4 The code the server uses for the move...');
    syncCode(p, 'HEAD');

    say('3/4 Into the server: secrets, database, media (several minutes)...');
    onServer(
      p,
      [
        `for k in R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY; do sudo grep -q "^$k=" ${LIVE_ENV} || { echo "Missing $k in live.env: run npm run cloud -- set $k first." >&2; exit 1; }; done`,
        'T=/tmp/b4-move; sudo rm -rf $T; mkdir -p $T; tar -xzf /tmp/b4-move.tgz -C $T; rm -f /tmp/b4-move.tgz; sudo chown -R b4:b4 $T',
        // Only the secrets the server doesn't have yet are added; existing ones are never replaced.
        `while IFS= read -r line; do [ -n "$line" ] || continue; k="\${line%%=*}"; sudo grep -q "^$k=" ${LIVE_ENV} || echo "$line" | sudo tee -a ${LIVE_ENV} >/dev/null; done < $T/secrets.env`,
        'sudo shred -u $T/secrets.env',
        `DB="$(sudo grep '^DATABASE_URL=' ${LIVE_ENV} | cut -d= -f2-)"`,
        'if [ "$(sudo -u b4 psql "$DB" -tAc "select to_regclass(\'public.articles\') is not null")" = "t" ]; then echo "The server\'s database already holds data: move-data runs once, before the first release." >&2; exit 1; fi',
        'sudo -u b4 psql "$DB" -v ON_ERROR_STOP=1 -q -f $T/live.sql',
        'cd /srv/b4/repo && sudo -u b4 npm ci --no-audit --no-fund --include-workspace-root --workspace=@b4/api >/dev/null',
        `sudo -u b4 bash -c "set -a; . ${LIVE_ENV}; set +a; cd /srv/b4/repo/apps/api && npx tsx src/cli/live-db.ts upload-media $T/media && echo 'counts on the server:' && npx tsx src/cli/live-db.ts counts \\"\\$DATABASE_URL\\""`,
        'sudo rm -rf $T',
      ].join('\n'),
      [archive],
    );
    say(`4/4 Compare the counts above with the computer's: ${counts}`);
    say('Next: npm run cloud -- release');
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// --- Main ---------------------------------------------------------------------------------------
const [command = 'status', arg] = process.argv.slice(2);
const commands = {
  create,
  setup,
  set: () => set(arg),
  tunnel,
  'move-data': moveData,
  release: () => release(arg),
  status: () => onServer(project(), liveOnServer('status')),
  logs: () => onServer(project(), liveOnServer(`logs ${/^(api|web|cms)$/.test(arg ?? '') ? arg : 'api'}`)),
  backup: () => onServer(project(), liveOnServer('backup manual')),
  rollback: () => onServer(project(), liveOnServer('rollback')),
};

if (!commands[command]) {
  console.error(`Unknown command "${command}". Commands: ${Object.keys(commands).join(', ')}`);
  process.exit(2);
}
try {
  await commands[command]();
} catch (e) {
  console.error(e instanceof Stop ? `\n${e.message}` : e);
  process.exit(1);
}
