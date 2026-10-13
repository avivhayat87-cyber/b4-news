// The social accounts the newsroom publishes to: one per network, so there is
// never a doubt where a post goes. An account can be switched off, have its ID
// corrected, or be deleted; deleting removes its token and its posts (the
// foreign keys cascade), and using the network again means adding it anew.
import { type CreateSocialAccountInput, LINK_IN_FIRST_COMMENT, type SocialAccountDto, type SocialPlatform, type UpdateSocialAccountInput, socialAccountIdProblem } from '@b4/shared';
import { and, asc, eq, socialAccounts } from '@b4/db';
import type { z } from 'zod';
import { AppError, errors } from '../errors';
import { audit } from '../lib/audit';
import type { Services } from './context';
import { secretKey } from './settings';

type Staff = { id: string };
export type AccountRow = typeof socialAccounts.$inferSelect;

const NETWORK: Record<SocialPlatform, string> = {
  facebook: 'פייסבוק',
  instagram: 'אינסטגרם',
  telegram: 'טלגרם',
  whatsapp: 'וואטסאפ',
  x: 'X',
  tiktok: 'טיקטוק',
};

export async function accountDto(s: Services, a: AccountRow): Promise<SocialAccountDto> {
  return {
    id: a.id,
    platform: a.platform,
    displayName: a.displayName,
    externalId: a.externalId,
    linkInFirstComment: a.linkInFirstComment,
    isActive: a.isActive,
    connected: Boolean(await s.settings.socialToken(a)),
  };
}

export async function listAccounts(s: Services): Promise<SocialAccountDto[]> {
  const rows = await s.db.select().from(socialAccounts).orderBy(asc(socialAccounts.platform), asc(socialAccounts.createdAt));
  return Promise.all(rows.map((a) => accountDto(s, a)));
}

export async function loadAccount(s: Services, id: string): Promise<AccountRow> {
  const [row] = await s.db.select().from(socialAccounts).where(eq(socialAccounts.id, id)).limit(1);
  if (!row) throw errors.notFound('החשבון');
  return row;
}

export async function createAccount(s: Services, staff: Staff, input: z.infer<typeof CreateSocialAccountInput>): Promise<SocialAccountDto> {
  const [existing] = await s.db.select({ id: socialAccounts.id }).from(socialAccounts).where(eq(socialAccounts.platform, input.platform)).limit(1);
  if (existing) {
    throw new AppError(409, 'network_taken', `כבר יש חשבון ${NETWORK[input.platform]}. אפשר לשנות לו את המזהה, או למחוק אותו ולהוסיף חשבון חדש.`);
  }
  const [row] = await s.db
    .insert(socialAccounts)
    .values({ ...input, linkInFirstComment: LINK_IN_FIRST_COMMENT[input.platform] })
    .onConflictDoNothing()
    .returning();
  if (!row) throw new AppError(409, 'duplicate', 'החשבון הזה כבר קיים.');
  await audit(s.db, { userId: staff.id, entity: 'social_account', entityId: row.id, action: 'create', details: { platform: row.platform } });
  return accountDto(s, row);
}

/** Switch an account on or off, or correct its ID; the token stays. */
export async function updateAccount(s: Services, staff: Staff, id: string, input: z.infer<typeof UpdateSocialAccountInput>): Promise<SocialAccountDto> {
  const current = await loadAccount(s, id);
  const changesId = input.externalId !== undefined && input.externalId !== current.externalId;
  if (changesId) {
    const problem = socialAccountIdProblem(current.platform, input.externalId!);
    if (problem) throw new AppError(422, 'bad_external_id', problem);
    const [taken] = await s.db
      .select({ id: socialAccounts.id })
      .from(socialAccounts)
      .where(and(eq(socialAccounts.platform, current.platform), eq(socialAccounts.externalId, input.externalId!)))
      .limit(1);
    if (taken) throw new AppError(409, 'duplicate', 'חשבון עם המזהה הזה כבר קיים. מחקו אחד מהשניים.');
  }
  const [row] = await s.db
    .update(socialAccounts)
    .set({ ...(input.isActive !== undefined ? { isActive: input.isActive } : {}), ...(changesId ? { externalId: input.externalId } : {}) })
    .where(eq(socialAccounts.id, current.id))
    .returning();
  await audit(s.db, {
    userId: staff.id,
    entity: 'social_account',
    entityId: current.id,
    action: changesId ? 'change_id' : row!.isActive ? 'enable' : 'disable',
    details: changesId ? { from: current.externalId, to: input.externalId } : undefined,
  });
  return accountDto(s, row!);
}

export async function setAccountToken(s: Services, staff: Staff, id: string, token: string | null): Promise<SocialAccountDto> {
  const account = await loadAccount(s, id);
  await s.settings.setSecret(secretKey.socialToken(account.id), token, staff.id);
  await audit(s.db, { userId: staff.id, entity: 'social_account', entityId: account.id, action: token ? 'set_token' : 'remove_token' });
  return accountDto(s, account);
}

/** Deletes the account for good: its posts go with it (cascade), nothing more is sent to it, and its token is erased. */
export async function deleteAccount(s: Services, staff: Staff, id: string): Promise<void> {
  const account = await loadAccount(s, id);
  await s.db.delete(socialAccounts).where(eq(socialAccounts.id, account.id));
  await s.settings.setSecret(secretKey.socialToken(account.id), null, staff.id);
  await audit(s.db, { userId: staff.id, entity: 'social_account', entityId: account.id, action: 'delete', details: { platform: account.platform, externalId: account.externalId } });
}
