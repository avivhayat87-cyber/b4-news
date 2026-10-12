// robots.txt: a polite crawler reads what a site allows before opening its pages.
// Minimal parser: groups by user-agent, longest matching Allow/Disallow wins,
// "*" wildcards and "$" anchors. A missing or unreadable robots.txt allows everything.
import { decodeText } from '../../lib/safe-fetch';
import type { Fetcher } from './collect';

type Rule = { allow: boolean; pattern: RegExp; length: number };

function toRegex(path: string): RegExp {
  const anchored = path.endsWith('$');
  const body = (anchored ? path.slice(0, -1) : path).replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

export function parseRobots(text: string, agent: string): { rules: Rule[]; sitemaps: string[] } {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/#.*/, '').trim()).filter(Boolean);
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  const sitemaps: string[] = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;
  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === 'sitemap') {
      sitemaps.push(value);
      continue;
    }
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current || (field !== 'allow' && field !== 'disallow')) continue;
    if (field === 'disallow' && value === '') continue; // "Disallow:" = allow all
    current.rules.push({ allow: field === 'allow', pattern: toRegex(value), length: value.length });
  }
  const me = agent.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && me.includes(a)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  return { rules: chosen.flatMap((g) => g.rules), sitemaps };
}

export function isAllowed(rules: Rule[], pathAndQuery: string): boolean {
  let best: Rule | null = null;
  for (const r of rules) {
    if (r.pattern.test(pathAndQuery) && (!best || r.length > best.length || (r.length === best.length && r.allow))) best = r;
  }
  return best ? best.allow : true;
}

/** One robots.txt per host per run. */
export class RobotsCache {
  private readonly hosts = new Map<string, Promise<{ rules: Rule[]; sitemaps: string[] }>>();
  constructor(
    private readonly fetch: Fetcher,
    private readonly agent: string,
  ) {}

  private load(origin: string) {
    let p = this.hosts.get(origin);
    if (!p) {
      p = this.fetch(`${origin}/robots.txt`, { accept: 'text/plain', maxBytes: 512 * 1024 })
        .then((res) => parseRobots(decodeText(res), this.agent))
        .catch(() => ({ rules: [], sitemaps: [] }));
      this.hosts.set(origin, p);
    }
    return p;
  }

  async allowed(url: string): Promise<boolean> {
    const u = new URL(url);
    const { rules } = await this.load(u.origin);
    return isAllowed(rules, u.pathname + u.search);
  }

  async sitemaps(origin: string): Promise<string[]> {
    return (await this.load(origin)).sitemaps;
  }
}
