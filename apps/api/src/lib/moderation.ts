// Automatic first-pass moderation for reader comments. Anything uncertain is
// held for a human ("review") rather than rejected.
import { COMMENT_LIMITS } from '@b4/shared';
import { FLAGGED_TERMS } from './moderation-terms';

export type ModerationResult =
  | { decision: 'publish'; body: string }
  | { decision: 'review'; body: string; reason: string }
  | { decision: 'reject'; code: string; message: string };

const URL_PATTERN = /\b(?:https?:\/\/|www\.)\S+/giu;

/** Plain text only: strip control characters, normalize, cap blank lines. */
export function normalizeCommentText(input: string): string {
  return input
    .normalize('NFC')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‍⁠﻿]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function containsFlaggedTerm(text: string): string | undefined {
  const lower = text.toLowerCase();
  return FLAGGED_TERMS.find((term) => {
    const pattern = new RegExp(`(^|[^\\p{L}])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'u');
    return pattern.test(lower);
  });
}

export function moderateComment(raw: string): ModerationResult {
  const body = normalizeCommentText(raw);
  if (body.length < COMMENT_LIMITS.minLength) {
    return { decision: 'reject', code: 'too_short', message: 'התגובה קצרה מדי' };
  }
  if (body.length > COMMENT_LIMITS.maxLength) {
    return { decision: 'reject', code: 'too_long', message: `התגובה ארוכה מדי (עד ${COMMENT_LIMITS.maxLength} תווים)` };
  }
  const links = body.match(URL_PATTERN)?.length ?? 0;
  if (links > COMMENT_LIMITS.maxLinks) {
    return { decision: 'reject', code: 'too_many_links', message: `אפשר לצרף עד ${COMMENT_LIMITS.maxLinks} קישורים בתגובה` };
  }
  if (/(.)\1{14,}/u.test(body)) {
    return { decision: 'reject', code: 'spam', message: 'התגובה נראית כמו ספאם' };
  }
  const flagged = containsFlaggedTerm(body);
  if (flagged) return { decision: 'review', body, reason: `auto: flagged term` };
  if (links > 0) return { decision: 'review', body, reason: 'auto: contains a link' };
  return { decision: 'publish', body };
}
