// Development only: flat editorial illustrations for the sample articles, one
// motif per section, in the brand palette. No text (fonts vary by machine).
import { type Db, and, articles, categories, eq, isNull, mediaAssets, sql } from '@b4/db';
import sharp from 'sharp';
import { ingestImage } from '../lib/images';
import type { MediaStorage } from '../lib/storage';

type Palette = { from: string; to: string; accent: string };

const PALETTES: Record<string, Palette> = {
  'israeli-economy': { from: '#1C2836', to: '#3E5773', accent: '#D9121F' },
  'global-economy': { from: '#17302C', to: '#2F6B62', accent: '#F2C94C' },
  'capital-market': { from: '#121214', to: '#2B2F3A', accent: '#2E9E5B' },
  'real-estate': { from: '#3A3124', to: '#86734F', accent: '#F4F3F1' },
  insurance: { from: '#1D4E89', to: '#3D7BD9', accent: '#FFFFFF' },
  'hi-tech': { from: '#2A2233', to: '#5B4B70', accent: '#7FC8A9' },
  health: { from: '#2E1416', to: '#8E2A31', accent: '#FFE3E5' },
  automotive: { from: '#23262E', to: '#4A505C', accent: '#E8742D' },
  entertainment: { from: '#40354F', to: '#7B4FD1', accent: '#F2C94C' },
  consumerism: { from: '#33281F', to: '#735A44', accent: '#E5B710' },
  tourism: { from: '#1B4F72', to: '#5DADE2', accent: '#FFFFFF' },
  'the-consultants': { from: '#1C1C20', to: '#3A3A40', accent: '#D9121F' },
  'the-new-ceo': { from: '#2B3B50', to: '#55708F', accent: '#F2C94C' },
};

/** Motifs drawn in a 200x200 box (white strokes/fills; the accent where noted). */
const MOTIFS: Record<string, (accent: string) => string> = {
  'israeli-economy': (a) =>
    `<rect x="30" y="110" width="26" height="60" rx="4" fill="#fff"/><rect x="70" y="80" width="26" height="90" rx="4" fill="#fff"/><rect x="110" y="55" width="26" height="115" rx="4" fill="${a}"/><rect x="150" y="95" width="26" height="75" rx="4" fill="#fff"/><path d="M28 70 L80 48 L118 30 L172 18" stroke="#fff" stroke-width="7" fill="none" stroke-linecap="round"/>`,
  'global-economy': (a) =>
    `<circle cx="100" cy="100" r="70" fill="none" stroke="#fff" stroke-width="7"/><ellipse cx="100" cy="100" rx="32" ry="70" fill="none" stroke="#fff" stroke-width="6"/><path d="M30 100 H170 M42 62 H158 M42 138 H158" stroke="#fff" stroke-width="6"/><circle cx="160" cy="45" r="16" fill="${a}"/>`,
  'capital-market': (a) =>
    `<path d="M20 160 L60 120 L90 135 L130 80 L180 40" stroke="${a}" stroke-width="9" fill="none" stroke-linecap="round" stroke-linejoin="round"/><rect x="40" y="60" width="16" height="50" fill="#fff"/><path d="M48 45 V125" stroke="#fff" stroke-width="4"/><rect x="100" y="95" width="16" height="45" fill="#fff" opacity=".7"/><path d="M108 80 V155" stroke="#fff" stroke-width="4" opacity=".7"/><rect x="150" y="110" width="16" height="40" fill="#fff"/><path d="M158 98 V165" stroke="#fff" stroke-width="4"/>`,
  'real-estate': (a) =>
    `<path d="M30 105 L100 45 L170 105" stroke="#fff" stroke-width="9" fill="none" stroke-linejoin="round"/><rect x="50" y="100" width="100" height="70" fill="#fff"/><rect x="88" y="130" width="24" height="40" fill="${a}"/><rect x="62" y="115" width="18" height="18" fill="#9AA5B1"/><rect x="120" y="115" width="18" height="18" fill="#9AA5B1"/>`,
  insurance: (a) =>
    `<path d="M100 25 L165 50 V100 C165 140 135 165 100 178 C65 165 35 140 35 100 V50 Z" fill="#fff"/><path d="M70 100 L92 122 L135 78" stroke="${a === '#FFFFFF' ? '#1D4E89' : a}" stroke-width="12" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  'hi-tech': (a) =>
    `<rect x="55" y="55" width="90" height="90" rx="10" fill="#fff"/><rect x="78" y="78" width="44" height="44" rx="4" fill="${a}"/>${[70, 90, 110, 130].map((p) => `<path d="M${p} 35 V55 M${p} 145 V165 M35 ${p} H55 M145 ${p} H165" stroke="#fff" stroke-width="6" stroke-linecap="round"/>`).join('')}`,
  health: (a) =>
    `<path d="M100 170 C60 140 25 110 25 72 C25 45 45 28 68 28 C83 28 94 36 100 48 C106 36 117 28 132 28 C155 28 175 45 175 72 C175 110 140 140 100 170 Z" fill="#fff"/><path d="M40 95 H75 L88 70 L105 120 L118 95 H160" stroke="${a === '#FFE3E5' ? '#D9121F' : a}" stroke-width="8" fill="none" stroke-linejoin="round" stroke-linecap="round"/>`,
  automotive: (a) =>
    `<path d="M25 125 L40 90 C45 80 52 75 62 75 H138 C148 75 155 80 160 90 L175 125 V145 H25 Z" fill="#fff"/><path d="M58 92 H142 L150 115 H50 Z" fill="${a}" opacity=".9"/><circle cx="60" cy="148" r="18" fill="#23262E" stroke="#fff" stroke-width="6"/><circle cx="140" cy="148" r="18" fill="#23262E" stroke="#fff" stroke-width="6"/>`,
  entertainment: (a) =>
    `<rect x="35" y="70" width="130" height="95" rx="8" fill="#fff"/><path d="M35 70 L165 45 L170 70 Z" fill="${a}"/><path d="M60 64 L75 52 M95 58 L110 45 M130 51 L145 40" stroke="#40354F" stroke-width="6"/><path d="M88 95 L125 117 L88 140 Z" fill="#7B4FD1"/>`,
  consumerism: (a) =>
    `<path d="M25 45 H50 L70 130 H155 L170 70 H58" stroke="#fff" stroke-width="9" fill="none" stroke-linejoin="round" stroke-linecap="round"/><circle cx="80" cy="155" r="12" fill="#fff"/><circle cx="145" cy="155" r="12" fill="#fff"/><rect x="85" y="80" width="28" height="30" rx="3" fill="${a}"/><rect x="118" y="88" width="24" height="22" rx="3" fill="#fff" opacity=".8"/>`,
  tourism: (a) =>
    `<path d="M30 112 L170 60 C182 56 188 66 178 74 L120 112 L105 165 L90 168 L95 125 L60 140 L55 158 L45 160 L45 132 Z" fill="#fff"/><circle cx="160" cy="150" r="22" fill="${a}" opacity=".9"/><path d="M20 180 C60 165 140 165 185 180" stroke="#fff" stroke-width="5" fill="none" opacity=".6"/>`,
  'the-consultants': (a) =>
    `<path d="M30 40 H170 C176 40 180 44 180 50 V130 C180 136 176 140 170 140 H80 L45 168 V140 H30 C24 140 20 136 20 130 V50 C20 44 24 40 30 40 Z" fill="#fff"/><path d="M50 115 L80 90 L105 102 L150 65" stroke="${a}" stroke-width="9" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  'the-new-ceo': (a) =>
    `<rect x="30" y="70" width="140" height="95" rx="10" fill="#fff"/><path d="M75 70 V55 C75 48 80 43 87 43 H113 C120 43 125 48 125 55 V70" stroke="#fff" stroke-width="8" fill="none"/><rect x="30" y="100" width="140" height="10" fill="${a}"/><rect x="88" y="94" width="24" height="22" rx="3" fill="#2B3B50"/>`,
};

function hash(s: string): number {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}

export function illustrationSvg(category: string, seedText: string, W = 1600, H = 900): string {
  const p = PALETTES[category] ?? PALETTES['israeli-economy']!;
  const motif = (MOTIFS[category] ?? MOTIFS['israeli-economy']!)(p.accent);
  const h = hash(seedText);
  const r = (shift: number) => ((h >> shift) & 255) / 255;
  const portrait = H > W;
  const size = (portrait ? W * 0.62 : 520) + r(3) * 120;
  const mx = (portrait ? W * 0.5 : W * (0.56 + r(7) * 0.14)) - size / 2;
  const my = (H - size) / 2 + (r(11) - 0.5) * 80;
  const ringX = W * (0.2 + r(15) * 0.2);
  const ringY = H * (0.25 + r(19) * 0.4);
  const dots = Array.from({ length: 6 }, (_, i) => Array.from({ length: 4 }, (_, j) => `<circle cx="${120 + i * 34}" cy="${H - 200 + j * 34}" r="5" fill="#fff" opacity=".18"/>`).join('')).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p.from}"/><stop offset="1" stop-color="${p.to}"/></linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#000" flood-opacity=".35"/></filter>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <circle cx="${ringX}" cy="${ringY}" r="${210 + r(23) * 90}" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="40"/>
  <circle cx="${portrait ? W * 0.5 : W * 0.62}" cy="${H * 0.5}" r="${330 + r(27) * 40}" fill="#fff" fill-opacity=".06"/>
  ${dots}
  <g transform="translate(${mx} ${my}) scale(${size / 200})" filter="url(#shadow)">${motif}</g>
</svg>`;
}

/**
 * Gives every sample article without an image an illustration of its section.
 * Only articles that did not come through the CMS (no draft) are touched.
 */
export async function illustrateSampleArticles(db: Db, storage: MediaStorage, log: (msg: string) => void): Promise<string[]> {
  const rows = await db
    .select({ id: articles.id, slug: articles.slug, title: articles.title, category: categories.slug })
    .from(articles)
    .innerJoin(categories, eq(articles.categoryId, categories.id))
    .where(and(isNull(articles.heroMediaId), isNull(articles.draftId)));
  if (rows.length === 0) return [];
  log(`Drawing illustrations for ${rows.length} sample articles…`);
  for (const a of rows) {
    const png = await sharp(Buffer.from(illustrationSvg(a.category, `${a.id}:${a.title}`))).png().toBuffer();
    const media = await ingestImage(db, storage, png, { kind: 'upload', alt: a.title, credit: 'איור: B4' });
    await db.update(articles).set({ heroMediaId: media.id }).where(eq(articles.id, a.id));
  }
  const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(mediaAssets);
  log(`Sample illustrations ready (${n} images in the media library).`);
  return rows.map((r) => r.slug);
}
