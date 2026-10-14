// Finishing a reader's sign-in, by the mailed code or by the one-click link in the same mail:
// the account is made on the first sign-in (a display name is needed), the current terms are
// accepted and recorded, banned readers are refused. The code or link is used up only once
// every check passed, so "choose a name" doesn't cost the reader a new code.
import type { ReaderDto } from '@b4/shared';
import { eq, readers } from '@b4/db';
import { AppError, errors } from '../errors';
import type { Mail } from '../lib/mailer';
import { recordConsent } from './consent';
import type { Services } from './context';
import { legalVersion } from './site-settings';

export function readerDto(r: { id: string; email: string; displayName: string; termsVersion: string | null }, version: string): ReaderDto {
  return { id: r.id, email: r.email, displayName: r.displayName, termsAccepted: r.termsVersion === version };
}

export async function completeSignIn(
  s: Services,
  input: { email: string; displayName?: string; acceptTerms: boolean; channel: 'web' | 'app'; ip: string; userAgent?: string; consume: () => Promise<unknown> },
): Promise<{ readerId: string; reader: ReaderDto }> {
  let [reader] = await s.db.select().from(readers).where(eq(readers.email, input.email)).limit(1);
  // The code (or link) is right but this is a first sign-in: ask for a display name, keep it valid.
  if (!reader && !input.displayName) throw new AppError(409, 'name_required', 'נשאר רק לבחור שם שיופיע ליד התגובות שלך');
  // New readers, and readers who accepted an older version, accept the current terms.
  const version = await legalVersion(s);
  const accepting = !reader || reader.termsVersion !== version;
  if (accepting && !input.acceptTerms) throw errors.termsRequired();
  await input.consume();

  if (!reader) [reader] = await s.db.insert(readers).values({ email: input.email, displayName: input.displayName! }).returning();
  if (!reader) throw new Error('reader insert failed');
  if (reader.status === 'banned') throw errors.banned();
  const now = new Date();
  await s.db
    .update(readers)
    .set({ lastLoginAt: now, ...(accepting ? { termsVersion: version, termsAcceptedAt: now } : {}) })
    .where(eq(readers.id, reader.id));
  if (accepting) {
    await recordConsent(s.db, s.config.hashPepper, {
      subject: 'reader',
      readerId: reader.id,
      termsVersion: version,
      channel: input.channel,
      ip: input.ip,
      userAgent: input.userAgent,
    });
  }
  return { readerId: reader.id, reader: readerDto({ ...reader, termsVersion: accepting ? version : reader.termsVersion }, version) };
}

/** The sign-in mail: one button that signs in, and the code for another device or the app. */
export function signInMail(to: string, code: string, link: string): Mail {
  const text = [
    `להתחברות בלחיצה אחת:\n${link}`,
    `או הקלידו את הקוד: ${code}`,
    'הקישור והקוד בתוקף ל-10 דקות ולשימוש אחד. באפליקציה מקלידים את הקוד.',
    'אם לא ביקשת להתחבר, אפשר להתעלם מההודעה.',
  ].join('\n\n');
  const html = `<!doctype html><html lang="he" dir="rtl"><body style="margin:0;background:#f4f1ec;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a">
<div style="max-width:480px;margin:0 auto;padding:32px 24px;text-align:right">
<p style="font-size:22px;font-weight:bold;margin:0 0 16px">B4 NEW'S</p>
<p style="font-size:16px;margin:0 0 24px">לחצו כדי להתחבר:</p>
<p style="margin:0 0 28px"><a href="${link}" style="display:inline-block;background:#c8102e;color:#ffffff;text-decoration:none;font-weight:bold;font-size:17px;padding:14px 28px;border-radius:999px">התחברות בלחיצה</a></p>
<p style="font-size:15px;margin:0 0 8px">או הקלידו את הקוד:</p>
<p dir="ltr" style="font-size:30px;font-weight:bold;letter-spacing:6px;margin:0 0 28px;text-align:right">${code}</p>
<p style="font-size:13px;color:#666;margin:0">הקישור והקוד בתוקף ל-10 דקות ולשימוש אחד. באפליקציה מקלידים את הקוד. אם לא ביקשת להתחבר, אפשר להתעלם מההודעה.</p>
</div></body></html>`;
  return { to, subject: `הקוד שלך ל-B4 NEW'S: ${code}`, text, html };
}
