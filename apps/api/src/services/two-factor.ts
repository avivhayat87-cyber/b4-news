// Two-step sign-in for staff: after the password, a 6-digit code from an authenticator app
// (Google or Microsoft Authenticator). The app's secret is kept encrypted; a code works once;
// ten one-time recovery codes cover a lost phone, and an admin can reset someone's setup.
// The newsroom can require it for everyone: whoever hasn't set it up does so at their next sign-in.
import type { SecuritySettings, TwoFactorSetupDto, TwoFactorStatus } from '@b4/shared';
import { type Db, and, appSettings, eq, gt, sessions, sql, staffLoginChallenges, users } from '@b4/db';
import QRCode from 'qrcode';
import type { Config } from '../config';
import { AppError, errors } from '../errors';
import { audit } from '../lib/audit';
import { keyedHash, newToken, sha256 } from '../lib/crypto';
import { verifyPassword } from '../lib/password';
import { SecretBox } from '../lib/secret-box';
import { newRecoveryCodes, newTotpSecret, otpauthUrl, verifyTotp } from '../lib/totp';

type Ctx = { db: Db; config: Config };
type User = typeof users.$inferSelect;
const ISSUER = "B4 NEW'S";
const KEY = 'security.staff';
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_TRIES = 5;

const box = (c: Ctx) => new SecretBox(c.config.secretsKey);
const seal = (c: Ctx, userId: string, secret: string) => box(c).seal(`totp:${userId}`, secret);
const unseal = (c: Ctx, userId: string, sealed: string) => box(c).open(`totp:${userId}`, sealed);
const recoveryHash = (c: Ctx, code: string) => keyedHash(c.config.hashPepper, 'totp-recovery', code.trim().toLowerCase());

export const badCode = () => new AppError(400, 'code_invalid', 'הקוד שגוי או שכבר שומש. בדקו את השעה בטלפון ונסו את הקוד הבא.');

// --- The newsroom's rule ----------------------------------------------------------------------------
export async function getSecurity(db: Db): Promise<SecuritySettings> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, KEY)).limit(1);
  return { requireTwoFactor: (row?.value as Partial<SecuritySettings> | undefined)?.requireTwoFactor === true };
}

export async function saveSecurity(c: Ctx, staff: { id: string }, input: SecuritySettings): Promise<SecuritySettings> {
  // Requiring it while the admin has none would lock them out at their next sign-in.
  if (input.requireTwoFactor) {
    const [me] = await c.db.select({ on: users.totpEnabledAt }).from(users).where(eq(users.id, staff.id)).limit(1);
    if (!me?.on) throw new AppError(409, 'enable_yourself_first', 'קודם מפעילים אימות דו-שלבי לעצמך ("החשבון שלי"), ואז מחייבים את כולם.');
  }
  await c.db
    .insert(appSettings)
    .values({ key: KEY, value: input, updatedBy: staff.id })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: input, updatedBy: staff.id, updatedAt: new Date() } });
  await audit(c.db, { userId: staff.id, entity: 'security', entityId: 'staff', action: 'update', details: input });
  return input;
}

// --- Between the password and the session ---------------------------------------------------------------
export async function startChallenge(db: Db, userId: string): Promise<string> {
  const token = newToken();
  // Old, unfinished ones of this person go.
  await db.delete(staffLoginChallenges).where(eq(staffLoginChallenges.userId, userId));
  await db.insert(staffLoginChallenges).values({ id: sha256(token), userId, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) });
  return token;
}

const expired = () => new AppError(401, 'challenge_expired', 'עבר יותר מדי זמן או שהיו יותר מדי ניסיונות. התחברו שוב עם הסיסמה.');

export async function challengeUser(db: Db, token: string): Promise<{ id: string; user: User }> {
  const [row] = await db
    .select({ id: staffLoginChallenges.id, attempts: staffLoginChallenges.attempts, user: users })
    .from(staffLoginChallenges)
    .innerJoin(users, eq(staffLoginChallenges.userId, users.id))
    .where(and(eq(staffLoginChallenges.id, sha256(token)), gt(staffLoginChallenges.expiresAt, sql`now()`)))
    .limit(1);
  if (!row || row.attempts >= MAX_TRIES || !row.user.isActive) throw expired();
  return { id: row.id, user: row.user };
}

export async function failedTry(db: Db, challengeId: string) {
  await db
    .update(staffLoginChallenges)
    .set({ attempts: sql`${staffLoginChallenges.attempts} + 1` })
    .where(eq(staffLoginChallenges.id, challengeId));
}

export const endChallenge = (db: Db, challengeId: string) => db.delete(staffLoginChallenges).where(eq(staffLoginChallenges.id, challengeId));

// --- Setting the app up ----------------------------------------------------------------------------------
export async function startSetup(c: Ctx, user: User): Promise<TwoFactorSetupDto> {
  if (user.totpEnabledAt) throw new AppError(409, 'already_on', 'אימות דו-שלבי כבר פעיל בחשבון הזה.');
  const secret = newTotpSecret();
  await c.db.update(users).set({ totpPendingSecret: seal(c, user.id, secret) }).where(eq(users.id, user.id));
  const url = otpauthUrl(ISSUER, user.email, secret);
  return { secret, otpauthUrl: url, qrSvg: await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) };
}

/** The first code from the app confirms the setup; returns the recovery codes (shown once). */
export async function enable(c: Ctx, user: User, code: string): Promise<string[]> {
  if (!user.totpPendingSecret) throw new AppError(409, 'no_setup', 'קודם סורקים את הקוד באפליקציה.');
  const secret = unseal(c, user.id, user.totpPendingSecret);
  const step = verifyTotp(secret, code.trim());
  if (step === null) throw badCode();
  const codes = newRecoveryCodes();
  await c.db
    .update(users)
    .set({
      totpSecret: seal(c, user.id, secret),
      totpPendingSecret: null,
      totpEnabledAt: new Date(),
      totpLastStep: step,
      totpRecoveryHashes: codes.map((x) => recoveryHash(c, x)),
    })
    .where(eq(users.id, user.id));
  await audit(c.db, { userId: user.id, entity: 'user', entityId: user.id, action: 'enable_2fa' });
  return codes;
}

/** A code from the app, or one of the recovery codes (which then stops working). */
export async function checkCode(c: Ctx, user: User, code: string): Promise<boolean> {
  if (!user.totpSecret) return false;
  const step = verifyTotp(unseal(c, user.id, user.totpSecret), code.trim(), { notAfter: user.totpLastStep });
  if (step !== null) {
    // Only a newer step moves the mark: two sign-ins racing can't both use one code.
    const [ok] = await c.db
      .update(users)
      .set({ totpLastStep: step })
      .where(and(eq(users.id, user.id), sql`coalesce(${users.totpLastStep}, -1) < ${step}`))
      .returning({ id: users.id });
    return Boolean(ok);
  }
  const hash = recoveryHash(c, code);
  if (!user.totpRecoveryHashes.includes(hash)) return false;
  const [used] = await c.db
    .update(users)
    .set({ totpRecoveryHashes: sql`array_remove(${users.totpRecoveryHashes}, ${hash})` })
    .where(and(eq(users.id, user.id), sql`${hash} = any(${users.totpRecoveryHashes})`))
    .returning({ id: users.id });
  if (used) await audit(c.db, { userId: user.id, entity: 'user', entityId: user.id, action: 'used_recovery_code' });
  return Boolean(used);
}

// --- "My account" -------------------------------------------------------------------------------------------
export async function status(db: Db, userId: string): Promise<TwoFactorStatus> {
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u) throw errors.notFound('המשתמש');
  return {
    enabled: Boolean(u.totpEnabledAt),
    enabledAt: u.totpEnabledAt?.toISOString() ?? null,
    recoveryCodesLeft: u.totpRecoveryHashes.length,
    required: (await getSecurity(db)).requireTwoFactor,
  };
}

export async function loadUser(db: Db, id: string): Promise<User> {
  const [u] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!u) throw errors.notFound('המשתמש');
  return u;
}

export async function disable(c: Ctx, staff: { id: string }, password: string, code: string) {
  if ((await getSecurity(c.db)).requireTwoFactor) throw new AppError(409, 'required', 'במערכת הזו אימות דו-שלבי חובה לכולם. אפשר לבקש ממנהל לאפס אותו (למשל בטלפון חדש).');
  const user = await loadUser(c.db, staff.id);
  if (!(await verifyPassword(user.passwordHash, password))) throw new AppError(400, 'bad_password', 'הסיסמה שגויה');
  if (!(await checkCode(c, user, code))) throw badCode();
  await c.db.update(users).set({ totpSecret: null, totpPendingSecret: null, totpEnabledAt: null, totpLastStep: null, totpRecoveryHashes: [] }).where(eq(users.id, staff.id));
  await audit(c.db, { userId: staff.id, entity: 'user', entityId: staff.id, action: 'disable_2fa' });
}

export async function newCodes(c: Ctx, staff: { id: string }, code: string): Promise<string[]> {
  const user = await loadUser(c.db, staff.id);
  if (!(await checkCode(c, user, code))) throw badCode();
  const codes = newRecoveryCodes();
  await c.db.update(users).set({ totpRecoveryHashes: codes.map((x) => recoveryHash(c, x)) }).where(eq(users.id, staff.id));
  await audit(c.db, { userId: staff.id, entity: 'user', entityId: staff.id, action: 'new_recovery_codes' });
  return codes;
}

/** A lost phone: an admin clears the setup and signs the person out; they set it up again at the next sign-in. */
export async function resetFor(c: Ctx, admin: { id: string }, userId: string) {
  const [row] = await c.db
    .update(users)
    .set({ totpSecret: null, totpPendingSecret: null, totpEnabledAt: null, totpLastStep: null, totpRecoveryHashes: [] })
    .where(eq(users.id, userId))
    .returning({ id: users.id });
  if (!row) throw errors.notFound('המשתמש');
  await c.db.delete(sessions).where(eq(sessions.userId, userId));
  await audit(c.db, { userId: admin.id, entity: 'user', entityId: userId, action: 'reset_2fa' });
}
