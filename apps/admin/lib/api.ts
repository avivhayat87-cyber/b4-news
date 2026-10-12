// The only way the CMS talks to the server. The staff session is an httpOnly,
// SameSite=strict cookie set by the API; this code never sees or stores it.
import type { ApiError } from '@b4/shared';

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1').replace(/\/+$/, '');
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body: ApiError & Record<string, unknown>,
  ) {
    super(message);
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

async function request<T>(method: Method, path: string, body?: unknown, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      credentials: 'include',
      headers: body !== undefined && !(body instanceof FormData) ? { 'content-type': 'application/json' } : undefined,
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
      cache: 'no-store',
      ...init,
    });
  } catch {
    throw new ApiFailure(0, 'offline', 'אין חיבור לשרת. בדקו את החיבור ונסו שוב.', { code: 'offline', message: '' });
  }
  if (res.status === 204 || res.status === 202) {
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
  const data = (await res.json().catch(() => null)) as (ApiError & Record<string, unknown>) | null;
  if (!res.ok) {
    const fallback = { code: 'http_' + res.status, message: 'הפעולה נכשלה. נסו שוב.' };
    const err = data ?? fallback;
    if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/auth/')) {
      window.dispatchEvent(new Event('b4:signed-out'));
    }
    throw new ApiFailure(res.status, err.code, err.message, err);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T = void>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  put: <T = void>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T = void>(path: string, body: unknown) => request<T>('PATCH', path, body),
  upload: <T>(path: string, form: FormData) => request<T>('POST', path, form),
};

export const admin = {
  get: <T>(path: string) => api.get<T>(`/admin${path}`),
  post: <T = void>(path: string, body: unknown = {}) => api.post<T>(`/admin${path}`, body),
  put: <T = void>(path: string, body: unknown) => api.put<T>(`/admin${path}`, body),
  patch: <T = void>(path: string, body: unknown) => api.patch<T>(`/admin${path}`, body),
  upload: <T>(path: string, form: FormData) => api.upload<T>(`/admin${path}`, form),
};

export function errorMessage(e: unknown): string {
  return e instanceof ApiFailure ? e.message : e instanceof Error ? e.message : 'משהו השתבש';
}

/** A fresh key per click: a double click or a retry never publishes twice. */
export function idempotencyKey(): string {
  return crypto.randomUUID();
}
