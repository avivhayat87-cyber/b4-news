// Evidence that someone accepted the terms: who (a reader, a newsletter subscriber or an
// anonymous visitor), which version, when, and from where (IP kept only as a keyed hash).
import { type Db, consents } from '@b4/db';
import { keyedHash } from '../lib/crypto';

export type ConsentEntry = {
  subject: 'reader' | 'subscriber' | 'visitor';
  readerId?: string;
  subscriberId?: string;
  visitorId?: string;
  termsVersion: string;
  ads?: boolean | null;
  channel: 'web' | 'app';
  ip?: string;
  userAgent?: string;
};

export async function recordConsent(db: Db, pepper: string, e: ConsentEntry): Promise<void> {
  await db.insert(consents).values({
    subject: e.subject,
    readerId: e.readerId ?? null,
    subscriberId: e.subscriberId ?? null,
    visitorId: e.visitorId ?? null,
    termsVersion: e.termsVersion,
    ads: e.ads ?? null,
    channel: e.channel,
    ipHash: e.ip ? keyedHash(pepper, 'ip', e.ip) : null,
    userAgent: e.userAgent?.slice(0, 300) ?? null,
  });
}
