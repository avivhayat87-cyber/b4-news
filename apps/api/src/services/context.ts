// Everything the domain services need, built once at startup and passed down
// (no module-level singletons, so tests can swap any piece).
import type { Db } from '@b4/db';
import type { Config } from '../config';
import { ConfiguredMailer, type Mailer } from '../lib/mailer';
import { safeFetch } from '../lib/safe-fetch';
import { LocalStorage, type MediaStorage } from '../lib/storage';
import { type AiHub, createAiHub } from './ai';
import type { Fetcher } from './scraper/collect';
import { SettingsStore } from './settings';

export type Log = { info(obj: object, msg?: string): void; warn(obj: object, msg?: string): void; error(obj: object, msg?: string): void };

export type Services = {
  db: Db;
  config: Config;
  settings: SettingsStore;
  ai: AiHub;
  storage: MediaStorage;
  fetch: Fetcher;
  mailer: Mailer;
  log: Log;
};

export function createFetcher(config: Config): Fetcher {
  return (url, opts) => safeFetch(url, { allowPrivate: config.scraper.allowPrivate, userAgent: config.scraper.userAgent, ...opts });
}

export type ServiceOverrides = Partial<Pick<Services, 'ai' | 'storage' | 'fetch' | 'mailer'>>;

/** The one place that wires the services (used by the API process and the standalone worker). */
export function createServices(config: Config, db: Db, log: Log, overrides: ServiceOverrides = {}): Services {
  const settings = new SettingsStore(db, config);
  return {
    db,
    config,
    settings,
    ai: overrides.ai ?? createAiHub(config, settings),
    storage: overrides.storage ?? new LocalStorage(config.mediaDir, config.mediaBaseUrl),
    fetch: overrides.fetch ?? createFetcher(config),
    mailer:
      overrides.mailer ??
      new ConfiguredMailer(async () => {
        const v = await settings.integration('smtp');
        return { url: v.url, from: v.from };
      }, !config.production),
    log,
  };
}

export const consoleLog: Log = {
  info: (obj, msg) => console.log(msg ?? '', obj),
  warn: (obj, msg) => console.warn(msg ?? '', obj),
  error: (obj, msg) => console.error(msg ?? '', obj),
};
