// Reader sign-in from the mail: one click on "התחברות בלחיצה" (the token after "#" in the link),
// or the code. The link is single-use, uses the code up with it, returns to the article, and asks
// a new reader only for a name (the terms were accepted when the code was asked for).
import { eq, loginCodes } from '@b4/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup } from './helpers';

let ctx: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(() => ctx.close());

const post = (url: string, payload: object, ip = '10.7.7.7') => ctx.app.inject({ method: 'POST', url: `/api/v1/auth/reader${url}`, payload, remoteAddress: ip });
const tokenIn = (email: string) => ctx.mailer.lastTo(email)!.text.match(/\/signin#t=([A-Za-z0-9_-]+)/)![1]!;
const codeIn = (email: string) => ctx.mailer.lastTo(email)!.text.match(/\b(\d{6})\b/)![1]!;

describe('signing in from the mail', () => {
  it('mails a one-click link and the code; a new reader gives only a name and lands back on the article', async () => {
    const email = 'noa@example.com';
    expect((await post('/request-code', { email, acceptTerms: true, returnTo: '/article/abc-123' })).statusCode).toBe(204);
    const mail = ctx.mailer.lastTo(email)!;
    expect(mail.html).toContain('התחברות בלחיצה');
    expect(mail.subject).toContain(codeIn(email)); // phones offer the code from the subject
    const token = tokenIn(email);

    const needsName = await post('/verify-link', { token });
    expect(needsName.statusCode).toBe(409);
    expect(needsName.json().code).toBe('name_required');

    const signedIn = await post('/verify-link', { token, displayName: 'נועה' });
    expect(signedIn.statusCode).toBe(200);
    expect(signedIn.json()).toMatchObject({ reader: { email, displayName: 'נועה', termsAccepted: true }, returnTo: '/article/abc-123' });
    expect(signedIn.cookies.find((c) => c.name === 'b4_rs')).toBeTruthy();

    // Used once, and the code went with it.
    expect((await post('/verify-link', { token })).json().code).toBe('link_invalid');
    expect((await post('/verify', { email, code: codeIn(email), acceptTerms: true })).json().code).toBe('code_invalid');
  });

  it('a returning reader signs in with the link alone; without the terms ticked it asks for them', async () => {
    const email = 'noa@example.com';
    await post('/request-code', { email }, '10.7.7.8');
    const res = await post('/verify-link', { token: tokenIn(email) }, '10.7.7.8');
    expect(res.statusCode).toBe(200);
    expect(res.json().returnTo).toBeNull();

    // A new reader who never ticked the terms box is asked for them.
    await post('/request-code', { email: 'new@example.com' }, '10.7.7.9');
    const terms = await post('/verify-link', { token: tokenIn('new@example.com'), displayName: 'חדש' }, '10.7.7.9');
    expect(terms.json().code).toBe('terms_required');
    expect((await post('/verify-link', { token: tokenIn('new@example.com'), displayName: 'חדש', acceptTerms: true }, '10.7.7.9')).statusCode).toBe(200);
  });

  it('refuses expired links, links to other sites and made-up tokens', async () => {
    const email = 'late@example.com';
    await post('/request-code', { email, acceptTerms: true }, '10.7.7.10');
    const token = tokenIn(email);
    await ctx.db.update(loginCodes).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(loginCodes.email, email));
    expect((await post('/verify-link', { token, displayName: 'מאוחר' }, '10.7.7.10')).json().code).toBe('link_invalid');
    expect((await post('/verify-link', { token: 'x'.repeat(43) }, '10.7.7.10')).json().code).toBe('link_invalid');
    expect((await post('/request-code', { email, returnTo: '//evil.example/steal' }, '10.7.7.10')).statusCode).toBe(400);
  });
});
