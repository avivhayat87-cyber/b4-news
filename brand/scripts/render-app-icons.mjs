// Renders the app's PNG icons from the brand SVGs.
//   node brand/scripts/render-app-icons.mjs
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const brand = (f) => fileURLToPath(new URL(`../${f}`, import.meta.url));
const out = (f) => fileURLToPath(new URL(`../../apps/mobile/assets/images/${f}`, import.meta.url));

const RED = '#D9121F';
const icon = await readFile(brand('b4-icon.svg'));
const mark = await readFile(brand('b4-mark.svg'));

// The seal artwork without its red disc: white orbit + white B4, for Android's adaptive foreground.
const markWhite = Buffer.from(
  mark
    .toString()
    .replace('<circle cx="60" cy="60" r="58" fill="#D9121F"/>', '')
    .replace(/#D9121F/g, '#FFFFFF'),
);

const square = (svg, size) => sharp(svg, { density: 1200 }).resize(size, size).png();

// iOS / generic icon: full-bleed red square (the OS applies the corner mask).
const fullBleed = Buffer.from(icon.toString().replace('rx="26"', 'rx="0"'));
await square(fullBleed, 1024).toFile(out('icon.png'));

// Android adaptive icon: foreground art inside the 66% safe zone, red background layer.
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: await square(markWhite, 600).toBuffer(), gravity: 'center' }])
  .png()
  .toFile(out('android-icon-foreground.png'));
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: RED } }).png().toFile(out('android-icon-background.png'));
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: await square(markWhite, 600).toBuffer(), gravity: 'center' }])
  .png()
  .toFile(out('android-icon-monochrome.png'));

// Splash: the seal on white. Favicon for the web build.
await square(mark, 512).toFile(out('splash-icon.png'));
await square(mark, 64).toFile(out('favicon.png'));

console.log('App icons rendered.');
