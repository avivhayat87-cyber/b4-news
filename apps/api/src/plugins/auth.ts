// Resolves the signed-in reader (cookie or Bearer token from the app) and staff
// member (cookie) on every request, and provides route guards.
import type { StaffRole } from '@b4/shared';
import { type Db, and, eq, gt, isNull, readers, sessions, sql, staffApiTokens, users } from '@b4/db';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { Config } from '../config';
import { errors } from '../errors';
import { newToken, sha256 } from '../lib/crypto';
import { COOKIE } from './security';

export type ReaderCtx = { id: string; email: string; displayName: string; banned: boolean; termsVersion: string | null; sessionId: string };
/** apiTokenId: signed in with a personal access token (the Claude app), which reaches only the agent's tools. */
export type StaffCtx = { id: string; email: string; fullName: string; role: StaffRole; sessionId: string; apiTokenId?: string };

/** Personal access tokens carry a prefix, so they are never mistaken for a reader's app token. */
export const STAFF_TOKEN_PREFIX = 'b4s_';

declare module 'fastify' {
  interface FastifyRequest {
    reader: ReaderCtx | null;
    staff: StaffCtx | null;
  }
}

export const SESSION_TTL = {
  reader: 30 * 24 * 60 * 60 * 1000,
  staff: 12 * 60 * 60 * 1000,
} as const;

function bearerToken(header: string | undefined): string | undefined {
  const match = header?.match(/^Bearer ([A-Za-z0-9_-]{20,200})$/);
  return match?.[1];
}

async function loadReader(db: Db, token: string): Promise<ReaderCtx | null> {
  const [row] = await db
    .select({ sessionId: sessions.id, id: readers.id, email: readers.email, displayName: readers.displayName, status: readers.status, termsVersion: readers.termsVersion })
    .from(sessions)
    .innerJoin(readers, eq(sessions.readerId, readers.id))
    .where(and(eq(sessions.id, sha256(token)), eq(sessions.kind, 'reader'), gt(sessions.expiresAt, sql`now()`)))
    .limit(1);
  return row
    ? { id: row.id, email: row.email, displayName: row.displayName, banned: row.status === 'banned', termsVersion: row.termsVersion, sessionId: row.sessionId }
    : null;
}

async function loadStaff(db: Db, token: string): Promise<StaffCtx | null> {
  const [row] = await db
    .select({ sessionId: sessions.id, id: users.id, email: users.email, fullName: users.fullName, role: users.role, isActive: users.isActive })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.id, sha256(token)), eq(sessions.kind, 'staff'), gt(sessions.expiresAt, sql`now()`)))
    .limit(1);
  return row && row.isActive ? { id: row.id, email: row.email, fullName: row.fullName, role: row.role, sessionId: row.sessionId } : null;
}

async function loadStaffByApiToken(db: Db, token: string): Promise<StaffCtx | null> {
  const [row] = await db
    .select({ tokenId: staffApiTokens.id, id: users.id, email: users.email, fullName: users.fullName, role: users.role, isActive: users.isActive })
    .from(staffApiTokens)
    .innerJoin(users, eq(staffApiTokens.userId, users.id))
    .where(and(eq(staffApiTokens.tokenHash, sha256(token)), isNull(staffApiTokens.revokedAt)))
    .limit(1);
  if (!row?.isActive) return null;
  await db.update(staffApiTokens).set({ lastUsedAt: new Date() }).where(eq(staffApiTokens.id, row.tokenId));
  return { id: row.id, email: row.email, fullName: row.fullName, role: row.role, sessionId: `token:${row.tokenId}`, apiTokenId: row.tokenId };
}

export const authPlugin = fp(async (app: FastifyInstance, opts: { db: Db }) => {
  const { db } = opts;
  app.decorateRequest('reader', null);
  app.decorateRequest('staff', null);

  app.addHook('onRequest', async (req) => {
    const bearer = bearerToken(req.headers.authorization);
    const staffBearer = bearer?.startsWith(STAFF_TOKEN_PREFIX) ? bearer : undefined;
    const readerToken = (staffBearer ? undefined : bearer) ?? req.cookies[COOKIE.reader];
    if (readerToken) req.reader = await loadReader(db, readerToken);
    const staffToken = req.cookies[COOKIE.staff];
    if (staffToken) req.staff = await loadStaff(db, staffToken);
    else if (staffBearer) req.staff = await loadStaffByApiToken(db, staffBearer);
  });
});

export async function createSession(
  db: Db,
  subject: { kind: 'reader'; readerId: string } | { kind: 'staff'; userId: string },
  userAgent: string | undefined,
): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL[subject.kind]);
  await db.insert(sessions).values({
    id: sha256(token),
    kind: subject.kind,
    readerId: subject.kind === 'reader' ? subject.readerId : null,
    userId: subject.kind === 'staff' ? subject.userId : null,
    userAgent: userAgent?.slice(0, 300),
    expiresAt,
  });
  return { token, expiresAt };
}

export async function destroySession(db: Db, sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export function setSessionCookie(reply: FastifyReply, config: Config, kind: 'reader' | 'staff', token: string, expiresAt: Date): void {
  reply.setCookie(COOKIE[kind], token, {
    httpOnly: true,
    secure: config.production,
    sameSite: kind === 'staff' ? 'strict' : 'lax',
    path: '/',
    domain: config.cookieDomain,
    expires: expiresAt,
  });
}

export function clearSessionCookie(reply: FastifyReply, config: Config, kind: 'reader' | 'staff'): void {
  reply.clearCookie(COOKIE[kind], { path: '/', domain: config.cookieDomain });
}

export function requireReader(req: FastifyRequest): ReaderCtx {
  if (!req.reader) throw errors.authRequired();
  if (req.reader.banned) throw errors.banned();
  return req.reader;
}

export function requireStaff(req: FastifyRequest, ...roles: StaffRole[]): StaffCtx {
  if (!req.staff) throw errors.authRequired();
  if (roles.length && !roles.includes(req.staff.role) && req.staff.role !== 'admin') throw errors.forbidden();
  return req.staff;
}
