// Everything the domain services need, built once at startup and passed down
// (no module-level singletons, so tests can swap any piece).
import type { Db } from '@b4/db';
import type { Config } from '../config';
import type { Mailer } from '../lib/mailer';
import { safeFetch } from '../lib/safe-fetch';
import type { MediaStorage } from '../lib/storage';
import type { Ai } from './ai';
import type { Fetcher } from './scraper/collect';

export type Log = { info(obj: object, msg?: string): void; warn(obj: object, msg?: string): void; error(obj: object, msg?: string): void };

export type Services = {
  db: Db;
  config: Config;
  ai: Ai;
  storage: MediaStorage;
  fetch: Fetcher;
  mailer: Mailer;
  log: Log;
};

export function createFetcher(config: Config): Fetcher {
  return (url, opts) => safeFetch(url, { allowPrivate: config.scraper.allowPrivate, userAgent: config.scraper.userAgent, ...opts });
}

export const consoleLog: Log = {
  info: (obj, msg) => console.log(msg ?? '', obj),
  warn: (obj, msg) => console.warn(msg ?? '', obj),
  error: (obj, msg) => console.error(msg ?? '', obj),
};
