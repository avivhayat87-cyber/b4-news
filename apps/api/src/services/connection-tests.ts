// "Test connection" buttons: one cheap, read-only call per service, with a
// message an editor can act on. Never echoes a key back.
import Anthropic from '@anthropic-ai/sdk';
import type { ConnectionTest, IntegrationId } from '@b4/shared';
import nodemailer from 'nodemailer';
import type { Services } from './context';
import { LOCAL_MEDIA_ERROR, publiclyReachable } from './social-adapters';

const ok = (message: string): ConnectionTest => ({ ok: true, message });
const fail = (message: string): ConnectionTest => ({ ok: false, message });

async function getJson(url: string, init?: RequestInit): Promise<{ status: number; body: Record<string, any> }> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> };
}

export async function testIntegration(s: Services, id: IntegrationId): Promise<ConnectionTest> {
  const v = await s.settings.integration(id);
  try {
    if (id === 'anthropic') {
      if (!v.apiKey) return fail('לא הוזן מפתח.');
      const client = new Anthropic({ apiKey: v.apiKey, maxRetries: 0, timeout: 15_000 });
      try {
        const model = await client.models.retrieve(v.model!);
        return ok(`מחובר. המודל ${model.display_name ?? model.id} זמין.`);
      } catch (e) {
        const status = (e as { status?: number }).status;
        if (status === 401) return fail('המפתח לא תקין או בוטל.');
        if (status === 404) return fail(`המפתח תקין, אבל המודל "${v.model}" לא זמין בו. בדקו את שם המודל.`);
        throw e;
      }
    }
    if (id === 'gemini') {
      if (!v.apiKey) return fail('לא הוזן מפתח.');
      const model = (name: string) => getJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(name)}`, { headers: { 'x-goog-api-key': v.apiKey! } });
      const r = await model(v.imageModel!);
      if (r.status === 200) {
        if (v.previewModel === v.imageModel) return ok(`מחובר. המודל ${r.body.displayName ?? v.imageModel} זמין.`);
        const p = await model(v.previewModel!);
        if (p.status === 200) return ok(`מחובר. זמינים: ${p.body.displayName ?? v.previewModel} לטיוטות, ${r.body.displayName ?? v.imageModel} לתמונה הסופית.`);
        if (p.status === 404) return fail(`המפתח תקין, אבל מודל הטיוטות "${v.previewModel}" לא זמין בו. בדקו את שם המודל.`);
        return fail(`Gemini החזיר שגיאה (${p.status}) על מודל הטיוטות.`);
      }
      if (r.status === 404) return fail(`המפתח תקין, אבל המודל "${v.imageModel}" לא זמין בו. בדקו את שם המודל.`);
      // Google answers a bad key with 400, and a key it won't accept (e.g. unrestricted) with 401/403; its message says which.
      const reason = typeof r.body.error?.message === 'string' ? ` Google: ${r.body.error.message.slice(0, 200)}` : '';
      if (JSON.stringify(r.body.error ?? {}).includes('API_KEY_INVALID')) return fail('המפתח לא תקין או בוטל.');
      if (r.status === 400 || r.status === 401 || r.status === 403) return fail(`המפתח לא התקבל.${reason}`);
      return fail(`Gemini החזיר שגיאה (${r.status}).${reason}`);
    }
    if (!v.url) return fail('לא הוזנה כתובת SMTP.');
    await nodemailer.createTransport(v.url).verify();
    return ok('שרת הדואר מחובר ומקבל הודעות.');
  } catch (e) {
    return fail(`החיבור נכשל: ${e instanceof Error ? e.message.slice(0, 200) : 'שגיאה לא ידועה'}`);
  }
}

const PAGE_TOKEN_HOW = 'מוציאים טוקן עמוד ב-Graph API Explorer: מריצים me/accounts?fields=id,name,access_token ומעתיקים את ה-access_token שליד העמוד.';

/**
 * Facebook and Instagram post with the Page's own token. A personal token reads the page
 * fine but can't publish as it, and the Explorer's one expires within hours, so both are
 * refused here rather than shown as connected. Instagram must be the account linked to that page.
 */
async function testMeta(graph: string, token: string, platform: 'facebook' | 'instagram', externalId: string): Promise<ConnectionTest> {
  const get = (path: string) => getJson(`${graph}/${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`);
  const me = await get(`me?fields=id,name${platform === 'instagram' ? ',instagram_business_account' : ''}`);
  if (me.status !== 200) {
    const err = (me.body.error ?? {}) as { code?: number; message?: string };
    if (err.code === 190) return fail(`הטוקן פג תוקף או בוטל (כנראה טוקן אישי זמני). ${PAGE_TOKEN_HOW}`);
    // A personal token has no instagram_business_account: Meta answers that the field doesn't exist on a User.
    if (/node type \(User\)/.test(err.message ?? '')) return fail(`זה טוקן אישי ולא טוקן של העמוד: הוא לא יכול לפרסם בשם העמוד, ופג תוקף תוך שעות. ${PAGE_TOKEN_HOW}`);
    return fail(`Meta: ${err.message ?? `שגיאה ${me.status}`}`);
  }
  const name = String(me.body.name ?? '');
  if (platform === 'facebook') {
    if (String(me.body.id) !== externalId) {
      return fail(`הטוקן שייך ל-"${name}" (${me.body.id}) ולא לעמוד ${externalId}. אם זה השם שלך, זה טוקן אישי ולא טוקן העמוד. ${PAGE_TOKEN_HOW}`);
    }
    return ok(`מחובר לעמוד "${name}".`);
  }
  const ig = me.body.instagram_business_account?.id ? String(me.body.instagram_business_account.id) : null;
  if (!ig) return fail(`לעמוד "${name}" אין חשבון אינסטגרם מקצועי מקושר. מקשרים אותו בהגדרות העמוד (חשבונות מקושרים), ומוציאים טוקן עמוד חדש.`);
  if (ig !== externalId) return fail(`העמוד "${name}" מקושר לחשבון האינסטגרם ${ig}, ולא למזהה ${externalId}. לחצו "שינוי מזהה" והזינו ${ig}.`);
  const user = await get(`${encodeURIComponent(ig)}?fields=username`);
  if (user.status !== 200) return fail(`Meta: ${user.body.error?.message ?? `שגיאה ${user.status}`}`);
  return ok(`מחובר לאינסטגרם @${user.body.username} (דרך העמוד "${name}").`);
}

export async function testSocialAccount(s: Services, account: { id: string; platform: string; externalId: string; secretRef: string }): Promise<ConnectionTest> {
  const token = await s.settings.socialToken(account);
  if (!token) return fail('לא הוזן טוקן לחשבון הזה.');
  const graph = `https://graph.facebook.com/${s.config.metaGraphVersion}`;
  let result: ConnectionTest;
  try {
    switch (account.platform) {
      case 'telegram': {
        const r = await getJson(`https://api.telegram.org/bot${token}/getChat?chat_id=${encodeURIComponent(account.externalId)}`);
        if (r.body.ok) result = ok(`מחובר לערוץ "${r.body.result?.title ?? account.externalId}". ודאו שהבוט מוגדר כמנהל בערוץ.`);
        else return fail(r.status === 401 ? 'טוקן הבוט לא תקין.' : `טלגרם: ${r.body.description ?? 'הערוץ לא נמצא או שהבוט לא חבר בו.'}`);
        break;
      }
      case 'facebook':
      case 'instagram':
        result = await testMeta(graph, token, account.platform, account.externalId);
        if (!result.ok) return result;
        break;
      default:
        return ok('הטוקן נשמר. לפלטפורמה הזו אין בדיקה אוטומטית; הפוסטים יוכנו לפרסום ידני.');
    }
  } catch (e) {
    return fail(`החיבור נכשל: ${e instanceof Error ? e.message.slice(0, 200) : 'שגיאה לא ידועה'}`);
  }
  // Connected; what still can't work while the system runs on a local computer.
  const notes = [
    account.platform === 'instagram' && !publiclyReachable(s.config.mediaBaseUrl) ? LOCAL_MEDIA_ERROR : null,
    !publiclyReachable(s.config.publicSiteUrl) ? `הקישור לכתבה בפוסטים יהיה כתובת מקומית (${s.config.publicSiteUrl}) שקוראים לא יוכלו לפתוח, עד שהאתר יעלה לשרת עם דומיין.` : null,
  ].filter(Boolean);
  return notes.length ? ok(`${result.message} שימו לב: ${notes.join(' ')}`) : result;
}
