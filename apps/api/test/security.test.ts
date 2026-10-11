import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGIN, setup } from './helpers';

let ctx: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(async () => {
  await ctx.close();
});

describe('security', () => {
  it('sends hardening headers', async () => {
    const res = await ctx.app.inject({ url: '/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-frame-options']).toBeDefined();
  });

  it('allows CORS only for configured origins', async () => {
    const allowed = await ctx.app.inject({ url: '/api/v1/public/categories', headers: { origin: ORIGIN } });
    expect(allowed.headers['access-control-allow-origin']).toBe(ORIGIN);
    const other = await ctx.app.inject({ url: '/api/v1/public/categories', headers: { origin: 'https://evil.example' } });
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rate-limits sign-in code requests', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/reader/request-code',
        payload: { email: `flood${i}@example.com` },
        remoteAddress: '10.9.9.9',
      });
      statuses.push(res.statusCode);
    }
    expect(statuses.slice(0, 5).every((s) => s === 204)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });

  it('does not reveal whether a staff email exists', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/staff/login',
      payload: { email: 'nobody@newsroom.test', password: 'whatever-password' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: 'bad_credentials', message: 'המייל או הסיסמה שגויים' });
  });

  it('returns Hebrew validation messages', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/reader/request-code', payload: { email: 'not-an-email' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe('כתובת המייל לא תקינה');
  });
});
