// "Test connection" buttons: one cheap, read-only call per service, with a
// message an editor can act on. Never echoes a key back.
import Anthropic from '@anthropic-ai/sdk';
import type { ConnectionTest, IntegrationId } from '@b4/shared';
import nodemailer from 'nodemailer';
import type { Services } from './context';

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
      const r = await getJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(v.imageModel!)}`, { headers: { 'x-goog-api-key': v.apiKey } });
      if (r.status === 200) return ok(`מחובר. המודל ${r.body.displayName ?? v.imageModel} זמין.`);
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

export async function testSocialAccount(s: Services, account: { id: string; platform: string; externalId: string; secretRef: string }): Promise<ConnectionTest> {
  const token = await s.settings.socialToken(account);
  if (!token) return fail('לא הוזן טוקן לחשבון הזה.');
  const graph = `https://graph.facebook.com/${s.config.metaGraphVersion}`;
  try {
    switch (account.platform) {
      case 'telegram': {
        const r = await getJson(`https://api.telegram.org/bot${token}/getChat?chat_id=${encodeURIComponent(account.externalId)}`);
        if (r.body.ok) return ok(`מחובר לערוץ "${r.body.result?.title ?? account.externalId}". ודאו שהבוט מוגדר כמנהל בערוץ.`);
        return fail(r.status === 401 ? 'טוקן הבוט לא תקין.' : `טלגרם: ${r.body.description ?? 'הערוץ לא נמצא או שהבוט לא חבר בו.'}`);
      }
      case 'facebook':
      case 'instagram': {
        const fields = account.platform === 'facebook' ? 'name' : 'username';
        const r = await getJson(`${graph}/${encodeURIComponent(account.externalId)}?fields=${fields}&access_token=${encodeURIComponent(token)}`);
        if (r.status === 200) return ok(`מחובר ל-${r.body[fields] ?? account.externalId}.`);
        return fail(`Meta: ${r.body.error?.message ?? `שגיאה ${r.status}`}`);
      }
      default:
        return ok('הטוקן נשמר. לפלטפורמה הזו אין בדיקה אוטומטית; הפוסטים יוכנו לפרסום ידני.');
    }
  } catch (e) {
    return fail(`החיבור נכשל: ${e instanceof Error ? e.message.slice(0, 200) : 'שגיאה לא ידועה'}`);
  }
}
