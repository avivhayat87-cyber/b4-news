// The real network path of the scraper's HTTP client, against a local server.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FetchError, checkUrl, isPublicAddress, safeFetch } from '../src/lib/safe-fetch';

let server: http.Server;
let base: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/page') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'x-accept': String(req.headers.accept) });
      res.end('<h1>שלום</h1>');
    } else if (req.url === '/redirect-ok') {
      res.writeHead(302, { location: '/page' });
      res.end();
    } else if (req.url === '/redirect-file') {
      res.writeHead(302, { location: 'file:///etc/passwd' });
      res.end();
    } else if (req.url === '/big') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('x'.repeat(50_000));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const ua = 'test-agent';

describe('safeFetch', () => {
  it('fetches and keeps the default accept header when the caller passes undefined', async () => {
    const res = await safeFetch(`${base}/page`, { allowPrivate: true, userAgent: ua, accept: undefined });
    expect(res.status).toBe(200);
    expect(res.body.toString('utf8')).toContain('שלום');
  });

  it('blocks private and link-local addresses unless allowed', async () => {
    await expect(safeFetch(`${base}/page`, { allowPrivate: false, userAgent: ua })).rejects.toMatchObject({ kind: 'blocked' });
    expect(() => checkUrl('http://localhost/', false)).toThrow(FetchError);
    expect(() => checkUrl('http://[::1]/', false)).toThrow(FetchError);
    expect(() => checkUrl('file:///etc/passwd', true)).toThrow(FetchError);
    expect(() => checkUrl('http://user:pass@example.com/', false)).toThrow(FetchError);
    expect(isPublicAddress('10.0.0.1')).toBe(false);
    expect(isPublicAddress('::ffff:127.0.0.1')).toBe(false);
    expect(isPublicAddress('8.8.8.8')).toBe(true);
  });

  it('follows redirects and checks every hop', async () => {
    const ok = await safeFetch(`${base}/redirect-ok`, { allowPrivate: true, userAgent: ua });
    expect(ok.url).toBe(`${base}/page`);
    await expect(safeFetch(`${base}/redirect-file`, { allowPrivate: true, userAgent: ua })).rejects.toMatchObject({ kind: 'blocked' });
    await expect(safeFetch(`${base}/redirect-ok`, { allowPrivate: true, userAgent: ua, maxRedirects: 0 })).rejects.toThrow('too many redirects');
  });

  it('enforces the size limit', async () => {
    await expect(safeFetch(`${base}/big`, { allowPrivate: true, userAgent: ua, maxBytes: 10_000 })).rejects.toMatchObject({ kind: 'too_large' });
  });
});
