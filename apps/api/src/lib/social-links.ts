// Social network accounts in links: which network, and a stable key for the account
// ("x.com/israel_mof", "t.me/mof_israel"), so the same account matches whatever form a page
// links it in (twitter.com or x.com, a query string, a trailing slash) and a post matches the
// account it came from. Share buttons are not accounts.

export const PLATFORMS = ['x', 'telegram', 'facebook', 'instagram', 'youtube', 'linkedin', 'tiktok', 'threads'] as const;
export type Platform = (typeof PLATFORMS)[number];

const HOSTS: Record<string, Platform> = {
  'x.com': 'x',
  'twitter.com': 'x',
  't.me': 'telegram',
  'telegram.me': 'telegram',
  'facebook.com': 'facebook',
  'fb.com': 'facebook',
  'instagram.com': 'instagram',
  'youtube.com': 'youtube',
  'linkedin.com': 'linkedin',
  'tiktok.com': 'tiktok',
  'threads.net': 'threads',
  'threads.com': 'threads',
};
/** The form each network's key takes in the key ("x.com/…" for twitter.com links too). */
const KEY_HOST: Record<Platform, string> = {
  x: 'x.com',
  telegram: 't.me',
  facebook: 'facebook.com',
  instagram: 'instagram.com',
  youtube: 'youtube.com',
  linkedin: 'linkedin.com',
  tiktok: 'tiktok.com',
  threads: 'threads.net',
};
/** Path starts that are never an account (share buttons, search, help, the network's own pages). */
const NOT_ACCOUNTS =
  /^(intent|share|sharer|sharer\.php|sharearticle|dialog|home|search|hashtag|i|login|signup|help|about|policies|privacy|legal|watch|embed|results|explore|tos|settings|plugins|playlist|shorts|feed|live|p|reel|reels|stories|events|groups|photo|photos|video|videos|posts|status|tv)$/;

/** How many path parts name the account on each network ("linkedin.com/company/x", "youtube.com/channel/id"). */
function accountPath(platform: Platform, parts: string[]): string[] | null {
  const [first, second] = parts;
  if (!first) return null;
  if (platform === 'linkedin') return (first === 'company' || first === 'in' || first === 'school' || first === 'showcase') && second ? [first, second] : null;
  if (platform === 'youtube') {
    if (first.startsWith('@')) return [first];
    return (first === 'channel' || first === 'c' || first === 'user') && second ? [first, second] : /^[a-z0-9_.-]{3,}$/.test(first) && !NOT_ACCOUNTS.test(first) ? [first] : null;
  }
  if (platform === 'telegram' && first === 's' && second) return [second];
  if (platform === 'facebook' && first === 'profile.php') return null;
  if (platform === 'facebook' && first === 'pages') return parts.length >= 3 ? parts.slice(0, 3) : null;
  return NOT_ACCOUNTS.test(first) ? null : [first];
}

/** The account a link points to (an account page or a post on it), or null when it isn't one. */
export function accountOf(raw: string): { platform: Platform; key: string } | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase().replace(/^(www|m|mobile|web)\./, '');
  const platform = HOSTS[host];
  if (!platform) return null;
  const parts = decodeURIComponent(url.pathname)
    .toLowerCase()
    .split('/')
    .filter(Boolean);
  const path = accountPath(platform, parts);
  return path ? { platform, key: `${KEY_HOST[platform]}/${path.join('/')}` } : null;
}

/** Whether a link (a post, or the account page itself) belongs to the account with this key. */
export function belongsTo(raw: string, key: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  const own = accountOf(raw);
  if (own) return own.key === key;
  // A post can sit under a longer path than an account page ("x.com/name/status/1" has its own account form above).
  const host = url.hostname.toLowerCase().replace(/^(www|m|mobile|web)\./, '');
  return `${host}${url.pathname.toLowerCase()}`.startsWith(`${key}/`);
}

/** Every distinct account among a page's links. */
export function accountsIn(links: string[]): { platform: Platform; key: string; url: string }[] {
  const out = new Map<string, { platform: Platform; key: string; url: string }>();
  for (const link of links) {
    const a = accountOf(link);
    if (a && !out.has(a.key)) out.set(a.key, { ...a, url: `https://${a.key}` });
  }
  return [...out.values()];
}
