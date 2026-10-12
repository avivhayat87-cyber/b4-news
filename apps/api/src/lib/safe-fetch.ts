// HTTP client for URLs that come from outside (source sites, manual "add by link",
// image downloads). Guards against server-side request forgery:
//   - http/https only, no credentials in the URL
//   - every resolved address must be public unicast (checked at connect time,
//     so DNS rebinding can't swap in a private address after the check)
//   - redirects are followed manually and each hop is checked again
//   - time and size limits, decompression included
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import zlib from 'node:zlib';
import ipaddr from 'ipaddr.js';

export class FetchError extends Error {
  constructor(
    message: string,
    readonly kind: 'blocked' | 'network' | 'status' | 'too_large' | 'timeout' | 'type',
    readonly status?: number,
  ) {
    super(message);
    this.name = 'FetchError';
  }
}

export type FetchOptions = {
  allowPrivate: boolean;
  userAgent: string;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  accept?: string;
  /** Reject responses whose content-type doesn't start with one of these. */
  allowTypes?: string[];
};

export type FetchResult = { url: string; status: number; contentType: string; body: Buffer };

export function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  let ip = ipaddr.parse(address);
  if (ip.kind() === 'ipv6' && (ip as ipaddr.IPv6).isIPv4MappedAddress()) ip = (ip as ipaddr.IPv6).toIPv4Address();
  return ip.range() === 'unicast';
}

function guardedLookup(allowPrivate: boolean): LookupFunction {
  return (hostname, options, callback) => {
    dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, '', 4);
      const list = addresses as unknown as dns.LookupAddress[];
      if (!allowPrivate && list.some((a) => !isPublicAddress(a.address))) {
        return callback(new FetchError(`${hostname} resolves to a private address`, 'blocked'), '', 4);
      }
      if (options.all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
      const first = list[0];
      if (!first) return callback(new Error(`no address for ${hostname}`), '', 4);
      return callback(null, first.address, first.family);
    });
  };
}

export function checkUrl(raw: string, allowPrivate: boolean): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchError('invalid URL', 'blocked');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new FetchError('only http and https are allowed', 'blocked');
  if (url.username || url.password) throw new FetchError('credentials in URLs are not allowed', 'blocked');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!allowPrivate) {
    if (ipaddr.isValid(host) && !isPublicAddress(host)) throw new FetchError('private addresses are not allowed', 'blocked');
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
      throw new FetchError('local host names are not allowed', 'blocked');
    }
    if (url.port && url.port !== '80' && url.port !== '443') throw new FetchError('only the standard web ports are allowed', 'blocked');
  }
  return url;
}

function requestOnce(url: URL, opts: Required<Omit<FetchOptions, 'allowTypes'>>, deadline: number): Promise<{ res: http.IncomingMessage }> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(
      url,
      {
        method: 'GET',
        lookup: guardedLookup(opts.allowPrivate),
        headers: {
          'user-agent': opts.userAgent,
          accept: opts.accept,
          'accept-encoding': 'gzip, deflate, br',
          'accept-language': 'he,en;q=0.8',
        },
        timeout: Math.max(1000, deadline - Date.now()),
      },
      (res) => resolve({ res }),
    );
    req.on('timeout', () => req.destroy(new FetchError('timed out', 'timeout')));
    req.on('error', (e) => reject(e instanceof FetchError ? e : new FetchError(e.message, 'network')));
    req.end();
  });
}

function readBody(res: http.IncomingMessage, maxBytes: number, deadline: number): Promise<Buffer> {
  const declared = Number(res.headers['content-length'] ?? 0);
  if (declared > maxBytes) {
    res.destroy();
    return Promise.reject(new FetchError('response too large', 'too_large'));
  }
  const encoding = String(res.headers['content-encoding'] ?? '').toLowerCase();
  const stream =
    encoding === 'gzip' ? res.pipe(zlib.createGunzip()) : encoding === 'deflate' ? res.pipe(zlib.createInflate()) : encoding === 'br' ? res.pipe(zlib.createBrotliDecompress()) : res;
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => {
      res.destroy();
      reject(new FetchError('timed out', 'timeout'));
    }, Math.max(1000, deadline - Date.now()));
    stream.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        clearTimeout(timer);
        res.destroy();
        reject(new FetchError('response too large', 'too_large'));
        return;
      }
      chunks.push(chunk);
    });
    stream.on('end', () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks));
    });
    stream.on('error', (e) => {
      clearTimeout(timer);
      reject(new FetchError(e.message, 'network'));
    });
  });
}

export async function safeFetch(raw: string, options: FetchOptions): Promise<FetchResult> {
  const opts = {
    timeoutMs: 15_000,
    maxBytes: 5 * 1024 * 1024,
    maxRedirects: 5,
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    ...options,
  };
  const deadline = Date.now() + opts.timeoutMs;
  let url = checkUrl(raw, opts.allowPrivate);

  for (let hop = 0; hop <= opts.maxRedirects; hop++) {
    const { res } = await requestOnce(url, opts, deadline);
    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400 && res.headers.location) {
      res.resume();
      url = checkUrl(new URL(res.headers.location, url).toString(), opts.allowPrivate);
      continue;
    }
    if (status < 200 || status >= 300) {
      res.resume();
      throw new FetchError(`HTTP ${status}`, 'status', status);
    }
    const contentType = String(res.headers['content-type'] ?? '').toLowerCase();
    if (opts.allowTypes && !opts.allowTypes.some((t) => contentType.startsWith(t))) {
      res.resume();
      throw new FetchError(`unexpected content type ${contentType || '(none)'}`, 'type');
    }
    const body = await readBody(res, opts.maxBytes, deadline);
    return { url: url.toString(), status, contentType, body };
  }
  throw new FetchError('too many redirects', 'network');
}

/** Decodes HTML/XML using the declared charset (Hebrew sites still use windows-1255 sometimes). */
export function decodeText(result: FetchResult): string {
  const fromHeader = /charset=([\w-]+)/i.exec(result.contentType)?.[1];
  const head = result.body.subarray(0, 2048).toString('latin1');
  const fromDoc = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] ?? /<\?xml[^>]+encoding=["']([\w-]+)/i.exec(head)?.[1];
  const charset = (fromHeader ?? fromDoc ?? 'utf-8').toLowerCase();
  try {
    return new TextDecoder(charset).decode(result.body);
  } catch {
    return new TextDecoder('utf-8').decode(result.body);
  }
}
