// Renders the Facebook page kit from the brand SVGs and fonts (Rubik, Heebo):
// profile pictures, cover photos and the pinned welcome post.
//   node brand/scripts/render-facebook.mjs
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const brand = (f) => fileURLToPath(new URL(`../${f}`, import.meta.url));
const out = (f) => fileURLToPath(new URL(`../facebook/${f}`, import.meta.url));
const font = (f) => fileURLToPath(new URL(`../../node_modules/@expo-google-fonts/${f}`, import.meta.url));

const C = { red: '#D9121F', redSoft: '#FFE3E5', ink: '#121214', night: '#1C1C20', ink2: '#4A4A52', mist: '#C9C9D0', stone: '#F4F3F1', line: '#E6E4E1', white: '#FFFFFF' };
const FONTS = {
  display: { name: 'Rubik ExtraBold', file: font('rubik/800ExtraBold/Rubik_800ExtraBold.ttf') },
  displayBold: { name: 'Rubik Bold', file: font('rubik/700Bold/Rubik_700Bold.ttf') },
  body: { name: 'Heebo Medium', file: font('heebo/500Medium/Heebo_500Medium.ttf') },
  bodyBold: { name: 'Heebo Bold', file: font('heebo/700Bold/Heebo_700Bold.ttf') },
};

const svg = async (f) => (await readFile(brand(f))).toString();
const logoLight = await svg('b4-logo.svg'); // red seal, ink NEW'S
const logoDark = await svg('b4-logo-dark.svg'); // red seal, white NEW'S
const logoOnRed = await svg('b4-logo-white.svg'); // white seal with red B4, white NEW'S
const mark = await svg('b4-mark.svg');
// The seal's orbit and B4 without the red disc, in one color (for a red or dark background).
const markLines = (color) => mark.replace('<circle cx="60" cy="60" r="58" fill="#D9121F"/>', '').replace(/#FFFFFF/g, color);

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

async function canvas(width, height, background, layers, file) {
  await sharp({ create: { width, height, channels: 4, background } })
    .composite(layers)
    .png({ compressionLevel: 9 })
    .toFile(out(file));
  console.log(`  ${file} (${width}x${height})`);
}

// --- Profile pictures: 2048x2048, shown as a circle --------------------------------
async function profiles() {
  const S = 2048;
  const onRed = await vector(markLines(C.white), 1640);
  await canvas(S, S, C.red, [centered(onRed, S, (S - onRed.height) / 2)], 'profile-red.png');
  const seal = await vector(mark, 1700);
  await canvas(S, S, C.white, [centered(seal, S, (S - seal.height) / 2)], 'profile-white.png');
  await canvas(S, S, C.ink, [centered(seal, S, (S - seal.height) / 2)], 'profile-dark.png');
}

// --- Cover photos: 1640x856 ----------------------------------------------------------
// Desktop shows the middle 1640x624 band, phones the middle 1522x856; the profile
// picture covers a bottom corner (left in English, right in Hebrew). Everything that
// matters sits in the centre, inside x 160-1480, y 150-700.
const W = 1640;
const H = 856;
const CATEGORIES = 'כלכלה ישראלית  ·  שוק ההון  ·  נדל״ן  ·  הייטק  ·  ביטוח  ·  צרכנות  ·  תיירות';

/** The seal's open orbit, large and faint, with the point running ahead. */
function orbit({ cx, cy, r, stroke, width, point }) {
  const a = (deg) => [cx + r * Math.cos((deg * Math.PI) / 180), cy + r * Math.sin((deg * Math.PI) / 180)];
  const [sx, sy] = a(-90);
  const [ex, ey] = a(-30);
  const [px, py] = a(-58);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><path d="M${sx} ${sy}A${r} ${r} 0 1 0 ${ex} ${ey}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round"/><circle cx="${px}" cy="${py}" r="${width * 2.6}" fill="${point}"/></svg>`,
  );
}

async function cover(file, { background, logo, tagline, categories, rule, deco }) {
  const lockup = await vector(logo, 600);
  const line1 = await text('חדשות. כלכלה. לפני כולם.', { size: 64, color: tagline });
  const line2 = await text(CATEGORIES, { face: 'body', size: 29, color: categories });
  const top = 214;
  const ruleTop = top + lockup.height + 34;
  const layers = [
    { input: deco, left: 0, top: 0 },
    centered(lockup, W, top),
    { input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="88" height="6"><rect width="88" height="6" rx="3" fill="${rule}"/></svg>`), left: (W - 88) / 2, top: ruleTop },
    centered(line1, W, ruleTop + 34),
    centered(line2, W, ruleTop + 34 + line1.height + 30),
  ];
  await canvas(W, H, background, layers, file);
}

async function covers() {
  await cover('cover-dark.png', {
    background: C.ink,
    logo: logoDark,
    tagline: C.white,
    categories: C.mist,
    rule: C.red,
    deco: orbit({ cx: -150, cy: 640, r: 500, stroke: '#24242A', width: 7, point: C.red }),
  });
  await cover('cover-red.png', {
    background: C.red,
    logo: logoOnRed,
    tagline: C.white,
    categories: C.redSoft,
    rule: C.white,
    deco: orbit({ cx: -150, cy: 640, r: 500, stroke: '#C80F1B', width: 7, point: C.white }),
  });
  await cover('cover-light.png', {
    background: C.stone,
    logo: logoLight,
    tagline: C.ink,
    categories: C.ink2,
    rule: C.red,
    deco: orbit({ cx: -150, cy: 640, r: 500, stroke: C.line, width: 7, point: C.red }),
  });
}

// --- The pinned welcome post: 1080x1350 (4:5, the largest a feed shows) ---------------
async function welcomePost() {
  const PW = 1080;
  const PH = 1350;
  const band = 470;
  const lockup = await vector(logoOnRed, 640);
  const title = await text('ברוכים הבאים ל-B4 NEW\'S', { size: 74, color: C.ink });
  const points = ['חדשות הכלכלה החשובות של היום', 'שוק ההון, נדל״ן, הייטק וצרכנות', 'בשפה ברורה, בלי ז׳רגון'];
  const lines = await Promise.all(points.map((p) => text(p, { face: 'body', size: 44, color: C.ink2 })));
  const cta = await text('עקבו אחרינו וקבלו את המבזקים ראשונים', { face: 'displayBold', size: 42, color: C.red });
  const foot = await text('חדשות. כלכלה. לפני כולם.', { size: 40, color: C.white });

  const right = PW - 110; // Hebrew lines start on the right
  const footH = 150;
  const dot = (size) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="${C.red}"/></svg>`);
  // The text block sits in the middle of the white area between the red band and the footer.
  const gapTitle = 72;
  const gapLine = 44;
  const gapCta = 84;
  const block = title.height + gapTitle + lines.reduce((sum, l) => sum + l.height, 0) + gapLine * (lines.length - 1) + gapCta + cta.height;
  let y = band + (PH - footH - band - block) / 2;
  const layers = [
    { input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${PW}" height="${band}"><rect width="${PW}" height="${band}" fill="${C.red}"/></svg>`), left: 0, top: 0 },
    centered(lockup, PW, (band - lockup.height) / 2),
    { input: title.input, left: right - title.width, top: Math.round(y) },
  ];
  y += title.height + gapTitle;
  for (const l of lines) {
    layers.push({ input: dot(20), left: right - 20, top: Math.round(y + l.height / 2 - 10) });
    layers.push({ input: l.input, left: right - 20 - 26 - l.width, top: Math.round(y) });
    y += l.height + gapLine;
  }
  layers.push({ input: cta.input, left: right - cta.width, top: Math.round(y - gapLine + gapCta) });
  layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${PW}" height="${footH}"><rect width="${PW}" height="${footH}" fill="${C.ink}"/></svg>`), left: 0, top: PH - footH });
  layers.push(centered(foot, PW, PH - footH + (footH - foot.height) / 2));
  await canvas(PW, PH, C.white, layers, 'welcome-post.png');
}

console.log('Facebook kit:');
await profiles();
await covers();
await welcomePost();
