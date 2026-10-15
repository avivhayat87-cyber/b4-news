// Branded designs for the social page: a feed post (1080x1350) and a story
// (1080x1920) per template, rendered on the server, so what the editor sees is
// exactly what goes out. Text is set in the brand fonts (Rubik for headlines,
// Heebo for text) through Pango, which shapes Hebrew and lays out right-to-left
// lines; shapes and the logo are SVG. Stories keep the top and bottom of the
// frame clear, where Instagram and Facebook draw their own controls.
import { fileURLToPath } from 'node:url';
import { type DesignFormat, SHARE_SIZES, type ShareTemplate } from '@b4/shared';
import sharp, { type OverlayOptions } from 'sharp';

const FONT_DIR = fileURLToPath(new URL('../../assets/fonts/', import.meta.url));
const FONTS = {
  display: { file: 'Rubik_800ExtraBold.ttf', name: 'Rubik ExtraBold' },
  label: { file: 'Rubik_700Bold.ttf', name: 'Rubik Bold' },
  text: { file: 'Heebo_400Regular.ttf', name: 'Heebo' },
  medium: { file: 'Heebo_500Medium.ttf', name: 'Heebo Medium' },
  bold: { file: 'Heebo_700Bold.ttf', name: 'Heebo Bold' },
} as const;
type FontKey = keyof typeof FONTS;

const C = { brand: '#D9121F', ink: '#121214', ink2: '#4A4A52', night: '#141417', stone: '#F4F3F1', line: '#E6E4E1', white: '#FFFFFF' };

export type DesignInput = {
  template: ShareTemplate;
  format: DesignFormat;
  kicker: string;
  headline: string;
  hook: string;
  /** Background photo (any size); null draws the brand background. */
  photo: { data: Buffer; focalX: number; focalY: number } | null;
  /** The site's address as readers know it, e.g. "b4news.co.il". */
  site: string;
  /** Publishing time, shown on the breaking-news frame ("14:32"). */
  time?: string;
};

/** A rendered piece (text, a label, the logo) to place on a frame. Ad banners (ads/banner.ts) are set with the same pieces. */
export type Block = { input: Buffer; width: number; height: number };
type Layer = OverlayOptions;
type Frame = { W: number; H: number; pad: number; story: boolean; layers: Layer[] };

// --- Text ------------------------------------------------------------------------
const escapeMarkup = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export type TextOpts = { font: FontKey; size: number; color: string; alpha?: number; width: number; /** Extra space between lines, as a fraction of the size (negative = tighter than the font's own). */ leading?: number; align?: 'start' | 'center' };

/** One block of text. RTL is forced (a leading RLM), so a headline that starts with a number still reads right to left. */
export async function text(content: string, o: TextOpts): Promise<Block | null> {
  const clean = content.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  const f = FONTS[o.font];
  const alpha = o.alpha !== undefined ? ` fgalpha="${Math.round(o.alpha * 100)}%"` : '';
  const { data, info } = await sharp({
    text: {
      text: `<span foreground="${o.color}"${alpha}>‏${escapeMarkup(clean)}</span>`,
      font: `${f.name} ${Math.round(o.size)}`,
      fontfile: FONT_DIR + f.file,
      width: Math.round(o.width),
      rgba: true,
      // Pango mirrors alignment for right-to-left paragraphs: "left" is the start, i.e. the right edge.
      align: o.align === 'center' ? 'centre' : 'left',
      wrap: 'word',
      dpi: 72,
      ...(o.leading ? { spacing: Math.round(o.size * o.leading) } : {}),
    },
  })
    .png()
    .toBuffer({ resolveWithObject: true });
  return { input: data, width: info.width, height: info.height };
}

/** Shrinks the type until the text fits the height; below the minimum size, drops words and ends with "…". */
export async function fit(content: string, o: TextOpts, maxHeight: number, minSize: number): Promise<Block | null> {
  let size = o.size;
  let words = content.trim().split(/\s+/);
  let current = content;
  for (;;) {
    const block = await text(current, { ...o, size });
    if (!block || block.height <= maxHeight) return block;
    if (size - 4 >= minSize) size -= 4;
    else if (words.length > 1) {
      words = words.slice(0, -1);
      current = `${words.join(' ').replace(/[,:;.\-–]+$/, '')}…`;
    } else return block;
  }
}

/** A label on a colored, rounded background. */
export async function chip(label: string, o: { bg: string; color: string; size: number; padX: number; padY: number; radius: number; font?: FontKey }): Promise<Block | null> {
  const t = await text(label, { font: o.font ?? 'label', size: o.size, color: o.color, width: 900 });
  if (!t) return null;
  const width = t.width + o.padX * 2;
  const height = t.height + o.padY * 2;
  const input = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="${o.radius}" fill="${o.bg}"/></svg>`))
    .composite([{ input: t.input, top: o.padY, left: o.padX }])
    .png()
    .toBuffer();
  return { input, width, height };
}

// --- Brand -----------------------------------------------------------------------
type LogoTone = 'dark' | 'light' | 'red';

/** The B4 NEW'S logo (brand/b4-logo*.svg). dark = on photos and dark backgrounds, light = on white, red = on the brand red. */
function logoSvg(tone: LogoTone, height: number): string {
  const seal = tone === 'red' ? C.white : C.brand;
  const inner = tone === 'red' ? C.brand : C.white;
  const word = tone === 'light' ? C.ink : C.white;
  const mark = tone === 'red' ? C.white : C.brand;
  const width = Math.round((334 * height) / 124);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 334 124" width="${width}" height="${height}"><g transform="translate(2 2)">
<circle cx="60" cy="60" r="58" fill="${seal}"/>
<path d="M60 12A48 48 0 1 0 101.57 36" fill="none" stroke="${inner}" stroke-width="3" stroke-linecap="round"/>
<circle cx="84" cy="18.43" r="4.5" fill="${inner}"/>
<g transform="translate(26.5 40) scale(0.5)"><g fill="none" stroke="${inner}" stroke-width="17"><path d="M8.5 0V80M8.5 8.5H37.5a12 12 0 0 1 12 12V27.5a12 12 0 0 1-12 12H8.5M8.5 39.5H39.5a12 12 0 0 1 12 12V59.5a12 12 0 0 1-12 12H8.5"/><path d="M118.5 0V80M68 55.5H134"/></g><polygon fill="${inner}" points="106,0 127,0 89,52 68,52"/></g>
<g transform="translate(144 36) scale(0.6)"><g fill="none" stroke="${word}" stroke-width="17"><path d="M8.5 0V80M53.5 0V80"/><path d="M78.5 0V80M78.5 8.5H120M78.5 40H115M78.5 71.5H120"/><path d="M303 8.5H267.5a12 12 0 0 0-12 12V28a12 12 0 0 0 12 12H282.5a12 12 0 0 1 12 12V59.5a12 12 0 0 1-12 12H247"/></g>
<g fill="${word}"><polygon points="0,0 20,0 62,80 42,80"/><polygon points="125,0 143,0 161,80 143,80"/><polygon points="143,80 161,80 183,0 165,0"/><polygon points="165,0 183,0 205,80 187,80"/><polygon points="187,80 205,80 223,0 205,0"/></g>
<polygon fill="${mark}" points="230,0 244,0 235,30 227,30"/></g></g></svg>`;
}

async function logo(tone: LogoTone, height: number): Promise<Block> {
  const input = await sharp(Buffer.from(logoSvg(tone, height))).png().toBuffer({ resolveWithObject: true });
  return { input: input.data, width: input.info.width, height: input.info.height };
}

/** The seal alone, for small sign-offs. */
async function seal(size: number, tone: 'red' | 'white'): Promise<Block> {
  const svg = logoSvg(tone === 'red' ? 'dark' : 'red', size).replace(/viewBox="0 0 334 124" width="\d+"/, `viewBox="0 0 124 124" width="${size}"`);
  const input = await sharp(Buffer.from(svg)).png().toBuffer();
  return { input, width: size, height: size };
}

// --- Images ----------------------------------------------------------------------
/** Cover-crop to w x h around the focal point (same rule as the site renditions). */
async function cover(photo: NonNullable<DesignInput['photo']>, w: number, h: number): Promise<Buffer> {
  const meta = await sharp(photo.data).metadata();
  const srcW = meta.width ?? w;
  const srcH = meta.height ?? h;
  const scale = Math.max(w / srcW, h / srcH);
  const rw = Math.max(w, Math.round(srcW * scale));
  const rh = Math.max(h, Math.round(srcH * scale));
  const left = Math.min(Math.max(Math.round(photo.focalX * rw - w / 2), 0), rw - w);
  const top = Math.min(Math.max(Math.round(photo.focalY * rh - h / 2), 0), rh - h);
  return sharp(photo.data).resize(rw, rh, { fit: 'fill' }).extract({ left, top, width: w, height: h }).png().toBuffer();
}

/** No photo: a dark brand background with the seal's orbit as a watermark. */
function brandBackground(w: number, h: number): Buffer {
  const r = Math.round(Math.max(w, h) * 0.42);
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#26262C"/><stop offset="1" stop-color="#0E0E10"/></linearGradient>
<radialGradient id="glow" cx="0.85" cy="0.15" r="0.6"><stop offset="0" stop-color="${C.brand}" stop-opacity="0.35"/><stop offset="1" stop-color="${C.brand}" stop-opacity="0"/></radialGradient></defs>
<rect width="${w}" height="${h}" fill="url(#g)"/><rect width="${w}" height="${h}" fill="url(#glow)"/>
<circle cx="${Math.round(w * 0.82)}" cy="${Math.round(h * 0.2)}" r="${r}" fill="none" stroke="#FFFFFF" stroke-opacity="0.06" stroke-width="${Math.round(r * 0.06)}"/>
</svg>`);
}

async function photoOrBrand(input: DesignInput, w: number, h: number): Promise<Buffer> {
  return input.photo ? cover(input.photo, w, h) : sharp(brandBackground(w, h)).png().toBuffer();
}

/** Rounds the corners of an image (for the photo card). */
async function rounded(image: Buffer, w: number, h: number, radius: number): Promise<Buffer> {
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${radius}" fill="#fff"/></svg>`);
  return sharp(image).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
}

const svgLayer = (W: number, H: number, body: string): Layer => ({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${body}</svg>`), top: 0, left: 0 });

/** Right-aligned (the start edge in Hebrew) at the frame's padding. */
const atStart = (f: Frame, b: Block, top: number, inset = 0): Layer => ({ input: b.input, top: Math.round(top), left: Math.round(f.W - f.pad - inset - b.width) });
const atEnd = (f: Frame, b: Block, top: number): Layer => ({ input: b.input, top: Math.round(top), left: f.pad });
const centered = (f: Frame, b: Block, top: number): Layer => ({ input: b.input, top: Math.round(top), left: Math.round((f.W - b.width) / 2) });

/** Stacks blocks upwards from `bottom`, each with the gap above it; returns the top of the stack. */
function stackUp(f: Frame, items: { block: Block | null; gapAbove: number; place?: 'start' | 'center' }[], bottom: number): number {
  let y = bottom;
  for (const item of items) {
    if (!item.block) continue;
    y -= item.block.height;
    f.layers.push(item.place === 'center' ? centered(f, item.block, y) : atStart(f, item.block, y));
    y -= item.gapAbove;
  }
  return y;
}

const ctaText = (site: string) => `לכתבה המלאה ← ${site}`;

// --- Templates ---------------------------------------------------------------------
/** Full-bleed photo, dark gradient, red section label, big white headline. */
async function headlineFrame(f: Frame, input: DesignInput) {
  const { W, H, pad, story } = f;
  const base = await photoOrBrand(input, W, H);
  f.layers.push(
    svgLayer(
      W,
      H,
      `<defs><linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="${story ? 0.3 : 0.25}" stop-color="#0B0B0D" stop-opacity="0"/><stop offset="0.62" stop-color="#0B0B0D" stop-opacity="0.72"/><stop offset="1" stop-color="#0B0B0D" stop-opacity="0.96"/></linearGradient>
<linearGradient id="t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.55"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient></defs>
<rect width="${W}" height="${H}" fill="url(#b)"/><rect width="${W}" height="${story ? 420 : 260}" fill="url(#t)"/><rect y="${H - 12}" width="${W}" height="12" fill="${C.brand}"/>`,
    ),
  );
  const mark = await logo('dark', story ? 84 : 76);
  f.layers.push(atStart(f, mark, story ? 210 : 56));

  const width = W - pad * 2;
  const bottom = story ? H - 330 : H - 64;
  const cta = story
    ? await chip(ctaText(input.site), { bg: C.white, color: C.brand, size: 34, padX: 34, padY: 18, radius: 40 })
    : await text(ctaText(input.site), { font: 'bold', size: 30, color: C.white, alpha: 0.9, width });
  const hook = await fit(input.hook, { font: 'medium', size: story ? 42 : 38, color: '#E8E8EC', width, leading: -0.08 }, story ? 250 : 165, 30);
  const headline = await fit(input.headline, { font: 'display', size: story ? 92 : 80, color: C.white, width, leading: -0.12 }, story ? 520 : 370, 52);
  const kicker = await chip(input.kicker, { bg: C.brand, color: C.white, size: story ? 34 : 30, padX: 22, padY: 10, radius: 8 });

  let y = bottom;
  if (cta) {
    y -= cta.height;
    f.layers.push(atStart(f, cta, y));
    y -= story ? 56 : 26;
    if (!story) {
      f.layers.push(svgLayer(W, H, `<rect x="${pad}" y="${y}" width="${width}" height="2" fill="#FFFFFF" fill-opacity="0.22"/>`));
      y -= 30;
    }
  }
  stackUp(
    f,
    [
      { block: hook, gapAbove: 26 },
      { block: headline, gapAbove: 26 },
      { block: kicker, gapAbove: 0 },
    ],
    y,
  );
  return base;
}

/** "מבזק": red band with a live dot, photo, white panel with a black headline. */
async function breakingFrame(f: Frame, input: DesignInput) {
  const { W, H, pad, story } = f;
  const band = story ? 300 : 140;
  const width = W - pad * 2;
  const bottom = story ? H - 330 : H - 56;
  const label = [input.kicker, input.time].filter(Boolean).join(' · ');
  const kicker = await text(label, { font: 'label', size: story ? 36 : 30, color: C.brand, width });
  const cta = await text(ctaText(input.site), { font: 'bold', size: story ? 34 : 28, color: C.brand, width });
  const headline = await fit(input.headline, { font: 'display', size: story ? 84 : 66, color: C.ink, width, leading: -0.1 }, story ? 300 : 230, 44);
  const hook = await fit(input.hook, { font: 'text', size: story ? 40 : 34, color: C.ink2, width, leading: -0.06 }, story ? 160 : 100, 28);
  // The photo takes whatever the text leaves.
  const gapTop = story ? 56 : 44;
  const textH = (kicker ? kicker.height + 16 : 0) + (headline?.height ?? 0) + (hook ? hook.height + 20 : 0);
  const ctaH = cta ? cta.height + 48 : 0;
  const photoH = Math.max(story ? 520 : 380, Math.min(story ? 1100 : 700, bottom - ctaH - textH - gapTop - 10 - band - (story ? 40 : 28)));

  const base = await sharp({ create: { width: W, height: H, channels: 3, background: C.white } }).png().toBuffer();
  f.layers.push({ input: await photoOrBrand(input, W, photoH), top: band, left: 0 });

  const bandTop = story ? 170 : 0; // stories: below the platform's progress bar and profile row
  const contentH = band - bandTop;
  const word = await text('מבזק', { font: 'display', size: story ? 64 : 56, color: C.white, width: 400 });
  const dotR = story ? 13 : 11;
  f.layers.push(
    svgLayer(
      W,
      H,
      `<rect width="${W}" height="${band}" fill="${C.brand}"/><rect y="${band + photoH}" width="${W}" height="10" fill="${C.brand}"/>` +
        `<circle cx="${W - pad - dotR}" cy="${bandTop + contentH / 2}" r="${dotR}" fill="#FFFFFF"/><circle cx="${W - pad - dotR}" cy="${bandTop + contentH / 2}" r="${dotR * 1.9}" fill="#FFFFFF" fill-opacity="0.28"/>`,
    ),
  );
  if (word) f.layers.push(atStart(f, word, bandTop + (contentH - word.height) / 2 - 2, dotR * 2 + 22));
  const mark = await logo('red', story ? 74 : 66);
  f.layers.push(atEnd(f, mark, bandTop + (contentH - mark.height) / 2));

  let y = band + photoH + 10 + gapTop;
  for (const [block, gap] of [
    [kicker, 16],
    [headline, 20],
    [hook, 0],
  ] as const) {
    if (!block) continue;
    f.layers.push(atStart(f, block, y));
    y += block.height + gap;
  }
  if (cta) {
    f.layers.push(svgLayer(W, H, `<rect x="${pad}" y="${bottom - cta.height - 26}" width="${width}" height="2" fill="${C.line}"/>`));
    f.layers.push(atStart(f, cta, bottom - cta.height));
  }
  return base;
}

/** "משפט מפתח": photo on top fading into dark, a red quote mark and the key sentence. */
async function quoteFrame(f: Frame, input: DesignInput) {
  const { W, H, pad, story } = f;
  const photoH = Math.round(H * (story ? 0.4 : 0.42));
  const base = await sharp({ create: { width: W, height: H, channels: 3, background: C.night } }).png().toBuffer();
  f.layers.push({ input: await photoOrBrand(input, W, photoH), top: 0, left: 0 });
  const q = story ? 1.25 : 1;
  const qx = W - pad - 112 * q;
  const qy = photoH - 40 * q;
  f.layers.push(
    svgLayer(
      W,
      H,
      `<defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.night}" stop-opacity="0.15"/><stop offset="0.55" stop-color="${C.night}" stop-opacity="0.35"/><stop offset="1" stop-color="${C.night}" stop-opacity="1"/></linearGradient>
<linearGradient id="t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.5"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient></defs>
<rect width="${W}" height="${photoH + 2}" fill="url(#f)"/><rect width="${W}" height="${story ? 420 : 240}" fill="url(#t)"/>
<g transform="translate(${qx} ${qy}) scale(${q})" fill="${C.brand}"><path d="M0 50 Q0 0 46 0 L46 18 Q22 22 21 46 L46 46 L46 96 L0 96 Z"/><path d="M62 50 Q62 0 108 0 L108 18 Q84 22 83 46 L108 46 L108 96 L62 96 Z"/></g>`,
    ),
  );
  f.layers.push(atStart(f, await logo('dark', story ? 80 : 70), story ? 210 : 52));

  const width = W - pad * 2;
  const statement = input.hook || input.headline;
  const context = input.hook ? input.headline : '';
  const top = qy + 96 * q + (story ? 48 : 36);
  const bottom = story ? H - 330 : H - 64;
  const sign = await seal(story ? 64 : 56, 'red');
  const cta = await text(ctaText(input.site), { font: 'bold', size: story ? 34 : 28, color: C.white, alpha: 0.85, width: width - sign.width - 24 });
  const footer = Math.max(sign.height, cta?.height ?? 0);
  const kicker = await chip(input.kicker, { bg: C.brand, color: C.white, size: story ? 32 : 28, padX: 18, padY: 8, radius: 8 });
  const area = bottom - footer - 44 - top;
  const room = area - (kicker ? kicker.height + 24 : 0);
  const main = await fit(statement, { font: 'label', size: story ? 70 : 58, color: C.white, width, leading: -0.06 }, Math.round(room * (context ? 0.7 : 1)), 38);
  const ctxRoom = room - (main ? main.height + 40 : 0) - 8;
  const sub = context && ctxRoom > 50 ? await fit(context, { font: 'medium', size: story ? 38 : 32, color: '#C9C9CF', width, leading: -0.08 }, ctxRoom, 26) : null;

  // Centered in the space between the quote mark and the footer.
  const used = (kicker ? kicker.height + 24 : 0) + (main ? main.height + 28 : 0) + (sub ? sub.height + 26 : 0);
  let y = top + Math.max(0, Math.round((area - used) / 2.4));
  if (kicker) {
    f.layers.push(atStart(f, kicker, y));
    y += kicker.height + 24;
  }
  if (main) {
    f.layers.push(atStart(f, main, y));
    y += main.height + 28;
  }
  if (sub) {
    f.layers.push(svgLayer(W, H, `<rect x="${W - pad - 90}" y="${y}" width="90" height="6" rx="3" fill="${C.brand}"/>`));
    f.layers.push(atStart(f, sub, y + 26));
  }
  f.layers.push(atEnd(f, sign, bottom - sign.height));
  if (cta) f.layers.push(atStart(f, cta, bottom - footer / 2 - cta.height / 2));
  return base;
}

/** "מדריך": light page, rounded photo card, dark headline, red footer. */
async function explainerFrame(f: Frame, input: DesignInput) {
  const { W, H, pad, story } = f;
  const base = await sharp({ create: { width: W, height: H, channels: 3, background: C.stone } }).png().toBuffer();
  const headerTop = story ? 200 : 52;
  const mark = await logo('light', story ? 76 : 66);
  f.layers.push(atStart(f, mark, headerTop));
  const kicker = await chip(input.kicker, { bg: C.ink, color: C.white, size: story ? 32 : 28, padX: 20, padY: 9, radius: 30 });
  if (kicker) f.layers.push(atEnd(f, kicker, headerTop + (mark.height - kicker.height) / 2));

  const width = W - pad * 2;
  const footerH = story ? 0 : 104;
  const bottom = story ? H - 330 : H - footerH - 44;
  const cta = story ? await chip(ctaText(input.site), { bg: C.brand, color: C.white, size: 34, padX: 34, padY: 18, radius: 40 }) : null;
  const headline = await fit(input.headline, { font: 'display', size: story ? 80 : 66, color: C.ink, width, leading: -0.1 }, story ? 300 : 230, 42);
  const hook = await fit(input.hook, { font: 'text', size: story ? 40 : 34, color: C.ink2, width, leading: -0.06 }, story ? 200 : 110, 26);

  // The photo card takes whatever the text leaves.
  const cardTop = headerTop + mark.height + (story ? 40 : 30);
  const gap = story ? 52 : 40;
  const textH = (headline?.height ?? 0) + (hook ? hook.height + 22 : 0) + (cta ? cta.height + 56 : 0);
  const cardW = W - pad * 2;
  const cardH = Math.max(story ? 560 : 400, Math.min(story ? 1000 : 660, bottom - textH - gap - cardTop));
  f.layers.push({ input: await rounded(await photoOrBrand(input, cardW, cardH), cardW, cardH, 28), top: cardTop, left: pad });

  let y = cardTop + cardH + gap;
  if (headline) {
    f.layers.push(svgLayer(W, H, `<rect x="${W - pad + 26}" y="${y + 8}" width="8" height="${Math.min(headline.height - 12, 220)}" rx="4" fill="${C.brand}"/>`));
    f.layers.push(atStart(f, headline, y));
    y += headline.height + 22;
  }
  if (hook) f.layers.push(atStart(f, hook, y));

  if (story && cta) f.layers.push(centered(f, cta, bottom - cta.height));
  if (!story) {
    f.layers.push(svgLayer(W, H, `<rect y="${H - footerH}" width="${W}" height="${footerH}" fill="${C.brand}"/>`));
    const line = await text(ctaText(input.site), { font: 'bold', size: 32, color: C.white, width: width - 80 });
    if (line) f.layers.push(atStart(f, line, H - footerH + (footerH - line.height) / 2));
    const s = await seal(58, 'white');
    f.layers.push(atEnd(f, s, H - footerH + (footerH - s.height) / 2));
  }
  return base;
}

const TEMPLATES: Record<ShareTemplate, (f: Frame, input: DesignInput) => Promise<Buffer>> = {
  headline: headlineFrame,
  breaking: breakingFrame,
  quote: quoteFrame,
  explainer: explainerFrame,
};

/** Renders one design as a JPEG (what the networks require). */
export async function renderDesign(input: DesignInput): Promise<Buffer> {
  const { width: W, height: H } = SHARE_SIZES[input.format];
  const frame: Frame = { W, H, pad: 72, story: input.format === 'story', layers: [] };
  const base = await TEMPLATES[input.template](frame, input);
  return sharp(base).composite(frame.layers).flatten({ background: C.white }).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
}
