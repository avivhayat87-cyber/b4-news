// Posting to the networks: posts, stories and reels. Each adapter gets a ready
// payload; the link goes in the first comment where the platform has comments (FB, IG, X).
// Images and videos are uploaded as files, except Instagram images, which Instagram
// accepts only as a public link it downloads itself.
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
  /** The reel's video (MP4, 9:16), when one was made */
  videoUrl?: string;
  /** The reel's branded cover (9:16 JPEG with the headline), shown in the Instagram profile grid */
  coverUrl?: string;
  linkInFirstComment: boolean;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type PostResult = { status: 'posted'; postId: string; commentId: string | null } | { status: 'prepared'; reason: string };

export type SocialAccountRef = { platform: SocialPlatform; externalId: string; secretRef: string };

/** The text that goes in the post body. */
export function postText(p: SocialPayload): string {
  const body = `${p.headline}\n\n${p.caption}`;
  return p.linkInFirstComment ? body : `${body}\n\n${p.articleUrl}`;
}

async function call<T>(url: string, init: RequestInit, timeoutMs = 60_000): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string }; description?: string; ok?: boolean };
  if (!res.ok || body.ok === false) throw new Error(body.error?.message ?? body.description ?? `HTTP ${res.status}`);
  return body;
}

const form = (fields: Record<string, string>) => new URLSearchParams(fields);

type MediaFile = { data: Buffer; type: string; name: string };

/**
 * Our own image or video, read by this server. The files are uploaded to the networks as they
 * are, so posting doesn't depend on the network reaching our media address (which it can't
 * while the system runs on a local computer). Only Instagram images still go by link.
 */
async function download(url: string, name: string): Promise<MediaFile> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`the media file could not be read from ${url} (HTTP ${res.status})`);
  return { data: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type')?.split(';')[0] ?? 'application/octet-stream', name };
}

/** A multipart form: text fields plus one file. */
function withFile(fields: Record<string, string>, field: string, file: MediaFile): FormData {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.append(key, value);
  body.append(field, new Blob([new Uint8Array(file.data)], { type: file.type }), file.name);
  return body;
}

/** Meta's resumable upload (rupload.facebook.com): the whole file in one request. */
async function uploadVideo(uploadUrl: string, token: string, video: MediaFile): Promise<void> {
  await call<{ success?: boolean }>(
    uploadUrl,
    {
      method: 'POST',
      headers: { Authorization: `OAuth ${token}`, offset: '0', file_size: String(video.data.length), 'content-type': 'application/octet-stream' },
      body: new Uint8Array(video.data),
    },
    600_000,
  );
}

async function telegram(token: string, chatId: string, p: SocialPayload): Promise<PostResult> {
  const photo = await download(p.squareImageUrl, 'post.jpg');
  const r = await call<{ result: { message_id: number } }>(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method: 'POST',
    body: withFile({ chat_id: chatId, caption: postText(p).slice(0, 1024) }, 'photo', photo),
  });
  return { status: 'posted', postId: String(r.result.message_id), commentId: null };
}

async function facebook(graph: string, token: string, pageId: string, p: SocialPayload): Promise<PostResult> {
  const photo = await download(p.squareImageUrl, 'post.jpg');
  const post = await call<{ id: string; post_id?: string }>(`${graph}/${encodeURIComponent(pageId)}/photos`, {
    method: 'POST',
    body: withFile({ caption: postText(p), access_token: token }, 'source', photo),
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

/** Instagram story: a STORIES container, then publish. (The API can't add a link sticker.) */
async function instagramStory(graph: string, token: string, igUserId: string, p: SocialPayload): Promise<PostResult> {
  const container = await call<{ id: string }>(`${graph}/${encodeURIComponent(igUserId)}/media`, {
    method: 'POST',
    body: form({ image_url: p.storyImageUrl, media_type: 'STORIES', access_token: token }),
  });
  const media = await call<{ id: string }>(`${graph}/${encodeURIComponent(igUserId)}/media_publish`, {
    method: 'POST',
    body: form({ creation_id: container.id, access_token: token }),
  });
  return { status: 'posted', postId: media.id, commentId: null };
}

/** Facebook Page story: upload the photo unpublished, then publish it as a story. */
async function facebookStory(graph: string, token: string, pageId: string, p: SocialPayload): Promise<PostResult> {
  const image = await download(p.storyImageUrl, 'story.jpg');
  const photo = await call<{ id: string }>(`${graph}/${encodeURIComponent(pageId)}/photos`, {
    method: 'POST',
    body: withFile({ published: 'false', access_token: token }, 'source', image),
  });
  const story = await call<{ post_id: string }>(`${graph}/${encodeURIComponent(pageId)}/photo_stories`, {
    method: 'POST',
    body: form({ photo_id: photo.id, access_token: token }),
  });
  return { status: 'posted', postId: story.post_id, commentId: null };
}

/**
 * Instagram reel: a REELS container with the video (resumable upload) and the branded cover, wait
 * until Instagram has processed it, publish, then the link in the first comment. Instagram's API
 * can't attach music from its library; an editor who wants a song adds it in the app.
 */
async function instagramReel(graph: string, token: string, igUserId: string, p: SocialPayload): Promise<PostResult> {
  const video = await download(p.videoUrl!, 'reel.mp4');
  const fields: Record<string, string> = { media_type: 'REELS', upload_type: 'resumable', caption: postText(p), access_token: token };
  // Instagram downloads the cover itself, so only a public address works.
  if (p.coverUrl && publiclyReachable(p.coverUrl)) fields.cover_url = p.coverUrl;
  const container = await call<{ id: string; uri?: string }>(`${graph}/${encodeURIComponent(igUserId)}/media`, { method: 'POST', body: form(fields) });
  const version = graph.slice(graph.lastIndexOf('/') + 1);
  await uploadVideo(container.uri ?? `https://rupload.facebook.com/ig-api-upload/${version}/${container.id}`, token, video);
  // Instagram processes the video first; checked every 20 seconds, for up to 5 minutes.
  for (let i = 0; ; i++) {
    const st = await call<{ status_code?: string }>(`${graph}/${encodeURIComponent(container.id)}?fields=status_code&access_token=${encodeURIComponent(token)}`, { method: 'GET' });
    if (st.status_code === 'FINISHED') break;
    if (st.status_code === 'ERROR' || st.status_code === 'EXPIRED') throw new Error(`Instagram could not process the video (${st.status_code})`);
    if (i >= 15) throw new Error('Instagram is still processing the video; try publishing again in a few minutes');
    await sleep(20_000);
  }
  const media = await call<{ id: string }>(`${graph}/${encodeURIComponent(igUserId)}/media_publish`, { method: 'POST', body: form({ creation_id: container.id, access_token: token }) });
  const comment = p.linkInFirstComment
    ? await call<{ id: string }>(`${graph}/${encodeURIComponent(media.id)}/comments`, { method: 'POST', body: form({ message: p.articleUrl, access_token: token }) })
    : null;
  return { status: 'posted', postId: media.id, commentId: comment?.id ?? null };
}

/** Facebook Page reel: start an upload session, upload the video, wait until it is ready, publish. */
async function facebookReel(graph: string, token: string, pageId: string, p: SocialPayload): Promise<PostResult> {
  const video = await download(p.videoUrl!, 'reel.mp4');
  const start = await call<{ video_id: string; upload_url: string }>(`${graph}/${encodeURIComponent(pageId)}/video_reels`, {
    method: 'POST',
    body: form({ upload_phase: 'start', access_token: token }),
  });
  await uploadVideo(start.upload_url, token, video);
  for (let i = 0; ; i++) {
    const st = await call<{ status?: { video_status?: string } }>(`${graph}/${encodeURIComponent(start.video_id)}?fields=status&access_token=${encodeURIComponent(token)}`, { method: 'GET' });
    const status = st.status?.video_status;
    if (status === 'ready' || status === 'upload_complete') break;
    if (status === 'error' || status === 'upload_failed' || status === 'expired') throw new Error(`Facebook could not process the video (${status})`);
    if (i >= 15) throw new Error('Facebook is still processing the video; try publishing again in a few minutes');
    await sleep(20_000);
  }
  await call<{ success?: boolean }>(`${graph}/${encodeURIComponent(pageId)}/video_reels`, {
    method: 'POST',
    // Facebook reels have no comment for the link, so it goes in the description.
    body: form({ access_token: token, video_id: start.video_id, upload_phase: 'finish', video_state: 'PUBLISHED', description: `${p.headline}\n\n${p.caption}\n\n${p.articleUrl}` }),
  });
  return { status: 'posted', postId: start.video_id, commentId: null };
}

/** Which formats a platform can publish through its API. */
export function autoFormats(platform: SocialPlatform): ('feed' | 'story' | 'reel')[] {
  if (platform === 'facebook' || platform === 'instagram') return ['feed', 'story', 'reel'];
  if (platform === 'telegram') return ['feed'];
  return [];
}

/**
 * Whether the internet can reach an address: not localhost or a private network (as when the
 * system runs on a computer). Instagram images and the article link must be reachable.
 */
export function publiclyReachable(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return false;
  }
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '::1' || host === '0.0.0.0') return false;
  return !/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(host);
}

export const LOCAL_MEDIA_ERROR =
  'אינסטגרם מקבל תמונות רק מקישור ציבורי שהוא מוריד בעצמו, והתמונות של המערכת נמצאות כרגע בכתובת מקומית (localhost). פוסט וסטורי לאינסטגרם יעבדו אחרי שהמערכת תעלה לשרת ציבורי; ריל לאינסטגרם, ופייסבוק וטלגרם, מקבלים את הקובץ ישירות.';

export async function publishToNetwork(config: Config, account: SocialAccountRef, token: string | undefined, payload: SocialPayload, format: 'feed' | 'story' | 'reel' = 'feed'): Promise<PostResult> {
  if (!token) return { status: 'prepared', reason: 'החשבון לא מחובר (אין טוקן בשרת). הפוסט הוכן לפרסום ידני.' };
  // Instagram images go by link only: say so plainly rather than pass on its "Only photo or video" error.
  const image = format === 'story' ? payload.storyImageUrl : payload.squareImageUrl;
  if (account.platform === 'instagram' && format !== 'reel' && !publiclyReachable(image)) throw new Error(LOCAL_MEDIA_ERROR);
  const graph = `https://graph.facebook.com/${config.metaGraphVersion}`;
  if (format === 'reel') {
    if (!payload.videoUrl) return { status: 'prepared', reason: 'אין סרטון לריל. צרו ריל לכתבה ואז פרסמו.' };
    if (account.platform === 'instagram') return instagramReel(graph, token, account.externalId, payload);
    if (account.platform === 'facebook') return facebookReel(graph, token, account.externalId, payload);
    return { status: 'prepared', reason: 'אין פרסום ריל אוטומטי בפלטפורמה הזו. הסרטון מוכן להורדה ולפרסום ידני.' };
  }
  if (format === 'story') {
    if (account.platform === 'instagram') return instagramStory(graph, token, account.externalId, payload);
    if (account.platform === 'facebook') return facebookStory(graph, token, account.externalId, payload);
    return { status: 'prepared', reason: 'אין פרסום סטורי אוטומטי בפלטפורמה הזו. הסטורי מוכן להורדה ולפרסום ידני.' };
  }
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
