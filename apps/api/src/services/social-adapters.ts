// Posting to the networks. Each adapter gets a ready payload; the link always
// goes in the first comment where the platform has comments (FB, IG, X).
// Accounts without a server-side token are "prepared": the payload is stored
// for manual posting and nothing is sent.
import type { SocialPlatform } from '@b4/shared';
import type { Config } from '../config';

export type SocialPayload = {
  headline: string;
  caption: string;
  articleUrl: string;
  /** Vertical story rendition (1080x1920 JPEG) */
  storyImageUrl: string;
  /** Square feed rendition (1080x1080 JPEG) */
  squareImageUrl: string;
  linkInFirstComment: boolean;
};

export type PostResult = { status: 'posted'; postId: string; commentId: string | null } | { status: 'prepared'; reason: string };

export type SocialAccountRef = { platform: SocialPlatform; externalId: string; secretRef: string };

/** The text that goes in the post body. */
export function postText(p: SocialPayload): string {
  const body = `${p.headline}\n\n${p.caption}`;
  return p.linkInFirstComment ? body : `${body}\n\n${p.articleUrl}`;
}

async function call<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string }; description?: string; ok?: boolean };
  if (!res.ok || body.ok === false) throw new Error(body.error?.message ?? body.description ?? `HTTP ${res.status}`);
  return body;
}

const form = (fields: Record<string, string>) => new URLSearchParams(fields);

async function telegram(token: string, chatId: string, p: SocialPayload): Promise<PostResult> {
  const r = await call<{ result: { message_id: number } }>(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method: 'POST',
    body: form({ chat_id: chatId, photo: p.squareImageUrl, caption: postText(p).slice(0, 1024) }),
  });
  return { status: 'posted', postId: String(r.result.message_id), commentId: null };
}

async function facebook(graph: string, token: string, pageId: string, p: SocialPayload): Promise<PostResult> {
  const post = await call<{ id: string; post_id?: string }>(`${graph}/${encodeURIComponent(pageId)}/photos`, {
    method: 'POST',
    body: form({ url: p.squareImageUrl, caption: postText(p), access_token: token }),
  });
  const postId = post.post_id ?? post.id;
  const comment = await call<{ id: string }>(`${graph}/${encodeURIComponent(postId)}/comments`, {
    method: 'POST',
    body: form({ message: p.articleUrl, access_token: token }),
  });
  return { status: 'posted', postId, commentId: comment.id };
}

async function instagram(graph: string, token: string, igUserId: string, p: SocialPayload): Promise<PostResult> {
  const container = await call<{ id: string }>(`${graph}/${encodeURIComponent(igUserId)}/media`, {
    method: 'POST',
    body: form({ image_url: p.squareImageUrl, caption: postText(p), access_token: token }),
  });
  const media = await call<{ id: string }>(`${graph}/${encodeURIComponent(igUserId)}/media_publish`, {
    method: 'POST',
    body: form({ creation_id: container.id, access_token: token }),
  });
  const comment = await call<{ id: string }>(`${graph}/${encodeURIComponent(media.id)}/comments`, {
    method: 'POST',
    body: form({ message: p.articleUrl, access_token: token }),
  });
  return { status: 'posted', postId: media.id, commentId: comment.id };
}

export async function publishToNetwork(config: Config, account: SocialAccountRef, payload: SocialPayload): Promise<PostResult> {
  const token = config.socialSecret(account.secretRef);
  if (!token) return { status: 'prepared', reason: 'החשבון לא מחובר (אין טוקן בשרת). הפוסט הוכן לפרסום ידני.' };
  const graph = `https://graph.facebook.com/${config.metaGraphVersion}`;
  switch (account.platform) {
    case 'telegram':
      return telegram(token, account.externalId, payload);
    case 'facebook':
      return facebook(graph, token, account.externalId, payload);
    case 'instagram':
      return instagram(graph, token, account.externalId, payload);
    default:
      // WhatsApp channels have no posting API; X and TikTok need app review. Prepared for manual posting.
      return { status: 'prepared', reason: 'פרסום אוטומטי לפלטפורמה הזו עוד לא מחובר. הפוסט הוכן לפרסום ידני.' };
  }
}
