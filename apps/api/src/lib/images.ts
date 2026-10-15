// "Automatic pixel management": every image that enters the system (upload,
// AI generation, download) is validated, stripped of metadata, re-encoded and
// cut into the fixed renditions the site, the app and the social networks use,
// around an adjustable focal point.
import { randomUUID } from 'node:crypto';
import type { MediaDto } from '@b4/shared';
import { type Db, eq, mediaAssets } from '@b4/db';
import sharp from 'sharp';
import { AppError } from '../errors';
import type { MediaStorage } from './storage';

/** name -> [width, height, format]. JPEG where social networks require it. */
export const RENDITIONS = {
  hero: [1600, 900, 'webp'],
  card: [800, 450, 'webp'],
  thumb: [320, 180, 'webp'],
  og: [1200, 630, 'jpg'],
  square: [1080, 1080, 'jpg'],
  story: [1080, 1920, 'jpg'],
} as const satisfies Record<string, readonly [number, number, 'webp' | 'jpg']>;

export const MIN_SIZE = { width: 400, height: 225 } as const;
const MAX_INPUT_PIXELS = 50_000_000;
const ACCEPTED = new Set(['jpeg', 'png', 'webp', 'gif', 'avif', 'heif', 'tiff']);

export type MediaRow = typeof mediaAssets.$inferSelect;
type Kind = MediaRow['kind'];

export type IngestMeta = {
  kind: Kind;
  originalUrl?: string | null;
  alt?: string | null;
  credit?: string | null;
  isAiGenerated?: boolean;
  aiPrompt?: string | null;
  batchId?: string | null;
  createdBy?: string | null;
  focalX?: number;
  focalY?: number;
  /** A preview that only needs these renditions (all of them are cut if it is chosen and refocused). */
  renditions?: (keyof typeof RENDITIONS)[];
  /** The draft this image was redrawn from. */
  derivedFromId?: string | null;
};

type SharpImage = ReturnType<typeof sharp>;
type SharpMetadata = Awaited<ReturnType<SharpImage['metadata']>>;

const badImage = (message: string) => new AppError(422, 'bad_image', message);
/** "1200×800" set apart, so a Hebrew message never shows it as "800×1200". */
const dims = (w: number, h: number) => `⁦${w}×${h}⁩`;

function encode(img: SharpImage, format: 'webp' | 'jpg'): Promise<Buffer> {
  return format === 'webp' ? img.webp({ quality: 82 }).toBuffer() : img.jpeg({ quality: 85, mozjpeg: true }).toBuffer();
}

/** Cover-crop to exactly width x height, keeping the focal point as close to the center as the frame allows. */
async function renderCrop(source: Buffer, srcW: number, srcH: number, w: number, h: number, fx: number, fy: number, format: 'webp' | 'jpg') {
  const scale = Math.max(w / srcW, h / srcH);
  const rw = Math.max(w, Math.round(srcW * scale));
  const rh = Math.max(h, Math.round(srcH * scale));
  const left = Math.min(Math.max(Math.round(fx * rw - w / 2), 0), rw - w);
  const top = Math.min(Math.max(Math.round(fy * rh - h / 2), 0), rh - h);
  const img = sharp(source).resize(rw, rh, { fit: 'fill' }).extract({ left, top, width: w, height: h });
  return encode(format === 'jpg' ? img.flatten({ background: '#ffffff' }) : img, format);
}

/** Rendition file names carry a fresh tag, so a CDN never serves an old crop after a refocus. */
async function renderAll(storage: MediaStorage, base: string, master: Buffer, width: number, height: number, fx: number, fy: number, only?: readonly string[]) {
  const variants: Record<string, string> = {};
  const tag = randomUUID().slice(0, 6);
  for (const [name, [w, h, format]] of Object.entries(RENDITIONS)) {
    if (only && !only.includes(name)) continue;
    const key = `${base}/${name}-${tag}.${format}`;
    await storage.put(key, await renderCrop(master, width, height, w, h, fx, fy, format), format === 'webp' ? 'image/webp' : 'image/jpeg');
    variants[name] = key;
  }
  return variants;
}

export async function ingestImage(db: Db, storage: MediaStorage, input: Buffer, meta: IngestMeta): Promise<MediaRow> {
  let info: SharpMetadata;
  try {
    info = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  } catch {
    throw badImage('הקובץ אינו תמונה תקינה');
  }
  if (!info.format || !ACCEPTED.has(info.format)) throw badImage('סוג קובץ לא נתמך. אפשר JPG, PNG, WebP או AVIF');

  // Apply EXIF rotation once, drop all metadata (location, camera), cap the master at 2400px wide.
  const master = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, animated: false })
    .rotate()
    .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 88 })
    .toBuffer({ resolveWithObject: true });
  const { width, height } = master.info;
  if (width < MIN_SIZE.width || height < MIN_SIZE.height) {
    throw badImage(`התמונה קטנה מדי: ${dims(width, height)}. צריך לפחות ${dims(MIN_SIZE.width, MIN_SIZE.height)}.`);
  }

  const id = randomUUID();
  const now = new Date();
  const base = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${id}`;
  const masterKey = `${base}/original.webp`;
  await storage.put(masterKey, master.data, 'image/webp');
  const fx = meta.focalX ?? 0.5;
  const fy = meta.focalY ?? 0.5;
  const variants = await renderAll(storage, base, master.data, width, height, fx, fy, meta.renditions);

  const [row] = await db
    .insert(mediaAssets)
    .values({
      id,
      kind: meta.kind,
      storageKey: masterKey,
      originalUrl: meta.originalUrl ?? null,
      mimeType: 'image/webp',
      width,
      height,
      bytes: master.data.length,
      variants,
      focalX: fx,
      focalY: fy,
      altText: meta.alt ?? null,
      credit: meta.credit ?? null,
      isAiGenerated: meta.isAiGenerated ?? false,
      aiPrompt: meta.aiPrompt ?? null,
      generationBatchId: meta.batchId ?? null,
      derivedFromId: meta.derivedFromId ?? null,
      createdBy: meta.createdBy ?? null,
    })
    .returning();
  return row!;
}

/** Re-cuts every rendition around a new focal point. */
export async function refocus(db: Db, storage: MediaStorage, media: MediaRow, fx: number, fy: number): Promise<MediaRow> {
  const master = await storage.get(media.storageKey);
  const base = media.storageKey.slice(0, media.storageKey.lastIndexOf('/'));
  const variants = await renderAll(storage, base, master, media.width, media.height, fx, fy);
  const [row] = await db.update(mediaAssets).set({ focalX: fx, focalY: fy, variants }).where(eq(mediaAssets.id, media.id)).returning();
  await storage.remove(Object.values(media.variants));
  return row!;
}

export function toMediaDto(storage: MediaStorage, m: MediaRow): MediaDto {
  return {
    id: m.id,
    url: storage.url(m.variants.hero ?? m.storageKey),
    thumbUrl: storage.url(m.variants.thumb ?? m.storageKey),
    storyUrl: storage.url(m.variants.story ?? m.storageKey),
    width: m.width,
    height: m.height,
    alt: m.altText,
    credit: m.credit,
    isAiGenerated: m.isAiGenerated,
    focalX: m.focalX,
    focalY: m.focalY,
  };
}

export function variantUrl(storage: MediaStorage, m: MediaRow, name: keyof typeof RENDITIONS): string {
  return storage.url(m.variants[name] ?? m.storageKey);
}

/** How an ad picture is fitted: exact (a banner carries its words, so only its own proportions, give or take 3%), cover (a photo, cut around its center), or free (kept whole). */
export type FitRule = 'exact' | 'cover' | 'free';

/**
 * A picture for an ad, outside the newsroom's media library: validated, its first frame only (no
 * animation), stripped of metadata and kept at twice the size it is shown at, as "ad-<name>-…".
 */
export async function ingestAdImage(
  storage: MediaStorage,
  input: Buffer,
  opts: { name: string; width: number; height: number; fit: FitRule },
): Promise<{ key: string; width: number; height: number }> {
  let info: SharpMetadata;
  try {
    info = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  } catch {
    throw badImage('הקובץ אינו תמונה תקינה');
  }
  if (!info.format || !ACCEPTED.has(info.format)) throw badImage('סוג קובץ לא נתמך. אפשר JPG, PNG, WebP או AVIF');
  const oriented = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, animated: false }).rotate().toBuffer({ resolveWithObject: true });
  const { width: srcW, height: srcH } = oriented.info;
  const { width: w, height: h } = opts;
  if (opts.fit === 'exact' && Math.abs(srcW / srcH - w / h) > (w / h) * 0.03) {
    throw badImage(`המידות לא מתאימות: ${dims(srcW, srcH)}. צריך ${dims(w, h)}, או ${dims(w * 2, h * 2)} למסכים חדים.`);
  }
  if (srcW < w || srcH < h) throw badImage(`התמונה קטנה מדי: ${dims(srcW, srcH)}. צריך לפחות ${dims(w, h)}.`);
  const img =
    opts.fit === 'free'
      ? sharp(oriented.data).resize({ width: w * 2, height: h * 2, fit: 'inside', withoutEnlargement: true })
      : sharp(oriented.data).resize({ width: Math.min(w * 2, Math.round((srcH * w) / h), srcW), height: Math.min(h * 2, Math.round((srcW * h) / w), srcH), fit: 'cover', position: 'centre' });
  const out = await img.webp({ quality: 90 }).toBuffer({ resolveWithObject: true });
  const now = new Date();
  const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}/ad-${opts.name}-${randomUUID().slice(0, 6)}.webp`;
  await storage.put(key, out.data, 'image/webp');
  return { key, width: out.info.width, height: out.info.height };
}
