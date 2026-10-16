// Renders the site's share picture and phone icons from the brand SVGs and fonts:
// the link preview of pages without their own picture (WhatsApp, Facebook), the icon iPhones
// put on the home screen, and the icons of the web manifest (Android).
//   node brand/scripts/render-web-icons.mjs
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const brand = (f) => fileURLToPath(new URL(`../${f}`, import.meta.url));
const web = (f) => fileURLToPath(new URL(`../../apps/web/${f}`, import.meta.url));
const font = (f) => fileURLToPath(new URL(`../../node_modules/@expo-google-fonts/${f}`, import.meta.url));

const C = { red: '#D9121F', redSoft: '#FFE3E5', white: '#FFFFFF' };
const FONTS = {
  display: { name: 'Rubik ExtraBold', file: font('rubik/800ExtraBold/Rubik_800ExtraBold.ttf') },
  body: { name: 'Heebo Medium', file: font('heebo/500Medium/Heebo_500Medium.ttf') },
};
const CATEGORIES = 'כלכלה ישראלית  ·  שוק ההון  ·  נדל״ן  ·  הייטק  ·  ביטוח  ·  צרכנות';

const svg = async (f) => (await readFile(brand(f))).toString();

/** An SVG rendered crisply at the given width. */
async function vector(source, width) {
  const r = await sharp(Buffer.from(source), { density: 1200 }).resize({ width }).png().toBuffer({ resolveWithObject: true });
  return { input: r.data, width: r.info.width, height: r.info.height };
}

const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** One line of text (Hebrew is laid out right to left by Pango). Size in pixels. */
async function text(content, { face = 'display', size, color }) {
  const f = FONTS[face];
  const r = await sharp({ text: { text: `<span foreground="${color}">${escape(content)}</span>`, font: `${f.name} ${size}`, fontfile: f.file, rgba: true, dpi: 72 } })
    .png()
    .toBuffer({ resolveWithObject: true });
  return { input: r.data, width: r.info.width, height: r.info.height };
}

const centered = (layer, W, top) => ({ input: layer.input, left: Math.round((W - layer.width) / 2), top: Math.round(top) });

// --- The share picture: 1200x630, the size every network shows large ----------------------
// Apps crop the sides on some screens, so everything sits in the middle.
async function sharePicture() {
  const W = 1200;
  const H = 630;
  const lockup = await vector(await svg('b4-logo-white.svg'), 560);
  const tagline = await text('חדשות. כלכלה. לפני כולם.', { size: 56, color: C.white });
  const categories = await text(CATEGORIES, { face: 'body', size: 26, color: C.redSoft });
  const rule = { input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="6"><rect width="80" height="6" rx="3" fill="${C.white}"/></svg>`), width: 80, height: 6 };
  const block = lockup.height + 34 + rule.height + 30 + tagline.height + 24 + categories.height;
  let y = (H - block) / 2;
  const layers = [centered(lockup, W, y)];
  y += lockup.height + 34;
  layers.push(centered(rule, W, y));
  y += rule.height + 30;
  layers.push(centered(tagline, W, y));
  y += tagline.height + 24;
  layers.push(centered(categories, W, y));
  await sharp({ create: { width: W, height: H, channels: 3, background: C.red } })
    .composite(layers)
    .jpeg({ quality: 88, mozjpeg: true })
    .toFile(web('app/opengraph-image.jpg'));
  console.log('  app/opengraph-image.jpg (1200x630)');
}

// --- Phone icons: the red seal, full bleed (the phone rounds the corners itself) ----------
async function icons() {
  const icon = (await svg('b4-icon.svg')).replace('rx="26"', 'rx="0"');
  const square = (size) => sharp(Buffer.from(icon), { density: 1200 }).resize(size, size).png({ compressionLevel: 9 });
  await square(180).toFile(web('app/apple-icon.png'));
  await square(192).toFile(web('public/brand/icon-192.png'));
  await square(512).toFile(web('public/brand/icon-512.png'));
  console.log('  app/apple-icon.png (180), public/brand/icon-192.png, public/brand/icon-512.png');
}

console.log('Web share picture and icons:');
await sharePicture();
await icons();
