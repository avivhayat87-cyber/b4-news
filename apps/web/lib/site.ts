import type { CategoryRef, Tone } from './types';

export const SITE = {
  name: "B4 NEW'S",
  short: 'B4',
  tagline: 'חדשות כלכלה. לפני כולם.',
  description: 'חדשות כלכלה, שוק ההון, נדל״ן, הייטק, ביטוח וצרכנות, בשפה ברורה.',
  url: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
};

// Mirrors the categories seeded in db/schema.sql.
export const CATEGORIES: CategoryRef[] = [
  { slug: 'israeli-economy', name: 'כלכלה ישראלית' },
  { slug: 'global-economy', name: 'כלכלה עולמית' },
  { slug: 'capital-market', name: 'שוק ההון' },
  { slug: 'real-estate', name: 'נדל״ן' },
  { slug: 'insurance', name: 'ביטוח' },
  { slug: 'hi-tech', name: 'הייטק' },
  { slug: 'health', name: 'בריאות' },
  { slug: 'automotive', name: 'רכב' },
  { slug: 'entertainment', name: 'בידור' },
  { slug: 'consumerism', name: 'צרכנות' },
  { slug: 'the-consultants', name: 'היועצים' },
  { slug: 'the-new-ceo', name: 'המנכ״ל החדש' },
];

export function categoryBySlug(slug: string): CategoryRef | undefined {
  return CATEGORIES.find((category) => category.slug === slug);
}

// TODO: replace '#' with the real profile and channel URLs.
export const SOCIAL = [
  { key: 'facebook', label: 'פייסבוק', href: '#' },
  { key: 'instagram', label: 'אינסטגרם', href: '#' },
  { key: 'telegram', label: 'טלגרם', href: '#' },
  { key: 'whatsapp', label: 'וואטסאפ', href: '#' },
  { key: 'x', label: 'X', href: '#' },
  { key: 'tiktok', label: 'טיקטוק', href: '#' },
  { key: 'youtube', label: 'יוטיוב', href: '#' },
] as const;

export type SocialKey = (typeof SOCIAL)[number]['key'];

export const CHANNELS = {
  app: '#',
  telegram: '#',
  whatsapp: '#',
};

export const articleHref = (article: { slug: string }) => `/article/${article.slug}`;
export const categoryHref = (slug: string) => `/category/${slug}`;

const TONES: Record<Tone, string> = {
  graphite: 'linear-gradient(135deg, #23262E 0%, #4A505C 100%)',
  steel: 'linear-gradient(135deg, #1C2836 0%, #3E5773 100%)',
  bronze: 'linear-gradient(135deg, #33281F 0%, #735A44 100%)',
  teal: 'linear-gradient(135deg, #17302C 0%, #3E6A62 100%)',
  plum: 'linear-gradient(135deg, #2A2233 0%, #5B4B70 100%)',
  sand: 'linear-gradient(135deg, #3A3124 0%, #86734F 100%)',
  wine: 'linear-gradient(135deg, #2E1416 0%, #6E2A2F 100%)',
};
const TONE_ORDER: Tone[] = ['steel', 'graphite', 'sand', 'teal', 'plum', 'bronze', 'wine'];

/** Background shown behind an image while it loads, or instead of a missing one. */
export function toneBackground(tone: Tone | undefined, seed: number): string {
  return TONES[tone ?? TONE_ORDER[Math.abs(seed) % TONE_ORDER.length]];
}
