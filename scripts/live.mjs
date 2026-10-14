#!/usr/bin/env node
// The live environment: the site, CMS and API that real work happens on, kept apart from
// development. Code changes in the workshop (this repository) never touch it; it changes only
// through `release`, which takes a committed version, checks it, rehearses it on a copy of the
// live data, backs the data up and switches over, rolling back by itself if the new version
// doesn't come up. See docs/WORKFLOW.md.
//
//   npm run live -- release [git-ref]   put a committed version live (default: HEAD)
//   npm run live -- status              what runs, which version, last backups
//   npm run live -- start | stop | restart
//   npm run live -- rollback            back to the previous version (the data stays as it is)
//   npm run live -- backup              copy the database and media now
//   npm run live -- restore [backup]    put a backup back (the current data is kept aside, not deleted)
//   npm run live -- import-sources <file.json>   add news sites tested in the workshop
//   npm run live -- import-articles <dir>        add the workshop's articles (a bundle from live-db.ts export-articles)
//   npm run live -- logs [api|web|cms]
//
// Everything lives in ../b4-news-live (or $B4_LIVE_HOME):
//   live.env      secrets, created once      data/db, data/media   the real data
//   releases/<id> installed versions         backups/<stamp>-...     copies of data/
//   staging/      throwaway copy for rehearsals   logs/   run/
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const HOME = path.resolve(process.env.B4_LIVE_HOME ?? path.join(REPO, '..', 'b4-news-live'));
const DIR = {
  releases: path.join(HOME, 'releases'),
  data: path.join(HOME, 'data'),
  staging: path.join(HOME, 'staging'),
  backups: path.join(HOME, 'backups'),
  logs: path.join(HOME, 'logs'),
  run: path.join(HOME, 'run'),
};
const FILE = { env: path.join(HOME, 'live.env'), state: path.join(HOME, 'state.json'), lock: path.join(HOME, 'release.lock') };
const PORTS = { live: { api: 4100, web: 3100, cms: 3101 }, staging: { api: 4200, web: 3200, cms: 3201 } };
const SERVED = ['@b4/api', '@b4/web', '@b4/admin'];
const CHECKED = ['@b4/shared', '@b4/db', ...SERVED];
const KEEP_RELEASES = 3;
const KEEP_BACKUPS = 10;

// --- Output -------------------------------------------------------------------------
class Stop extends Error {}
let releaseLog = null;

function say(line) {
  console.log(`[${new Date().toTimeString().slice(0, 8)}] ${line}`);
  if (releaseLog) fs.appendFileSync(releaseLog, `[${new Date().toISOString()}] ${line}\n`);
}
const fail = (message) => {
  throw new Stop(message);
};
const tail = (text, n) => text.trimEnd().split(/\r?\n/).slice(-n).join('\n');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Local time, e.g. 2026-10-12_2306 (releases and backups sort by it). */
const stamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
};

// --- Commands -------------------------------------------------------------------------
/** Only what tools need from the shell: the live processes never inherit development settings. */
function baseEnv() {
  const keep = ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'windir', 'ComSpec', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH', 'LANG', 'TZ'];
  return Object.fromEntries(keep.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]]));
}

function run(cmd, args, { cwd = REPO, env = process.env, label = cmd, shell = false } = {}) {
  const r = spawnSync(cmd, args, { cwd, env, shell, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, windowsHide: true });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (releaseLog) fs.appendFileSync(releaseLog, `\n$ ${[cmd, ...args].join(' ')}  (in ${cwd})\n${output}\n`);
  if (r.error) fail(`${label}: ${r.error.message}`);
  if (r.status !== 0) fail(`${label} failed:\n${tail(output, 30)}`);
  return output;
}

function npm(args, opts) {
  const cli = [process.env.npm_execpath, path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')].find(
    (p) => p && p.endsWith('.js') && fs.existsSync(p),
  );
  if (cli) return run(process.execPath, [cli, ...args], opts);
  return run(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { ...opts, shell: process.platform === 'win32' });
}

const git = (args) => run('git', args, { label: `git ${args[0]}` });
const tsx = (R, args, opts) => run(process.execPath, [path.join(R, 'node_modules', 'tsx', 'dist', 'cli.mjs'), ...args], opts);

// --- Settings and state -----------------------------------------------------------------
function readEnvFile() {
  const out = {};
  for (const line of fs.readFileSync(FILE.env, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && m[2] !== '') out[m[1]] = m[2];
  }
  return out;
}

/** The live secrets are made once and must never change: SECRETS_KEY decrypts the API keys stored in the CMS. */
function secrets() {
  if (!fs.existsSync(FILE.env)) {
    fs.mkdirSync(HOME, { recursive: true });
    fs.writeFileSync(
      FILE.env,
      [
        '# Secrets of the live environment. Made once by scripts/live.mjs; keep this file private.',
        '# Never change SECRETS_KEY (it decrypts the API keys saved in the CMS) or HASH_PEPPER.',
        `HASH_PEPPER=${randomBytes(24).toString('base64url')}`,
        `SECRETS_KEY=${randomBytes(32).toString('base64')}`,
        `REVALIDATE_SECRET=${randomBytes(24).toString('base64url')}`,
        '# Optional fallbacks; what is saved in the CMS (Settings > Connections) wins:',
        '# SMTP_URL=  ANTHROPIC_API_KEY=  GEMINI_API_KEY=',
        '',
      ].join('\n'),
      { mode: 0o600 },
    );
    say(`Created ${FILE.env} with new secrets.`);
  }
  return readEnvFile();
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(FILE.state, 'utf8'));
  } catch {
    return { current: null, previous: null, history: [] };
  }
}
const writeState = (state) => fs.writeFileSync(FILE.state, `${JSON.stringify(state, null, 2)}\n`);
const releaseDir = (entry) => (entry ? path.join(DIR.releases, entry.id) : null);

function takeLock() {
  if (fs.existsSync(FILE.lock)) {
    const pid = Number(fs.readFileSync(FILE.lock, 'utf8'));
    if (pid && alive(pid)) fail(`Another release is running (process ${pid}).`);
  }
  fs.writeFileSync(FILE.lock, String(process.pid));
}
const releaseLock = () => fs.rmSync(FILE.lock, { force: true });

// --- Processes --------------------------------------------------------------------------
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function portFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

async function until(check, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await sleep(500);
  }
  return false;
}

async function get(url, timeoutMs = 20_000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' });
  return { status: res.status, text: await res.text() };
}

const healthy = (port) => get(`http://127.0.0.1:${port}/health`, 3000).then((r) => r.status === 200, () => false);
const answering = (port) => get(`http://127.0.0.1:${port}/`, 5000).then(() => true, () => false);

/** The rehearsal never runs background work (scans, AI, publishing, posts) and shows the live media addresses. */
function apiEnv(which, keys, token) {
  const p = PORTS[which];
  const base = which === 'live' ? DIR.data : DIR.staging;
  return {
    ...baseEnv(),
    ...keys,
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(p.api),
    DATABASE_URL: `pglite:${path.join(base, 'db')}`,
    MEDIA_DIR: path.join(base, 'media'),
    PUBLIC_API_URL: `http://localhost:${p.api}`,
    MEDIA_BASE_URL: `http://localhost:${PORTS.live.api}/media`,
    PUBLIC_SITE_URL: `http://localhost:${p.web}`,
    CORS_ORIGINS: `http://localhost:${p.web},http://localhost:${p.cms}`,
    SITE_REVALIDATE_URL: `http://127.0.0.1:${p.web}/api/revalidate`,
    SEED_SAMPLE_CONTENT: 'false',
    DEV_FIXTURES: 'false',
    SCRAPER_ALLOW_PRIVATE: 'false',
    WORKER: which === 'live' ? 'inline' : 'off',
    SHUTDOWN_TOKEN: token,
  };
}

/** Browser-facing addresses are baked in at build time and always point at the live ports. */
function buildEnv(app, keys) {
  const env = {
    ...baseEnv(),
    NEXT_TELEMETRY_DISABLED: '1',
    NEXT_PUBLIC_API_URL: `http://localhost:${PORTS.live.api}/api/v1`,
    NEXT_PUBLIC_SITE_URL: `http://localhost:${PORTS.live.web}`,
  };
  // The site's pages are first rendered from the rehearsal, which holds a copy of the live data.
  if (app === 'web') Object.assign(env, { API_URL: `http://127.0.0.1:${PORTS.staging.api}/api/v1`, REVALIDATE_SECRET: keys.REVALIDATE_SECRET });
  return env;
}

function service(R, which, name, keys) {
  const port = PORTS[which][name];
  if (name === 'api') {
    const token = randomBytes(24).toString('hex');
    return { cwd: path.join(R, 'apps', 'api'), args: [path.join(R, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'src/server.ts'], env: apiEnv(which, keys, token), token };
  }
  const env = { ...baseEnv(), NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' };
  if (name === 'web') Object.assign(env, { API_URL: `http://127.0.0.1:${PORTS[which].api}/api/v1`, REVALIDATE_SECRET: keys.REVALIDATE_SECRET });
  return {
    cwd: path.join(R, 'apps', name === 'web' ? 'web' : 'admin'),
    args: [path.join(R, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-p', String(port), '-H', '127.0.0.1'],
    env,
  };
}

const runFile = (which, name, ext) => path.join(DIR.run, `${which}-${name}.${ext}`);

async function startService(R, which, name, keys) {
  const port = PORTS[which][name];
  if (!(await portFree(port))) fail(`Port ${port} is taken (another program, or a ${which} ${name} that is already running).`);
  const { cwd, args, env, token } = service(R, which, name, keys);
  const logFile = path.join(DIR.logs, `${which}-${name}.log`);
  fs.appendFileSync(logFile, `\n===== ${new Date().toISOString()} start ${path.basename(R)} =====\n`);
  const out = fs.openSync(logFile, 'a');
  const child = spawn(process.execPath, args, { cwd, env, detached: true, stdio: ['ignore', out, out], windowsHide: true });
  fs.closeSync(out);
  child.unref();
  fs.writeFileSync(runFile(which, name, 'pid'), String(child.pid));
  if (token) fs.writeFileSync(runFile(which, name, 'token'), token, { mode: 0o600 });
}

function killTree(pid) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
  else {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      // already gone
    }
  }
}

/** The API is asked to stop (its jobs finish and the database closes cleanly); the site and CMS are just stopped. */
async function stopService(which, name) {
  const port = PORTS[which][name];
  const pidPath = runFile(which, name, 'pid');
  const tokenPath = runFile(which, name, 'token');
  const pid = fs.existsSync(pidPath) ? Number(fs.readFileSync(pidPath, 'utf8')) : 0;
  if (name === 'api' && fs.existsSync(tokenPath) && (await healthy(port))) {
    const token = fs.readFileSync(tokenPath, 'utf8');
    await fetch(`http://127.0.0.1:${port}/internal/shutdown`, { method: 'POST', headers: { 'x-shutdown-token': token }, signal: AbortSignal.timeout(5000) }).catch(() => {});
    await until(() => portFree(port), 90_000);
    if (pid) await until(() => !alive(pid), 30_000);
  }
  if (pid && alive(pid)) killTree(pid);
  fs.rmSync(pidPath, { force: true });
  fs.rmSync(tokenPath, { force: true });
  if (!(await until(() => portFree(port), 20_000))) fail(`Port ${port} is still in use after stopping ${which} ${name}.`);
}

async function stopAll(which) {
  for (const name of ['web', 'cms', 'api']) await stopService(which, name);
}

async function startAll(R, which, keys) {
  await startService(R, which, 'api', keys);
  // Migrations run as the API starts.
  if (!(await until(() => healthy(PORTS[which].api), 180_000))) fail(`The ${which} API did not come up (see logs/${which}-api.log).`);
  await startService(R, which, 'web', keys);
  await startService(R, which, 'cms', keys);
  for (const name of ['web', 'cms']) {
    if (!(await until(() => answering(PORTS[which][name]), 90_000))) fail(`The ${which} ${name} did not come up (see logs/${which}-${name}.log).`);
  }
}

// --- Checks -----------------------------------------------------------------------------
/** The pages readers and editors depend on, each rendered by the running version. */
async function smoke(which) {
  const p = PORTS[which];
  const problems = [];
  const check = async (label, url, ok = (r) => r.status === 200) => {
    try {
      const r = await get(url, 90_000);
      if (!ok(r)) problems.push(`${label}: HTTP ${r.status}`);
      return r;
    } catch (e) {
      problems.push(`${label}: ${e.message}`);
      return null;
    }
  };
  await check('API', `http://127.0.0.1:${p.api}/health`);
  const home = await check('home page data', `http://127.0.0.1:${p.api}/api/v1/public/home`);
  const cats = await check('categories', `http://127.0.0.1:${p.api}/api/v1/public/categories`);
  await check('site home page', `http://127.0.0.1:${p.web}/`, (r) => r.status === 200 && r.text.includes('</html>'));
  const data = home?.status === 200 ? JSON.parse(home.text) : null;
  const article = data ? [...(data.main ?? []), ...(data.latest ?? [])][0] : null;
  if (article) await check(`article page (${article.slug})`, `http://127.0.0.1:${p.web}/article/${encodeURIComponent(article.slug)}`);
  const category = cats?.status === 200 ? JSON.parse(cats.text)[0] : null;
  if (category) await check(`category page (${category.slug})`, `http://127.0.0.1:${p.web}/category/${encodeURIComponent(category.slug)}`);
  await check('sitemap', `http://127.0.0.1:${p.web}/sitemap.xml`);
  await check('CMS sign-in page', `http://127.0.0.1:${p.cms}/login`);
  return problems;
}

/** Whatever happened during a release, the live environment is left running if it can be. */
async function reviveLive(keys) {
  const R = releaseDir(readState().current);
  if (!R || !fs.existsSync(R) || (await healthy(PORTS.live.api))) return;
  say('The live API is not answering; starting the live environment again...');
  await stopAll('live').catch(() => {});
  await startAll(R, 'live', keys).catch((e) => say(`Could not start it: ${e.message}. Run "npm run live -- start".`));
}

/** A double-click starter in the live folder, e.g. after the computer restarts. */
function writeLauncher() {
  const file = path.join(HOME, 'start-live.cmd');
  fs.writeFileSync(
    file,
    [
      '@echo off',
      "rem Starts the B4 NEW'S live environment: site http://localhost:3100, CMS http://localhost:3101",
      `"${process.execPath}" "${path.join(REPO, 'scripts', 'live.mjs')}" start`,
      'pause',
      '',
    ].join('\r\n'),
  );
}

/** After a switch, pages built before it are refreshed from the live data. */
async function refreshSite(keys) {
  try {
    const cats = JSON.parse((await get(`http://127.0.0.1:${PORTS.live.api}/api/v1/public/categories`)).text);
    const tags = ['home', 'search', 'site', ...cats.map((c) => `category:${c.slug}`)];
    await fetch(`http://127.0.0.1:${PORTS.live.web}/api/revalidate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-revalidate-secret': keys.REVALIDATE_SECRET },
      body: JSON.stringify({ tags }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    say(`Note: the site cache was not refreshed (${e.message}); pages update within 5 minutes anyway.`);
  }
}

// --- Data -------------------------------------------------------------------------------
function copyDir(from, to) {
  fs.rmSync(to, { recursive: true, force: true });
  if (fs.existsSync(from)) fs.cpSync(from, to, { recursive: true });
  else fs.mkdirSync(to, { recursive: true });
}

function prune(dir, keep, protect = []) {
  if (!fs.existsSync(dir)) return;
  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !protect.includes(e.name))
    .map((e) => e.name)
    .sort()
    .reverse();
  for (const name of entries.slice(keep)) fs.rmSync(path.join(dir, name), { recursive: true, force: true });
}

/** A consistent copy of the live data: the API is stopped for the few seconds it takes, then started again. */
async function withLiveApiStopped(keys, fn) {
  const state = readState();
  const R = releaseDir(state.current);
  const wasRunning = R && fs.existsSync(R) && (await healthy(PORTS.live.api));
  if (wasRunning) await stopService('live', 'api');
  try {
    return fn();
  } finally {
    if (wasRunning) {
      await startService(R, 'live', 'api', keys);
      if (!(await until(() => healthy(PORTS.live.api), 180_000))) say('Warning: the live API did not come back up; run "npm run live -- start".');
    }
  }
}

function backupNow(label) {
  const dir = path.join(DIR.backups, `${stamp()}-${label}`);
  copyDir(path.join(DIR.data, 'db'), path.join(dir, 'db'));
  copyDir(path.join(DIR.data, 'media'), path.join(dir, 'media'));
  prune(DIR.backups, KEEP_BACKUPS);
  return dir;
}

function putBack(backupDir) {
  copyDir(path.join(backupDir, 'db'), path.join(DIR.data, 'db'));
  copyDir(path.join(backupDir, 'media'), path.join(DIR.data, 'media'));
}

// --- Release ----------------------------------------------------------------------------
async function release(ref = 'HEAD') {
  for (const d of Object.values(DIR)) fs.mkdirSync(d, { recursive: true });
  const keys = secrets();
  takeLock();
  const commit = git(['rev-parse', '--verify', `${ref}^{commit}`]).trim();
  const subject = git(['log', '-1', '--format=%s', commit]).trim();
  const id = `${stamp()}-${commit.slice(0, 8)}`;
  const R = path.join(DIR.releases, id);
  const state = readState();
  const previous = state.current;
  const firstTime = !fs.existsSync(path.join(DIR.data, 'db'));
  releaseLog = path.join(DIR.logs, `release-${id}.log`);
  let switched = false;

  try {
    say(`Release ${id}: ${subject}`);
    const pending = git(['status', '--porcelain']).trim();
    if (pending) say(`   ${pending.split('\n').length} uncommitted changes in the workshop are not part of it: only committed work goes live.`);

    say('1/7 A clean copy of the committed version, and its packages...');
    const tar = path.join(DIR.releases, `${id}.tar`);
    git(['archive', '--format=tar', '-o', tar, commit]);
    fs.mkdirSync(R, { recursive: true });
    run('tar', ['-xf', tar, '-C', R], { label: 'unpacking' });
    fs.rmSync(tar);
    npm(['ci', '--no-audit', '--no-fund', '--include-workspace-root', ...SERVED.map((w) => `--workspace=${w}`)], { cwd: R, env: baseEnv(), label: 'installing packages' });

    say('2/7 Checks: types, tests, database changes...');
    const ws = CHECKED.map((w) => `--workspace=${w}`);
    npm(['run', 'typecheck', '--if-present', ...ws], { cwd: R, env: baseEnv(), label: 'type check' });
    npm(['test', '--if-present', ...ws], { cwd: R, env: baseEnv(), label: 'tests' });
    const liveMigrations = previous && path.join(releaseDir(previous), 'packages', 'db', 'drizzle');
    tsx(R, ['packages/db/src/scripts/check-migrations.ts', ...(liveMigrations && fs.existsSync(liveMigrations) ? ['--against', liveMigrations] : [])], {
      cwd: R,
      env: baseEnv(),
      label: 'database change check',
    });

    say(firstTime ? '3/7 Rehearsal on a new database...' : '3/7 Rehearsal on a copy of the live data...');
    fs.rmSync(DIR.staging, { recursive: true, force: true });
    fs.mkdirSync(path.join(DIR.staging, 'media'), { recursive: true });
    const stagingDb = `pglite:${path.join(DIR.staging, 'db')}`;
    const apiDir = path.join(R, 'apps', 'api');
    if (firstTime) {
      tsx(R, ['src/cli/live-db.ts', 'init', stagingDb], { cwd: apiDir, env: baseEnv(), label: 'new database' });
    } else {
      await withLiveApiStopped(keys, () => copyDir(path.join(DIR.data, 'db'), path.join(DIR.staging, 'db')));
      const out = tsx(R, ['src/cli/live-db.ts', 'migrate', stagingDb], { cwd: apiDir, env: baseEnv(), label: 'database changes on the copy' });
      const counts = JSON.parse(out.trim().split(/\r?\n/).find((l) => l.startsWith('{')) ?? '{}');
      say(`   data kept: ${Object.entries(counts.after ?? {}).map(([t, n]) => `${t} ${n}`).join(', ')}`);
    }
    await startService(R, 'staging', 'api', keys);
    if (!(await until(() => healthy(PORTS.staging.api), 180_000))) fail('The new version\'s API did not start on the copy (see logs/staging-api.log).');

    say('4/7 Building the site and the CMS...');
    npm(['run', 'build', '--workspace=@b4/admin'], { cwd: R, env: buildEnv('cms', keys), label: 'CMS build' });
    npm(['run', 'build', '--workspace=@b4/web'], { cwd: R, env: buildEnv('web', keys), label: 'site build' });

    say('5/7 Testing the rehearsal: home page, article, category, sitemap, CMS...');
    await startService(R, 'staging', 'web', keys);
    await startService(R, 'staging', 'cms', keys);
    for (const name of ['web', 'cms']) await until(() => answering(PORTS.staging[name]), 90_000);
    const rehearsal = await smoke('staging');
    await stopAll('staging');
    if (rehearsal.length) fail(`The new version failed on the copy of the live data:\n  - ${rehearsal.join('\n  - ')}`);

    say('6/7 Switching over: stop, back up, start the new version...');
    if (previous) await stopAll('live');
    switched = true;
    const backup = firstTime ? null : backupNow(`before-${id}`);
    if (backup) say(`   backup: ${backup}`);
    if (firstTime) {
      const out = tsx(R, ['src/cli/live-db.ts', 'init', `pglite:${path.join(DIR.data, 'db')}`, HOME], { cwd: apiDir, env: baseEnv(), label: 'new live database' });
      fs.mkdirSync(path.join(DIR.data, 'media'), { recursive: true });
      say(`   ${tail(out, 2).split('\n')[0]}`);
    }
    try {
      await startAll(R, 'live', keys);
      say('7/7 Testing the live site...');
      const problems = await smoke('live');
      if (problems.length) fail(`The new version failed live:\n  - ${problems.join('\n  - ')}`);
    } catch (e) {
      say(`${e.message}\nRolling back...`);
      await stopAll('live').catch(() => {});
      if (backup) putBack(backup);
      if (previous && fs.existsSync(releaseDir(previous))) {
        await startAll(releaseDir(previous), 'live', keys);
        fail(`Release ${id} was rolled back: the live site runs ${previous.id} on the data from before, as it was.`);
      }
      fail(`Release ${id} failed and there is no earlier version to go back to.`);
    }
    await refreshSite(keys);

    state.previous = previous;
    state.current = { id, commit, subject, at: new Date().toISOString(), backup };
    state.history = [state.current, ...(state.history ?? [])].slice(0, 50);
    writeState(state);
    prune(DIR.releases, KEEP_RELEASES, [id, previous?.id].filter(Boolean));
    writeLauncher();
    say(`Done: the live site runs ${id}.`);
    say(`   site http://localhost:${PORTS.live.web}  |  CMS http://localhost:${PORTS.live.cms}`);
    if (firstTime) say(`   first admin sign-in: ${path.join(HOME, 'admin.txt')}`);
  } catch (e) {
    // A version that never went live is removed; its log stays.
    await stopAll('staging').catch(() => {});
    if (!switched) fs.rmSync(R, { recursive: true, force: true });
    await reviveLive(keys);
    throw e;
  } finally {
    releaseLock();
    if (releaseLog) console.log(`Log: ${releaseLog}`);
  }
}

// --- Day-to-day -----------------------------------------------------------------------------
function requireCurrent() {
  const state = readState();
  if (!state.current) fail('Nothing has been released yet: run "npm run live -- release".');
  return state;
}

async function start() {
  const state = requireCurrent();
  if (await healthy(PORTS.live.api)) return say('The live environment is already running.');
  // Whatever is left of a half-running environment (e.g. the API stopped but not the site) goes first.
  await stopAll('live');
  await startAll(releaseDir(state.current), 'live', secrets());
  writeLauncher();
  say(`Running ${state.current.id}: site http://localhost:${PORTS.live.web} | CMS http://localhost:${PORTS.live.cms}`);
}

async function status() {
  const state = readState();
  console.log(`Live environment: ${HOME}`);
  if (!state.current) return console.log('Nothing released yet. Run: npm run live -- release');
  console.log(`Version:  ${state.current.id}  "${state.current.subject}"  (${state.current.at})`);
  if (state.previous) console.log(`Previous: ${state.previous.id}  (rollback goes here)`);
  for (const name of ['api', 'web', 'cms']) {
    const port = PORTS.live[name];
    const up = name === 'api' ? await healthy(port) : await answering(port);
    console.log(`  ${name.padEnd(4)} http://localhost:${port}  ${up ? 'running' : 'stopped'}`);
  }
  if (!(await healthy(PORTS.live.api))) console.log(`Start it with: npm run live -- start  (or double-click ${path.join(HOME, 'start-live.cmd')})`);
  const backups = fs.existsSync(DIR.backups) ? fs.readdirSync(DIR.backups).sort().reverse().slice(0, 3) : [];
  console.log(`Latest backups: ${backups.join(', ') || 'none'}`);
}

async function rollback() {
  const state = requireCurrent();
  if (!state.previous || !fs.existsSync(releaseDir(state.previous))) fail('There is no earlier version to go back to.');
  const keys = secrets();
  say(`Going back from ${state.current.id} to ${state.previous.id}; the data stays as it is.`);
  await stopAll('live');
  await startAll(releaseDir(state.previous), 'live', keys);
  const problems = await smoke('live');
  if (problems.length) {
    say(`The earlier version has problems with the current data:\n  - ${problems.join('\n  - ')}`);
    if (state.current.backup) say(`To also put back the data from before ${state.current.id}: npm run live -- restore ${path.basename(state.current.backup)}`);
  }
  [state.current, state.previous] = [state.previous, state.current];
  writeState(state);
  await refreshSite(keys);
  say(`The live site runs ${state.current.id}.`);
}

async function backupCommand() {
  requireCurrent();
  const dir = await withLiveApiStopped(secrets(), () => backupNow('manual'));
  say(`Backup: ${dir}`);
}

async function restore(name) {
  const state = requireCurrent();
  const all = fs.existsSync(DIR.backups) ? fs.readdirSync(DIR.backups).sort().reverse() : [];
  if (!name) {
    console.log(`Backups (newest first):\n${all.map((b) => `  ${b}`).join('\n') || '  none'}\nRestore one with: npm run live -- restore <name>`);
    return;
  }
  const from = path.join(DIR.backups, name);
  if (!fs.existsSync(path.join(from, 'db'))) fail(`No backup "${name}".`);
  const keys = secrets();
  await stopAll('live');
  // The data being replaced is kept, never deleted.
  const aside = path.join(DIR.backups, `${stamp()}-replaced-by-restore`);
  copyDir(path.join(DIR.data, 'db'), path.join(aside, 'db'));
  copyDir(path.join(DIR.data, 'media'), path.join(aside, 'media'));
  putBack(from);
  await startAll(releaseDir(state.current), 'live', keys);
  await refreshSite(keys);
  say(`Restored ${name}. The data it replaced is in ${aside}.`);
}

/** News sites tested elsewhere (a JSON export), added to the live CMS as active. */
async function importSources(file) {
  if (!file || !fs.existsSync(file)) fail('Usage: npm run live -- import-sources <file.json>');
  const state = requireCurrent();
  const R = releaseDir(state.current);
  const out = await withLiveApiStopped(secrets(), () =>
    tsx(R, ['src/cli/live-db.ts', 'import-sources', `pglite:${path.join(DIR.data, 'db')}`, path.resolve(file)], {
      cwd: path.join(R, 'apps', 'api'),
      env: baseEnv(),
      label: 'importing sites',
    }),
  );
  console.log(out.trim());
}

/**
 * Articles from the workshop (a bundle made with `live-db.ts export-articles`), added to the live
 * site after a backup; an article whose slug is already live is left alone.
 */
async function importArticles(dir) {
  if (!dir || !fs.existsSync(path.join(dir, 'articles.json'))) fail('Usage: npm run live -- import-articles <bundle-dir> (a folder with articles.json)');
  const state = requireCurrent();
  const R = releaseDir(state.current);
  const keys = secrets();
  const out = await withLiveApiStopped(keys, () => {
    say(`Backup first: ${backupNow('before-import-articles')}`);
    return tsx(R, ['src/cli/live-db.ts', 'import-articles', `pglite:${path.join(DIR.data, 'db')}`, path.join(DIR.data, 'media'), path.resolve(dir)], {
      cwd: path.join(R, 'apps', 'api'),
      env: baseEnv(),
      label: 'importing articles',
    });
  });
  console.log(out.trim());
  await refreshSite(keys);
}

function logs(name = 'api') {
  const file = path.join(DIR.logs, `live-${name}.log`);
  if (!fs.existsSync(file)) fail(`No log yet for ${name}.`);
  console.log(tail(fs.readFileSync(file, 'utf8'), 80));
}

// --- Main ---------------------------------------------------------------------------------
const [command = 'status', arg] = process.argv.slice(2);
const commands = {
  release: () => release(arg),
  status,
  start,
  stop: async () => {
    await stopAll('live');
    say('The live environment is stopped.');
  },
  restart: async () => {
    await stopAll('live');
    await start();
  },
  rollback,
  backup: backupCommand,
  restore: () => restore(arg),
  'import-sources': () => importSources(arg),
  'import-articles': () => importArticles(arg),
  logs: () => logs(arg),
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
