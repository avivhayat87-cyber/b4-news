// Two-step sign-in for staff: codes as the authenticator apps make them (RFC 6238), turning it on
// from "my account", signing in with a code or a recovery code (each once), the newsroom's rule
// that requires it (set up during sign-in), and an admin's reset for a lost phone.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, currentStep, totpAt, verifyTotp } from '../src/lib/totp';
import { ORIGIN, setup, signInStaff, staffClient } from './helpers';

let ctx: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(() => ctx.close());

const login = (email: string, password = 'correct horse battery', ip = '10.3.3.3') =>
  ctx.app.inject({ method: 'POST', url: '/api/v1/auth/staff/login', payload: { email, password }, headers: { origin: ORIGIN }, remoteAddress: ip });
const auth = (url: string, payload: object, ip = '10.3.3.3') => ctx.app.inject({ method: 'POST', url: `/api/v1/auth/staff${url}`, payload, headers: { origin: ORIGIN }, remoteAddress: ip });
const code = (secret: string, ahead = 0) => totpAt(secret, currentStep() + ahead);

describe('codes', () => {
  it('match the standard (RFC 6238) and the apps, and work once', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    expect(secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode(secret).toString()).toBe('12345678901234567890');
    expect(totpAt(secret, Math.floor(59 / 30))).toBe('287082');
    expect(totpAt(secret, Math.floor(1111111109 / 30))).toBe('081804');
    const now = 1111111109_000;
    const step = verifyTotp(secret, '081804', { now });
    expect(step).toBe(Math.floor(1111111109 / 30));
    expect(verifyTotp(secret, '081804', { now, notAfter: step })).toBeNull(); // used already
    expect(verifyTotp(secret, '123456', { now })).toBeNull();
  });
});

describe('two-step sign-in', () => {
  let secret = '';
  let recovery: string[] = [];
  /** The 30-second step whose code turned it on (that code is then used up). */
  let enabledAt = 0;

  it('is turned on from "my account" with the first code from the app', async () => {
    const editor = staffClient(ctx, await signInStaff(ctx, 'editor'));
    expect((await editor.get('/me/2fa')).body).toMatchObject({ enabled: false, required: false });
    const setupRes = await editor.post('/me/2fa/setup');
    expect(setupRes.status).toBe(200);
    expect(setupRes.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\/B4%20NEW'S%3Aeditor%40newsroom\.test\?secret=/);
    expect(setupRes.body.qrSvg).toContain('<svg');
    secret = setupRes.body.secret;
    expect((await editor.post('/me/2fa/enable', { code: '000000' })).body.code).toBe('code_invalid');
    enabledAt = currentStep();
    const on = await editor.post('/me/2fa/enable', { code: totpAt(secret, enabledAt) });
    expect(on.status).toBe(200);
    recovery = on.body.recoveryCodes;
    expect(recovery).toHaveLength(10);
    expect((await editor.get('/me/2fa')).body).toMatchObject({ enabled: true, recoveryCodesLeft: 10 });
  });

  it('asks for the code after the password; a code and a recovery code each work once', async () => {
    const first = await login('editor@newsroom.test');
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ staff: null, twoFactor: 'code' });
    expect(first.cookies.find((c) => c.name === 'b4_ss')).toBeUndefined(); // not signed in yet
    const challenge = first.json().challenge;

    expect((await auth('/login/2fa', { challenge, code: totpAt(secret, enabledAt) })).json().code).toBe('code_invalid'); // used to turn it on
    const ok = await auth('/login/2fa', { challenge, code: totpAt(secret, enabledAt + 1) });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ staff: { email: 'editor@newsroom.test' }, recoveryCodes: null });
    expect(ok.cookies.find((c) => c.name === 'b4_ss')).toBeTruthy();
    // The challenge is spent.
    expect((await auth('/login/2fa', { challenge, code: totpAt(secret, enabledAt + 2) })).json().code).toBe('challenge_expired');

    const again = (await login('editor@newsroom.test')).json().challenge;
    expect((await auth('/login/2fa', { challenge: again, code: recovery[0]! })).statusCode).toBe(200);
    const third = (await login('editor@newsroom.test')).json().challenge;
    expect((await auth('/login/2fa', { challenge: third, code: recovery[0]! })).json().code).toBe('code_invalid');
  });

  it('gives up on a challenge after five wrong codes', async () => {
    const challenge = (await login('editor@newsroom.test', undefined, '10.3.3.4')).json().challenge;
    for (let i = 0; i < 5; i++) await auth('/login/2fa', { challenge, code: '111111' }, '10.3.3.4');
    expect((await auth('/login/2fa', { challenge, code: code(secret, 1) }, '10.3.3.4')).json().code).toBe('challenge_expired');
  });

  it('can be required for everyone; whoever has none sets it up while signing in', async () => {
    const admin = staffClient(ctx, await signInStaff(ctx, 'admin'));
    expect((await admin.put('/security', { requireTwoFactor: true })).body.code).toBe('enable_yourself_first');
    const own = (await admin.post('/me/2fa/setup')).body.secret;
    await admin.post('/me/2fa/enable', { code: code(own) });
    expect((await admin.put('/security', { requireTwoFactor: true })).body).toEqual({ requireTwoFactor: true });

    await signInStaff(ctx, 'viewer').catch(() => undefined); // creates the viewer; their sign-in now needs a setup
    const first = await login('viewer@newsroom.test', undefined, '10.3.3.5');
    expect(first.json()).toMatchObject({ staff: null, twoFactor: 'setup' });
    const challenge = first.json().challenge;
    const setupRes = await auth('/login/2fa-setup', { challenge }, '10.3.3.5');
    expect(setupRes.json().qrSvg).toContain('<svg');
    const done = await auth('/login/2fa', { challenge, code: code(setupRes.json().secret) }, '10.3.3.5');
    expect(done.statusCode).toBe(200);
    expect(done.json().recoveryCodes).toHaveLength(10); // shown once, right after the setup

    // Required: it can't be turned off, only reset by an admin (who sees who has it).
    const viewer = staffClient(ctx, `b4_ss=${done.cookies.find((c) => c.name === 'b4_ss')!.value}`);
    expect((await viewer.post('/me/2fa/disable', { password: 'correct horse battery', code: code(setupRes.json().secret, 1) })).body.code).toBe('required');
    const users = (await admin.get('/users')).body as { id: string; email: string; twoFactor: boolean }[];
    const v = users.find((u) => u.email === 'viewer@newsroom.test')!;
    expect(v.twoFactor).toBe(true);
    expect((await viewer.post('/users/' + v.id + '/reset-2fa')).status).toBe(403);
    expect((await admin.post(`/users/${v.id}/reset-2fa`)).status).toBe(204);
    expect((await admin.get('/users')).body.find((u: { id: string }) => u.id === v.id).twoFactor).toBe(false);
    expect((await viewer.get('/me/2fa')).status).toBe(401); // signed out by the reset
  });
});
