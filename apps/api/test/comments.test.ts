import type { CommentDto, CommentList, HomeData } from '@b4/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGIN, codeFrom, setup, signInReader, signInStaff } from './helpers';

let ctx: Awaited<ReturnType<typeof setup>>;
let articleId: number;

beforeAll(async () => {
  ctx = await setup();
  const home = (await ctx.app.inject({ url: '/api/v1/public/home' })).json<HomeData>();
  articleId = home.main[0]!.id;
});
afterAll(async () => {
  await ctx.close();
});

const post = (cookie: string, body: unknown, extra: Record<string, string> = {}) =>
  ctx.app.inject({
    method: 'POST',
    url: `/api/v1/articles/${articleId}/comments`,
    headers: { cookie, origin: ORIGIN, ...extra },
    payload: body as object,
  });

describe('reader sign-in', () => {
  it('asks a new reader for a display name, then signs them in', async () => {
    const email = 'new.reader@example.com';
    await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/reader/request-code', payload: { email } });
    const code = codeFrom(ctx, email);

    const noName = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/reader/verify', payload: { email, code } });
    expect(noName.statusCode).toBe(409);
    expect(noName.json().code).toBe('name_required');

    const noTerms = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/reader/verify', payload: { email, code, displayName: 'דנה כהן' } });
    expect(noTerms.statusCode).toBe(409);
    expect(noTerms.json().code).toBe('terms_required');

    const withName = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/reader/verify',
      payload: { email, code, displayName: 'דנה כהן', acceptTerms: true },
    });
    expect(withName.statusCode).toBe(200);
    expect(withName.json().reader.displayName).toBe('דנה כהן');
    expect(withName.json().reader.termsAccepted).toBe(true);
    const cookie = withName.cookies.find((c) => c.name === 'b4_rs');
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('Lax');
  });

  it('reports the session without an error when signed out', async () => {
    const res = await ctx.app.inject({ url: '/api/v1/auth/reader/session' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ reader: null });
  });

  it('locks a code after 5 wrong attempts', async () => {
    const email = 'guesser@example.com';
    await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/reader/request-code', payload: { email } });
    const real = codeFrom(ctx, email);
    const wrong = real === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      const res = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/reader/verify', payload: { email, code: wrong, displayName: 'x y' } });
      expect(res.statusCode).toBe(400);
    }
    const late = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/reader/verify', payload: { email, code: real, displayName: 'x y', acceptTerms: true } });
    expect(late.statusCode).toBe(400);
  });

  it('returns a bearer token to the app and accepts it', async () => {
    const email = 'app.user@example.com';
    await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/reader/request-code', payload: { email } });
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/reader/verify',
      payload: { email, code: codeFrom(ctx, email), displayName: 'משתמש אפליקציה', acceptTerms: true, client: 'app' },
    });
    const { token } = res.json();
    expect(token).toBeTypeOf('string');
    expect(res.cookies.find((c) => c.name === 'b4_rs')).toBeUndefined();
    const me = await ctx.app.inject({ url: '/api/v1/auth/reader/me', headers: { authorization: `Bearer ${token}` } });
    expect(me.json().displayName).toBe('משתמש אפליקציה');
  });
});

describe('comments', () => {
  it('requires sign-in to post', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: `/api/v1/articles/${articleId}/comments`, payload: { body: 'שלום' } });
    expect(res.statusCode).toBe(401);
    expect(res.json().message).toBe('צריך להתחבר כדי להמשיך');
  });

  it('blocks cookie writes from another site (CSRF)', async () => {
    const cookie = await signInReader(ctx, 'csrf@example.com', 'בודק אבטחה');
    const noOrigin = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/articles/${articleId}/comments`,
      headers: { cookie },
      payload: { body: 'ניסיון' },
    });
    expect(noOrigin.statusCode).toBe(403);
    const evil = await post(cookie, { body: 'ניסיון' }, { origin: 'https://evil.example' });
    expect(evil.statusCode).toBe(403);
  });

  it('publishes, lists with ownership, and rejects duplicates', async () => {
    const cookie = await signInReader(ctx, 'writer@example.com', 'יוסי לוי');
    const created = await post(cookie, { body: 'כתבה מצוינת, תודה על ההסבר' });
    expect(created.statusCode).toBe(201);
    const comment = created.json<CommentDto>();
    expect(comment.pending).toBe(false);

    const again = await post(cookie, { body: 'כתבה מצוינת, תודה על ההסבר' });
    expect(again.statusCode).toBe(409);

    const mine = await ctx.app.inject({ url: `/api/v1/public/articles/${articleId}/comments`, headers: { cookie } });
    const list = mine.json<CommentList>();
    expect(list.items.find((c) => c.id === comment.id)?.isMine).toBe(true);

    const anonymous = await ctx.app.inject({ url: `/api/v1/public/articles/${articleId}/comments` });
    expect(anonymous.json<CommentList>().items.find((c) => c.id === comment.id)?.isMine).toBe(false);
  });

  it('stores comments as plain text and validates length in Hebrew', async () => {
    const cookie = await signInReader(ctx, 'html@example.com', 'בודקת');
    const html = await post(cookie, { body: '<script>alert(1)</script> שלום' });
    expect(html.statusCode).toBe(201);
    expect(html.json<CommentDto>().body).toBe('<script>alert(1)</script> שלום'); // escaped by the clients when rendered
    const short = await post(cookie, { body: 'א' });
    expect(short.statusCode).toBe(400);
    expect(short.json().message).toBe('התגובה קצרה מדי');
  });

  it('holds flagged words for review and shows them only to the author', async () => {
    const cookie = await signInReader(ctx, 'rude@example.com', 'גס רוח');
    const res = await post(cookie, { body: 'איזה מניאק כתב את זה' });
    expect(res.statusCode).toBe(201);
    const held = res.json<CommentDto>();
    expect(held.pending).toBe(true);
    const publicList = await ctx.app.inject({ url: `/api/v1/public/articles/${articleId}/comments` });
    expect(publicList.json<CommentList>().items.some((c) => c.id === held.id)).toBe(false);
    const ownList = await ctx.app.inject({ url: `/api/v1/public/articles/${articleId}/comments`, headers: { cookie } });
    expect(ownList.json<CommentList>().items.some((c) => c.id === held.id)).toBe(true);
  });

  it('threads replies one level deep', async () => {
    const a = await signInReader(ctx, 'thread.a@example.com', 'קורא א');
    const b = await signInReader(ctx, 'thread.b@example.com', 'קורא ב');
    const root = (await post(a, { body: 'שאלה על הכתבה' })).json<CommentDto>();
    const reply1 = (await post(b, { body: 'תשובה ראשונה', parentId: root.id })).json<CommentDto>();
    const reply2 = (await post(a, { body: 'תשובה לתשובה', parentId: reply1.id })).json<CommentDto>();
    expect(reply1.parentId).toBe(root.id);
    expect(reply2.parentId).toBe(root.id);
  });

  it('hides a comment after 3 reports and lets a moderator restore it', async () => {
    const author = await signInReader(ctx, 'reported@example.com', 'מדווח');
    const target = (await post(author, { body: 'תגובה שנויה במחלוקת' })).json<CommentDto>();

    const self = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/comments/${target.id}/report`,
      headers: { cookie: author, origin: ORIGIN },
      payload: { reason: 'spam' },
    });
    expect(self.statusCode).toBe(400);

    for (const n of [1, 2, 3]) {
      const reporter = await signInReader(ctx, `reporter${n}@example.com`, `מדווח ${n}`);
      const r = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/comments/${target.id}/report`,
        headers: { cookie: reporter, origin: ORIGIN },
        payload: { reason: 'abuse' },
      });
      expect(r.statusCode).toBe(204);
    }
    const list = await ctx.app.inject({ url: `/api/v1/public/articles/${articleId}/comments` });
    expect(list.json<CommentList>().items.some((c) => c.id === target.id)).toBe(false);

    const staff = await signInStaff(ctx, 'editor');
    const queue = await ctx.app.inject({ url: '/api/v1/admin/comments?status=hidden', headers: { cookie: staff } });
    expect(queue.json().items.some((c: { id: string }) => c.id === target.id)).toBe(true);
    const restore = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/comments/${target.id}`,
      headers: { cookie: staff, origin: ORIGIN },
      payload: { status: 'visible', note: 'בדקתי, תקין' },
    });
    expect(restore.statusCode).toBe(204);
  });

  it('keeps readers out of the moderation API', async () => {
    const reader = await signInReader(ctx, 'curious@example.com', 'סקרן');
    const res = await ctx.app.inject({ url: '/api/v1/admin/comments', headers: { cookie: reader } });
    expect(res.statusCode).toBe(401);
  });
});
