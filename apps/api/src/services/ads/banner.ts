// Banners set from words: the headline, a line, the call to action and the advertiser's name, in
// the brand fonts (Pango shapes Hebrew right to left), on a calm background or beside a photo, in
// every size the format needs. What the admin approves is exactly what readers get. The "פרסומת"
// label is drawn by the site around the banner, never baked into it.
import { AD_SIZES, type AdComposeInput, type AdComposeDto } from '@b4/shared';
import sharp, { type OverlayOptions } from 'sharp';
import { ingestAdImage } from '../../lib/images';
import type { MediaStorage } from '../../lib/storage';
import { type Block, chip, fit, text } from '../social-design';

type Palette = { bg: string; bg2: string; text: string; sub: string; ctaBg: string; ctaText: string };

const THEMES: Record<Exclude<AdComposeInput['theme'], 'custom'>, Palette> = {
  dark: { bg: '#1C1C21', bg2: '#0E0E10', text: '#FFFFFF', sub: '#C9C9CF', ctaBg: '#D9121F', ctaText: '#FFFFFF' },
  light: { bg: '#FFFFFF', bg2: '#F1EFEC', text: '#121214', sub: '#4A4A52', ctaBg: '#121214', ctaText: '#FFFFFF' },
  brand: { bg: '#D9121F', bg2: '#A70E18', text: '#FFFFFF', sub: '#FFE3E5', ctaBg: '#FFFFFF', ctaText: '#D9121F' },
};

/** The advertiser's own color: text in white or black, whichever reads better on it. */
function customPalette(color: string): Palette {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255) as [number, number, number];
  const light = 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55;
  const shade = `#${[r, g, b].map((c) => Math.round(c * 255 * 0.78).toString(16).padStart(2, '0')).join('')}`;
  return light
    ? { bg: color, bg2: shade, text: '#121214', sub: '#2E2E33', ctaBg: '#121214', ctaText: '#FFFFFF' }
    : { bg: color, bg2: shade, text: '#FFFFFF', sub: '#E8E8EC', ctaBg: '#FFFFFF', ctaText: color };
}

type Frame = { W: number; H: number; layers: OverlayOptions[] };

const svg = (W: number, H: number, body: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${body}</svg>`);

/** A soft diagonal gradient; flat beside a photo, so the photo's fade meets the very same color. */
function background(W: number, H: number, p: Palette, flat = false): Buffer {
  if (flat) return svg(W, H, `<rect width="${W}" height="${H}" fill="${p.bg}"/>`);
  return svg(W, H, `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p.bg}"/><stop offset="1" stop-color="${p.bg2}"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/>`);
}

async function cover(photo: Buffer, w: number, h: number): Promise<Buffer> {
  return sharp(photo).resize(w, h, { fit: 'cover', position: 'attention' }).png().toBuffer();
}

/** Right-aligned (the start edge in Hebrew), `inset` from the right edge. */
const atStart = (f: Frame, b: Block, top: number, inset: number) => f.layers.push({ input: b.input, top: Math.round(top), left: Math.round(f.W - inset - b.width) });

/** Stacks blocks top to bottom at the start edge, centered vertically between top and bottom. */
function stack(f: Frame, items: { block: Block | null; gap: number }[], inset: number, top: number, bottom: number) {
  const present = items.filter((i): i is { block: Block; gap: number } => i.block !== null);
  const height = present.reduce((sum, i, n) => sum + i.block.height + (n ? i.gap : 0), 0);
  let y = top + Math.max(0, (bottom - top - height) / 2);
  present.forEach((i, n) => {
    if (n) y += i.gap;
    atStart(f, i.block, y, inset);
    y += i.block.height;
  });
}

const ctaChip = (label: string, p: Palette, size: number) => chip(label, { bg: p.ctaBg, color: p.ctaText, size, padX: Math.round(size * 1.1), padY: Math.round(size * 0.45), radius: Math.round(size * 1.3), font: 'label' });

/** The billboard on a large screen: words on the start side, the photo (if any) on the end side, the button under the words. */
async function wide(f: Frame, input: AdComposeInput, p: Palette, photo: Buffer | null): Promise<Buffer> {
  const { W, H } = f;
  const pad = 64;
  const base = await sharp(background(W, H, p, Boolean(photo))).png().toBuffer();
  let textWidth: number;
  if (photo) {
    const pw = Math.round(W * 0.38);
    f.layers.push({ input: await cover(photo, pw, H), top: 0, left: 0 });
    // The photo melts into the background toward the words.
    f.layers.push({ input: svg(W, H, `<defs><linearGradient id="m" x1="0" y1="0" x2="1" y2="0"><stop offset="0.55" stop-color="${p.bg}" stop-opacity="0"/><stop offset="1" stop-color="${p.bg}" stop-opacity="1"/></linearGradient></defs><rect width="${pw}" height="${H}" fill="url(#m)"/>`), top: 0, left: 0 });
    textWidth = W - pw - pad - 40;
  } else {
    textWidth = Math.round(W * 0.66);
  }
  const sponsor = await text(input.sponsor, { font: 'label', size: 26, color: p.sub, width: textWidth });
  const headline = await fit(input.headline, { font: 'display', size: 74, color: p.text, width: textWidth, leading: -0.12 }, input.body ? 190 : 260, 44);
  const body = input.body ? await fit(input.body, { font: 'medium', size: 34, color: p.sub, width: textWidth, leading: -0.06 }, 88, 26) : null;
  const cta = input.cta ? await ctaChip(input.cta, p, photo ? 30 : 36) : null;
  if (photo || !cta) {
    stack(f, [{ block: sponsor, gap: 0 }, { block: headline, gap: 14 }, { block: body, gap: 12 }, { block: cta, gap: 26 }], pad, pad * 0.7, H - pad * 0.7);
  } else {
    // No photo: the button stands alone on the end side, like a classic billboard.
    stack(f, [{ block: sponsor, gap: 0 }, { block: headline, gap: 14 }, { block: body, gap: 12 }], pad, pad * 0.7, H - pad * 0.7);
    f.layers.push({ input: cta.input, top: Math.round((H - cta.height) / 2), left: pad + 20 });
  }
  return base;
}

/** The billboard on a phone (320x100): a square photo on the end side, the headline and a small button. */
async function strip(f: Frame, input: AdComposeInput, p: Palette, photo: Buffer | null): Promise<Buffer> {
  const { W, H } = f;
  const pad = 22;
  const base = await sharp(background(W, H, p)).png().toBuffer();
  let width = W - pad * 2;
  if (photo) {
    f.layers.push({ input: await cover(photo, H, H), top: 0, left: 0 });
    width = W - H - pad * 2;
  }
  const sponsor = await text(input.sponsor, { font: 'label', size: 17, color: p.sub, width });
  const headline = await fit(input.headline, { font: 'display', size: 36, color: p.text, width, leading: -0.12 }, 92, 24);
  const cta = input.cta ? await ctaChip(input.cta, p, 20) : null;
  stack(f, [{ block: sponsor, gap: 0 }, { block: headline, gap: 4 }, { block: cta, gap: 8 }], pad, 10, H - 10);
  return base;
}

/** The rectangle (300x250): the photo on top, then the words and the button. */
async function box(f: Frame, input: AdComposeInput, p: Palette, photo: Buffer | null): Promise<Buffer> {
  const { W, H } = f;
  const pad = 36;
  const base = await sharp(background(W, H, p)).png().toBuffer();
  let top = pad;
  if (photo) {
    const ph = Math.round(H * 0.46);
    f.layers.push({ input: await cover(photo, W, ph), top: 0, left: 0 });
    top = ph + 22;
  }
  const width = W - pad * 2;
  const sponsor = await text(input.sponsor, { font: 'label', size: 22, color: p.sub, width });
  const headline = await fit(input.headline, { font: 'display', size: photo ? 42 : 52, color: p.text, width, leading: -0.1 }, photo ? 110 : 190, 28);
  const body = input.body ? await fit(input.body, { font: 'medium', size: 26, color: p.sub, width, leading: -0.05 }, photo ? 36 : 110, 20) : null;
  const cta = input.cta ? await ctaChip(input.cta, p, 26) : null;
  const ctaTop = cta ? H - pad - cta.height : H - pad;
  if (cta) atStart(f, cta, ctaTop, pad);
  stack(f, [{ block: sponsor, gap: 0 }, { block: headline, gap: 8 }, { block: body, gap: 8 }], pad, top, ctaTop - 14);
  return base;
}

async function render(layout: typeof wide, W: number, H: number, input: AdComposeInput, p: Palette, photo: Buffer | null): Promise<Buffer> {
  const f: Frame = { W, H, layers: [] };
  const base = await layout(f, input, p, photo);
  return sharp(base).composite(f.layers).png().toBuffer();
}

/** Renders the banner in every size of its format and stores it (twice the display size, for sharp screens). */
export async function composeBanner(storage: MediaStorage, input: AdComposeInput, photo: Buffer | null): Promise<AdComposeDto> {
  const p = input.theme === 'custom' ? customPalette(input.color) : THEMES[input.theme];
  const sizes = AD_SIZES[input.format];
  const store = async (png: Buffer, name: string, size: { width: number; height: number }) => {
    const saved = await ingestAdImage(storage, png, { name, width: size.width, height: size.height, fit: 'exact' });
    return { ...saved, url: storage.url(saved.key) };
  };
  if (input.format === 'billboard') {
    const [desktop, mobile] = await Promise.all([
      render(wide, sizes.desktop.width * 2, sizes.desktop.height * 2, input, p, photo),
      render(strip, sizes.mobile.width * 2, sizes.mobile.height * 2, input, p, photo),
    ]);
    return { desktop: await store(desktop, 'desktop', sizes.desktop), mobile: await store(mobile, 'mobile', sizes.mobile) };
  }
  const one = await store(await render(box, sizes.desktop.width * 2, sizes.desktop.height * 2, input, p, photo), 'desktop', sizes.desktop);
  return { desktop: one, mobile: one };
}
