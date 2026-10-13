// What the image generator is asked for: the editor's brief, the article it
// illustrates, and (when the editor chooses) the original's photo as inspiration.
import { eq, scrapedItems } from '@b4/db';
import sharp from 'sharp';
import type { ImageReference } from './ai/types';
import type { Services } from './context';

type DraftText = { id: string; title: string; subtitle: string; bodyText: string; scrapedItemId: string | null };

const REFERENCE_RULES =
  'The attached photo is the one the original publisher ran with this story. It is protected by copyright: use it only to understand the subject and the setting. ' +
  'Create a clearly different, original image with a new composition, angle and lighting. Do not reproduce the photo, any real person’s likeness, logos, text or watermarks.';

export function imageBrief(draft: DraftText, brief: string, withReference: boolean): string {
  const opening = draft.bodyText.replace(/\s+/g, ' ').trim().slice(0, 600);
  return [
    brief,
    '',
    'The image illustrates this news article (in Hebrew):',
    `Headline: ${draft.title}`,
    draft.subtitle ? `Subtitle: ${draft.subtitle}` : null,
    opening ? `Opening: ${opening}` : null,
    '',
    'Editorial news image. No text, captions, logos or watermarks in the image.',
    withReference ? REFERENCE_RULES : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

/** The chosen draft, redrawn at full quality: the same picture, not a new idea. */
export function finalBrief(brief: string): string {
  return [
    'The attached image is the draft the editor chose to illustrate a news article. Produce the final version of this same image at full resolution.',
    'Keep the composition, framing, subjects, colors and lighting exactly as they are. Do not add, remove or move anything; render every detail sharp and clean.',
    'No text, captions, logos or watermarks in the image.',
    '',
    `What the image shows: ${brief}`,
  ].join('\n');
}

/** The original article's photo as a JPEG the image model accepts, or null if it can't be had. */
export async function sourceImageReference(s: Services, draft: DraftText): Promise<ImageReference | null> {
  if (!draft.scrapedItemId) return null;
  const [item] = await s.db.select({ imageUrl: scrapedItems.imageUrl }).from(scrapedItems).where(eq(scrapedItems.id, draft.scrapedItemId)).limit(1);
  if (!item?.imageUrl) return null;
  // SVG is only rendered for the local sample sites; from the open web it is refused (it can carry scripts and links).
  const ownSample = s.config.devFixtures && item.imageUrl.startsWith(`${s.config.publicApiUrl}/dev/`);
  const types = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', ...(ownSample ? ['image/svg+xml'] : [])];
  try {
    const res = await s.fetch(item.imageUrl, { accept: 'image/*', allowTypes: types, maxBytes: 10 * 1024 * 1024 });
    const data = await sharp(res.body, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 85 })
      .toBuffer();
    return { data, mimeType: 'image/jpeg' };
  } catch (e) {
    s.log.warn({ draftId: draft.id, err: e instanceof Error ? e.message : e }, 'source image unavailable');
    return null;
  }
}

/** A stored draft image as a JPEG the image model accepts, to be redrawn at full quality. */
export async function draftReference(s: Services, storageKey: string): Promise<ImageReference> {
  const data = await sharp(await s.storage.get(storageKey)).flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer();
  return { data, mimeType: 'image/jpeg' };
}

/** A failed image job, in words an editor can act on. */
export function imageErrorMessage(raw: string | null): string {
  if (!raw) return 'יצירת התמונות נכשלה.';
  if (/[א-ת]/.test(raw)) return raw; // already written for editors (e.g. "not connected")
  const status = /\((\d{3})\)/.exec(raw)?.[1];
  if (status === '429' && /limit: 0|free tier/i.test(raw)) {
    return 'חשבון Google עדיין בתוכנית החינמית, ובה אין מכסה ליצירת תמונות. מפעילים חיוב (Billing) בפרויקט ב-aistudio.google.com ואז מנסים שוב.';
  }
  if (status === '429') return 'הגענו למכסת הבקשות של Gemini. נסו שוב בעוד דקה.';
  if (status === '400' && /api key/i.test(raw)) return 'המפתח של Gemini לא תקין. בדקו אותו ב"הגדרות" > "חיבורים".';
  if (status === '401' || status === '403') return 'Gemini סירב לבקשה (הרשאות המפתח). בדקו אותו ב"הגדרות" > "חיבורים".';
  if (/^visual agent/.test(raw)) {
    if (status === '404') return 'המודל של סוכן התמונות לא נמצא. בדקו את שם המודל ב"הגדרות" > "חיבורים" > Gemini.';
    return `סוכן התמונות לא הצליח לכתוב את התיאור: ${raw.replace(/^visual agent (failed|returned)\s*/, '').slice(0, 200)}`;
  }
  if (/no image/.test(raw)) return 'Gemini לא החזיר תמונה, כנראה בגלל התיאור. נסו לנסח אותו אחרת.';
  return `יצירת התמונות נכשלה: ${raw.replace(/^image generation failed\s*/, '').slice(0, 200)}`;
}
