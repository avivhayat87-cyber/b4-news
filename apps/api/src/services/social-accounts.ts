// The social accounts the newsroom publishes to: one per network, so there is
// never a doubt where a post goes. An account can be switched off, have its ID
// corrected, or be deleted; deleting removes its token and its posts (the
// foreign keys cascade), and using the network again means adding it anew.
// Facebook and Instagram keep the page's own token, made here from the personal one pasted.
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
  // Facebook and Instagram keep the page's own token, made from the personal one when that is what was pasted.
  const meta = token && (account.platform === 'facebook' || account.platform === 'instagram') ? await metaPageToken(s, account, token) : null;
  await s.settings.setSecret(secretKey.socialToken(account.id), meta?.token ?? token, staff.id);
  await audit(s.db, {
    userId: staff.id,
    entity: 'social_account',
    entityId: account.id,
    action: token ? 'set_token' : 'remove_token',
    details: meta?.exchanged ? { madeFrom: 'personal_token' } : undefined,
  });
  return accountDto(s, account);
}

/** Deletes the account for good: its posts go with it (cascade), nothing more is sent to it, and its token is erased. */
export async function deleteAccount(s: Services, staff: Staff, id: string): Promise<void> {
  const account = await loadAccount(s, id);
  await s.db.delete(socialAccounts).where(eq(socialAccounts.id, account.id));
  await s.settings.setSecret(secretKey.socialToken(account.id), null, staff.id);
  await audit(s.db, { userId: staff.id, entity: 'social_account', entityId: account.id, action: 'delete', details: { platform: account.platform, externalId: account.externalId } });
}

// --- Facebook and Instagram tokens -------------------------------------------------------
// Posting needs the page's own token, and the one that never expires takes several steps in
// Meta's tools that are easy to get wrong (the Explorer's own page picker gives one that lasts
// an hour). So the editor pastes their personal token and the server does the rest. Tokens
// travel only to graph.facebook.com and are never logged or returned.

/** How to get the token to paste; ends every message that asks for a new one. */
export const META_TOKEN_HOW =
  'כדי לחבר: ב-Graph API Explorer בוחרים את האפליקציה של האתר (B4 NEWS Publisher), וב-"User or Page" את User Token (לא את העמוד). לוחצים Generate Access Token, מאשרים את ההרשאות, ומדביקים בשדה הטוקן את מה שבשדה Access Token. המערכת הופכת אותו לטוקן הקבוע של העמוד.';

const META_APP_MISSING =
  'חסר סוד האפליקציה של Meta: מזינים אותו פעם אחת בכרטיס "Meta: פייסבוק ואינסטגרם" שלמעלה. בעזרתו המערכת בודקת את הטוקן והופכת אותו לטוקן הקבוע של העמוד.';

/** A personal token from the Explorer lasts an hour or two; an extended one, about 60 days. */
const LONG_LIVED_S = 24 * 3600;

type GraphAnswer = { status: number; body: Record<string, any> };

/** A GET to Meta's Graph API. The token rides in the query, as Meta documents; these URLs are never logged. */
async function graphGet(s: Services, path: string, params: Record<string, string>): Promise<GraphAnswer> {
  let res: Response;
  try {
    res = await fetch(`https://graph.facebook.com/${s.config.metaGraphVersion}/${path}?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new AppError(502, 'meta_unreachable', 'לא הצלחנו להגיע ל-Meta. נסו שוב בעוד רגע.');
  }
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> };
}

const metaError = (r: GraphAnswer) => String(r.body.error?.message ?? `שגיאה ${r.status}`).slice(0, 200).replace(/\.$/, '');

/** The app the posts go out through, once its secret was entered (CMS > settings > connections). */
async function metaApp(s: Services): Promise<{ id: string; secret: string } | null> {
  const v = await s.settings.integration('meta');
  return v.appId && v.appSecret ? { id: v.appId, secret: v.appSecret } : null;
}

export type MetaTokenInfo = {
  /** USER: a person's token (what the Explorer gives); PAGE: the page's own. */
  type: string;
  /** Unix seconds; 0 = never. */
  expiresAt: number;
  /** When Meta stops the token's access to the data until someone approves it again (unix seconds; 0 = never). */
  dataAccessExpiresAt: number;
};

/**
 * What Meta says about a token (debug_token): whose it is and when it stops working. Asked with
 * the app's own key when its secret is set; otherwise with the token itself, which Meta answers
 * for the app developer's personal token but not for a page's. A Hebrew problem when Meta can't say.
 */
export async function inspectMetaToken(s: Services, token: string): Promise<{ info: MetaTokenInfo } | { problem: string }> {
  const app = await metaApp(s);
  const r = await graphGet(s, 'debug_token', { input_token: token, access_token: app ? `${app.id}|${app.secret}` : token });
  const data = r.body.data as Record<string, any> | undefined;
  const otherApp = `הטוקן נוצר באפליקציה אחרת ולא באפליקציה של האתר. ${META_TOKEN_HOW}`;
  if (r.status === 200 && data) {
    if (!data.is_valid) return { problem: `הטוקן פג תוקף או בוטל. ${META_TOKEN_HOW}` };
    if (app && data.app_id && String(data.app_id) !== app.id) return { problem: otherApp };
    return { info: { type: String(data.type ?? ''), expiresAt: Number(data.expires_at ?? 0), dataAccessExpiresAt: Number(data.data_access_expires_at ?? 0) } };
  }
  if (/did not match/i.test(metaError(r))) return { problem: otherApp };
  if (app) return { problem: `Meta לא בדק את הטוקן: ${metaError(r)}. אם השגיאה על האפליקציה, בדקו את המזהה והסוד בכרטיס "Meta: פייסבוק ואינסטגרם".` };
  if (r.body.error?.code === 190) return { problem: `הטוקן פג תוקף או בוטל. ${META_TOKEN_HOW}` };
  return { problem: META_APP_MISSING };
}

const israelTime = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Why a page token will stop working (a sentence, without the how-to), or null when it never expires. */
export function metaExpiryProblem(info: MetaTokenInfo, now = Date.now()): string | null {
  if (info.expiresAt) return `זה טוקן זמני: ${info.expiresAt * 1000 <= now ? 'הוא כבר פג' : `הוא יפוג ב-${israelTime.format(new Date(info.expiresAt * 1000))}`}, ואז הפרסום ייעצר.`;
  if (info.dataAccessExpiresAt && info.dataAccessExpiresAt * 1000 <= now) return 'Meta עצר את הגישה של הטוקן, וצריך לאשר אותה מחדש.';
  return null;
}

type MetaPage = { id: string; name?: string; access_token?: string; instagram_business_account?: { id: string } };

const linkedInstagram = (p: MetaPage) => (p.instagram_business_account?.id ? String(p.instagram_business_account.id) : null);

/** What to do when the personal token doesn't reach the account's page, naming what it does reach. */
function pageNotFound(account: AccountRow, pages: MetaPage[]): string {
  const approve = 'ב-Graph API Explorer מאשרים מחדש את ההרשאות, ובחלון של פייסבוק בוחרים גם את העמוד ואת חשבון האינסטגרם.';
  if (!pages.length) return `הטוקן לא נותן גישה לאף עמוד. ${approve}`;
  if (account.platform === 'facebook') {
    const seen = pages.map((p) => `"${p.name ?? p.id}" (${p.id})`).join(', ');
    return `הטוקן לא נותן גישה לעמוד ${account.externalId}. העמודים שהוא כן רואה: ${seen}. אם אחד מהם הוא העמוד, לחצו "שינוי מזהה" והזינו את המספר שלו. אחרת, ${approve}`;
  }
  const linked = pages.filter(linkedInstagram);
  if (!linked.length) return `לאף עמוד שהטוקן רואה אין חשבון אינסטגרם מקושר. מקשרים את האינסטגרם לעמוד בהגדרות העמוד (חשבונות מקושרים), ואז ${approve}`;
  const seen = linked.map((p) => `העמוד "${p.name ?? p.id}" מקושר לאינסטגרם ${linkedInstagram(p)}`).join('; ');
  return `אף עמוד שהטוקן רואה לא מקושר לחשבון האינסטגרם ${account.externalId}. ${seen}. אם זה החשבון, לחצו "שינוי מזהה" והזינו את המספר הזה.`;
}

/**
 * The token to keep for a Facebook or Instagram account: always the page's own. A personal token
 * is exchanged for a long-lived one (with the app's secret), and the page's token read with that
 * never expires; Instagram posts with the token of the page it is linked to. A page token pasted
 * as is is kept, unless it expires.
 */
async function metaPageToken(s: Services, account: AccountRow, pasted: string): Promise<{ token: string; exchanged: boolean }> {
  const seen = await inspectMetaToken(s, pasted);
  if ('problem' in seen) throw new AppError(422, 'meta_token', seen.problem);
  if (seen.info.type !== 'USER') {
    const expiry = metaExpiryProblem(seen.info);
    if (expiry) throw new AppError(422, 'meta_token_expires', `${expiry} לכן הוא לא נשמר. ${META_TOKEN_HOW}`);
    return { token: pasted, exchanged: false };
  }

  let personal = pasted;
  const app = await metaApp(s);
  if (app) {
    const long = await graphGet(s, 'oauth/access_token', { grant_type: 'fb_exchange_token', client_id: app.id, client_secret: app.secret, fb_exchange_token: pasted });
    if (long.status !== 200 || typeof long.body.access_token !== 'string') throw new AppError(422, 'meta_exchange', `Meta לא האריך את הטוקן: ${metaError(long)}`);
    personal = long.body.access_token;
  } else if (seen.info.expiresAt && seen.info.expiresAt - Date.now() / 1000 < LONG_LIVED_S) {
    // A short-lived personal token makes page tokens that die with it; only the app can extend it.
    throw new AppError(422, 'meta_app_missing', META_APP_MISSING);
  }

  const r = await graphGet(s, 'me/accounts', { fields: 'id,name,access_token,instagram_business_account', limit: '100', access_token: personal });
  if (r.status !== 200) throw new AppError(422, 'meta_pages', `Meta לא החזיר את העמודים של הטוקן: ${metaError(r)}`);
  const pages = (Array.isArray(r.body.data) ? r.body.data : []) as MetaPage[];
  const page = pages.find((p) => (account.platform === 'facebook' ? String(p.id) === account.externalId : linkedInstagram(p) === account.externalId));
  if (!page) throw new AppError(422, 'meta_page_not_found', pageNotFound(account, pages));
  if (!page.access_token) throw new AppError(422, 'meta_page_token', `Meta לא נתן טוקן לעמוד "${page.name ?? page.id}": צריך להיות מנהל של העמוד ולאשר את ההרשאה pages_show_list. ${META_TOKEN_HOW}`);
  return { token: page.access_token, exchanged: true };
}
