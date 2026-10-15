// A screenshot of a public web page, kept as proof of what a source said and when (the research
// reporter). It drives a browser that is already installed on the machine (Chrome, Edge or
// Chromium; BROWSER_PATH, or the usual places), so nothing large is downloaded. Every request the
// page makes goes through the same check as safeFetch: only public addresses on the web ports, so
// a page can't make the server's browser reach the server's own network.
import { promises as dns } from 'node:dns';
import { existsSync } from 'node:fs';
import ipaddr from 'ipaddr.js';
import sharp from 'sharp';
import { checkUrl, isPublicAddress } from './safe-fetch';

export interface PageCapture {
  /** False when there is no browser (or capture is off): sources keep their text copy only. */
  readonly available: boolean;
  /** A JPEG of the top of the page as a reader sees it. */
  screenshot(url: string): Promise<Buffer>;
}

/** Tests and machines without a browser. */
export class NoCapture implements PageCapture {
  readonly available = false;
  async screenshot(): Promise<Buffer> {
    throw new Error('no browser on this machine');
  }
}

const CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

/** The browser to drive: the configured one, or the first installed in a usual place. */
export function findBrowser(configured?: string): string | null {
  if (configured) return existsSync(configured) ? configured : null;
  return CANDIDATES.find((p) => existsSync(p)) ?? null;
}

/** Only public hosts on the web ports, resolved now (the same rules as safeFetch). */
async function allowed(raw: string): Promise<boolean> {
  if (raw.startsWith('data:') || raw.startsWith('blob:')) return true;
  try {
    const url = checkUrl(raw, false);
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (ipaddr.isValid(host)) return isPublicAddress(host);
    const addresses = await dns.lookup(host, { all: true });
    return addresses.length > 0 && addresses.every((a) => isPublicAddress(a.address));
  } catch {
    return false;
  }
}

export class BrowserCapture implements PageCapture {
  readonly available = true;
  constructor(private readonly executablePath: string) {}

  async screenshot(url: string): Promise<Buffer> {
    if (!(await allowed(url))) throw new Error('the address is not a public web page');
    // Loaded only when a screenshot is taken, so the API starts without it.
    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({ executablePath: this.executablePath, headless: true, args: ['--disable-dev-shm-usage', '--no-first-run'] });
    try {
      const context = await browser.newContext({ viewport: { width: 1280, height: 1600 }, locale: 'he-IL', javaScriptEnabled: true, acceptDownloads: false });
      const page = await context.newPage();
      await page.route('**/*', async (route) => ((await allowed(route.request().url())) ? route.continue() : route.abort()));
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 });
      // A moment for the page to draw what loads after the document.
      await page.waitForTimeout(1500);
      const png = await page.screenshot({ type: 'png', fullPage: false });
      return sharp(png).resize({ width: 1280, withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer();
    } finally {
      await browser.close();
    }
  }
}

/** The capture this machine can do: a browser when capture is on and one is installed, nothing otherwise. */
export function pageCapture(opts: { enabled: boolean; browserPath?: string }): PageCapture {
  if (!opts.enabled) return new NoCapture();
  const path = findBrowser(opts.browserPath);
  return path ? new BrowserCapture(path) : new NoCapture();
}
