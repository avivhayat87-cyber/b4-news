// API client for the app. Readers authenticate with a Bearer token (never cookies),
// so the app is unaffected by the site's cross-site protections.
import type {
  AdLeadInput,
  AdSlot,
  ArticleCard,
  ArticleFull,
  CategoryPage,
  CategoryRef,
  CommentDto,
  CommentList,
  DigestPrefs,
  FeedMode,
  FeedPage,
  HomeData,
  LikeResult,
  Page,
  PublicAdSlot,
  PublicSite,
  ReaderDto,
  ReaderNotificationList,
  ReaderPrefs,
  ReaderSession,
} from '@b4/shared';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { getToken } from './token';

/**
 * EXPO_PUBLIC_API_URL wins. In development the app falls back to the machine running
 * `expo start` (port 4000), so a phone on the same Wi-Fi reaches the local API.
 */
function apiBase(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  if (Platform.OS === 'web') return 'http://localhost:4000/api/v1';
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  return `http://${host ?? 'localhost'}:4000/api/v1`;
}

export const API_BASE = apiBase();

/** The public site, for info pages and sharing. Development: the same host on port 3000. */
export const SITE_URL = (process.env.EXPO_PUBLIC_SITE_URL ?? API_BASE.replace(/:4000\/api\/v1$/, ':3000').replace(/\/api\/v1$/, '')).replace(/\/+$/, '');

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getToken();
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch {
    throw new ApiFailure(0, 'network', 'אין חיבור לשרת. בדקו את החיבור לאינטרנט ונסו שוב.');
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
  if (!res.ok) throw new ApiFailure(res.status, data?.code ?? 'error', data?.message ?? 'משהו השתבש. נסו שוב.');
  return data as T;
}

const json = (body: unknown) => JSON.stringify(body);
const enc = encodeURIComponent;
const withCursor = (path: string, cursor?: string | null) => (cursor ? `${path}${path.includes('?') ? '&' : '?'}cursor=${enc(cursor)}` : path);

export const api = {
  home: () => call<HomeData>('/public/home'),
  feed: (cursor?: string | null) => call<Page<ArticleCard>>(withCursor('/public/feed', cursor)),
  categories: () => call<CategoryRef[]>('/public/categories'),
  site: () => call<PublicSite>('/public/site'),
  category: (slug: string, cursor?: string | null) => call<CategoryPage>(withCursor(`/public/categories/${enc(slug)}`, cursor)),
  article: (slug: string) => call<ArticleFull>(`/public/articles/${enc(slug)}`),
  related: (slug: string) => call<ArticleCard[]>(`/public/articles/${enc(slug)}/related`),
  search: (q: string, cursor?: string | null) => call<Page<ArticleCard>>(withCursor(`/public/search?q=${enc(q)}`, cursor)),
  resolveId: (id: string) => call<{ slug: string }>(`/public/a/${enc(id)}`),

  me: async (): Promise<ReaderDto | null> => (await getToken() ? (await call<{ reader: ReaderDto | null }>('/auth/reader/session')).reader : null),
  requestCode: (email: string, opts: { acceptTerms: boolean }) => call<void>('/auth/reader/request-code', { method: 'POST', body: json({ email, ...opts }) }),
  verify: (email: string, code: string, opts: { displayName?: string; acceptTerms: boolean }) =>
    call<ReaderSession>('/auth/reader/verify', { method: 'POST', body: json({ email, code, ...opts, client: 'app' }) }),
  acceptTerms: (version: string) => call<ReaderDto>('/auth/reader/terms', { method: 'POST', body: json({ version, accept: true }) }),
  rename: (displayName: string) => call<ReaderDto>('/auth/reader/me', { method: 'PATCH', body: json({ displayName }) }),
  deleteAccount: () => call<void>('/auth/reader/me', { method: 'DELETE' }),
  logout: () => call<void>('/auth/reader/logout', { method: 'POST' }),
  recordConsent: (visitorId: string, version: string) =>
    call<void>('/public/consent', { method: 'POST', body: json({ visitorId, version, ads: false, channel: 'app' }) }),

  comments: (articleId: number, cursor?: string | null, sort: 'top' | 'new' = 'top') => call<CommentList>(withCursor(`/public/articles/${articleId}/comments?sort=${sort}`, cursor)),
  likeComment: (id: string) => call<LikeResult>(`/comments/${id}/like`, { method: 'POST' }),
  unlikeComment: (id: string) => call<LikeResult>(`/comments/${id}/like`, { method: 'DELETE' }),
  notifications: () => call<ReaderNotificationList>('/auth/reader/notifications'),
  markNotificationsRead: () => call<void>('/auth/reader/notifications/read', { method: 'POST', body: json({}) }),
  myFeed: (mode: FeedMode, cursor: string | null, seed: number) =>
    call<FeedPage>(withCursor(`/auth/reader/feed?mode=${mode}&seed=${seed}`, cursor)),
  digest: () => call<DigestPrefs>('/auth/reader/digest'),
  saveDigest: (prefs: DigestPrefs) => call<DigestPrefs>('/auth/reader/digest', { method: 'PUT', body: json(prefs) }),
  prefs: () => call<ReaderPrefs>('/auth/reader/prefs'),
  savePrefs: (prefs: ReaderPrefs) => call<ReaderPrefs>('/auth/reader/prefs', { method: 'PUT', body: json(prefs) }),
  postComment: (articleId: number, body: string, parentId?: string) =>
    call<CommentDto>(`/articles/${articleId}/comments`, { method: 'POST', body: json({ body, parentId }) }),
  deleteComment: (id: string) => call<void>(`/comments/${id}`, { method: 'DELETE' }),
  reportComment: (id: string, reason: 'spam' | 'abuse' | 'misinformation' | 'other') =>
    call<void>(`/comments/${id}/report`, { method: 'POST', body: json({ reason }) }),

  registerDevice: (platform: 'ios' | 'android' | 'web', pushToken: string, appVersion?: string) =>
    call<void>('/public/devices', { method: 'POST', body: json({ platform, pushToken, appVersion }) }),

  ad: (slot: AdSlot, opts: { category?: string; exclude: string[] }) =>
    call<PublicAdSlot>(`/public/ads/${slot}?device=mobile${opts.category ? `&category=${enc(opts.category)}` : ''}${opts.exclude.length ? `&exclude=${opts.exclude.join(',')}` : ''}`),
  /** A lost view is only a number: never an error on screen. */
  adSeen: (token: string, kind: 'view' | 'open' = 'view') => call<void>('/public/ads/view', { method: 'POST', body: json({ token, kind }) }).catch(() => undefined),
  adLead: (body: AdLeadInput) => call<{ thankYou: string }>('/public/ads/lead', { method: 'POST', body: json(body) }),
};
