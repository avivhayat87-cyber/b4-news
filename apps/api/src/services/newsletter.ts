// Newsletter messages. Every message carries a one-click unsubscribe link (in the
// text and as List-Unsubscribe headers) and the sender's details, and a message
// that contains an ad is labelled "פרסומת" (Communications Law, section 30A).
import type { Config } from '../config';
import { keyedHash, safeEqualHex } from '../lib/crypto';
import type { Mail } from '../lib/mailer';
import type { Services } from './context';
import { getSite } from './site-settings';

export function unsubscribeToken(config: Config, subscriberId: string): string {
  return keyedHash(config.hashPepper, 'newsletter-unsubscribe', subscriberId);
}

export function validUnsubscribeToken(config: Config, subscriberId: string, token: string): boolean {
  return safeEqualHex(unsubscribeToken(config, subscriberId), token);
}

export function unsubscribeLinks(config: Config, subscriberId: string): { page: string; oneClick: string } {
  const token = unsubscribeToken(config, subscriberId);
  return {
    page: `${config.publicSiteUrl}/newsletter/unsubscribe?id=${subscriberId}&token=${token}`,
    oneClick: `${config.publicApiUrl}/api/v1/public/newsletter/unsubscribe/${subscriberId}/${token}`,
  };
}

export async function newsletterMail(
  s: Services,
  msg: { to: string; subscriberId: string; subject: string; text: string; containsAds: boolean },
): Promise<Mail> {
  const site = await getSite(s);
  const links = unsubscribeLinks(s.config, msg.subscriberId);
  const sender = [site.company.name || "B4 NEW'S", site.company.address, site.company.privacyEmail || site.contact.email].filter(Boolean).join(' · ');
  return {
    to: msg.to,
    subject: msg.containsAds ? `פרסומת: ${msg.subject}` : msg.subject,
    text: `${msg.containsAds ? 'פרסומת\n\n' : ''}${msg.text}\n\n---\nנשלח אליך כי נרשמת לניוזלטר של B4 NEW'S.\nלהסרה מרשימת התפוצה בלחיצה אחת: ${links.page}\n${sender}`,
    headers: { 'List-Unsubscribe': `<${links.oneClick}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
  };
}
