// Browser-side calls for reader features (sign-in, comments, ads). The API session
// cookie is httpOnly, so it is sent with `credentials: 'include'` and never read here.
import type { AdInquiryInput, AdLeadInput, AdSlot, ArticleReadInput, DigestPrefs, FeedMode, FeedPage, PartnerReportDto, PublicAdSlot, ReaderNotificationList, ReaderPrefs, TakedownInput } from '@b4/shared';
import type { CommentDto, CommentList, ReaderDto, ReaderSession } from './types';

const BASE = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1').replace(/\/+$/, '');

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
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      credentials: 'include',
      headers: { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}) },
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

/** The newsroom's count of reads: fire and forget, sent even when the reader leaves the page. */
export function recordRead(input: ArticleReadInput): void {
  void fetch(`${BASE}/public/reads`, {
    method: 'POST',
    keepalive: true,
    credentials: 'omit',
    headers: { 'content-type': 'application/json' },
    body: json(input),
  }).catch(() => undefined);
}

export const readerApi = {
  async me(): Promise<ReaderDto | null> {
    return (await call<{ reader: ReaderDto | null }>('/auth/reader/session')).reader;
  },
  /** The mail carries a one-click link back to `returnTo`, and the code. */
  requestCode: (email: string, opts: { acceptTerms: boolean; returnTo?: string }) =>
    call<void>('/auth/reader/request-code', { method: 'POST', body: json({ email, ...opts }) }),
  verify: (email: string, code: string, opts: { displayName?: string; acceptTerms: boolean }) =>
    call<ReaderSession>('/auth/reader/verify', { method: 'POST', body: json({ email, code, ...opts, client: 'web' }) }),
  verifyLink: (token: string, opts: { displayName?: string } = {}) =>
    call<{ reader: ReaderDto; returnTo: string | null }>('/auth/reader/verify-link', { method: 'POST', body: json({ token, ...opts }) }),
  acceptTerms: (version: string) => call<ReaderDto>('/auth/reader/terms', { method: 'POST', body: json({ version, accept: true }) }),
  rename: (displayName: string) => call<ReaderDto>('/auth/reader/me', { method: 'PATCH', body: json({ displayName }) }),
  deleteAccount: () => call<void>('/auth/reader/me', { method: 'DELETE' }),
  logout: () => call<void>('/auth/reader/logout', { method: 'POST' }),
  notifications: () => call<ReaderNotificationList>('/auth/reader/notifications'),
  markRead: (ids?: string[]) => call<void>('/auth/reader/notifications/read', { method: 'POST', body: json(ids ? { ids } : {}) }),
  prefs: () => call<ReaderPrefs>('/auth/reader/prefs'),
  savePrefs: (prefs: ReaderPrefs) => call<ReaderPrefs>('/auth/reader/prefs', { method: 'PUT', body: json(prefs) }),
  feed: (mode: FeedMode, cursor: string | undefined, seed: number) =>
    call<FeedPage>(`/auth/reader/feed?mode=${mode}&seed=${seed}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),
  digest: () => call<DigestPrefs>('/auth/reader/digest'),
  saveDigest: (prefs: DigestPrefs) => call<DigestPrefs>('/auth/reader/digest', { method: 'PUT', body: json(prefs) }),
};

export const newsletterApi = {
  subscribe: (email: string) => call<void>('/public/newsletter', { method: 'POST', body: json({ email, acceptTerms: true }) }),
  /** Returns the key for the preferences ("העיתון שלי") that every issue links to as well. */
  confirm: (token: string) => call<{ id: string; token: string }>('/public/newsletter/confirm', { method: 'POST', body: json({ token }) }),
  prefs: (id: string, token: string) => call<DigestPrefs>(`/public/newsletter/preferences/${encodeURIComponent(id)}/${encodeURIComponent(token)}`),
  savePrefs: (id: string, token: string, prefs: DigestPrefs) =>
    call<DigestPrefs>(`/public/newsletter/preferences/${encodeURIComponent(id)}/${encodeURIComponent(token)}`, { method: 'PUT', body: json(prefs) }),
  unsubscribe: (id: string, token: string) => call<void>('/public/newsletter/unsubscribe', { method: 'POST', body: json({ id, token }) }),
};

export const consentApi = {
  record: (body: { visitorId: string; version: string; ads: boolean }) =>
    call<void>('/public/consent', { method: 'POST', body: json({ ...body, channel: 'web' }) }),
};

export const takedownApi = {
  submit: (body: TakedownInput) => call<{ id: string; reference: string; dueAt: string }>('/public/takedown', { method: 'POST', body: json(body) }),
};

export const adsApi = {
  slot: (slot: AdSlot, q: { device: 'desktop' | 'mobile'; category?: string; exclude: string[] }) =>
    call<PublicAdSlot>(`/public/ads/${slot}?device=${q.device}${q.category ? `&category=${encodeURIComponent(q.category)}` : ''}${q.exclude.length ? `&exclude=${q.exclude.join(',')}` : ''}`),
  /** Sent even while the reader leaves the page (keepalive), and never fails loudly: a lost view is only a number. */
  view: (token: string, kind: 'view' | 'open' | 'shown' = 'view') =>
    fetch(`${BASE}/public/ads/view`, { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body: json({ token, kind }) }).catch(() => undefined),
  lead: (body: AdLeadInput) => call<{ thankYou: string }>('/public/ads/lead', { method: 'POST', body: json(body) }),
  inquiry: (body: AdInquiryInput) => call<void>('/public/ads/inquiry', { method: 'POST', body: json(body) }),
  partner: (key: string) => call<PartnerReportDto>(`/public/partners/${encodeURIComponent(key)}`),
};

export const commentsApi = {
  list: (articleId: number, cursor?: string | null, sort: 'top' | 'new' = 'top') =>
    call<CommentList>(`/public/articles/${articleId}/comments?sort=${sort}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),
  like: (id: string) => call<{ likeCount: number; likedByMe: boolean }>(`/comments/${id}/like`, { method: 'POST' }),
  unlike: (id: string) => call<{ likeCount: number; likedByMe: boolean }>(`/comments/${id}/like`, { method: 'DELETE' }),
  create: (articleId: number, body: string, parentId?: string) =>
    call<CommentDto>(`/articles/${articleId}/comments`, { method: 'POST', body: json({ body, parentId }) }),
  remove: (id: string) => call<void>(`/comments/${id}`, { method: 'DELETE' }),
  report: (id: string, reason: 'spam' | 'abuse' | 'misinformation' | 'other') =>
    call<void>(`/comments/${id}/report`, { method: 'POST', body: json({ reason }) }),
};
