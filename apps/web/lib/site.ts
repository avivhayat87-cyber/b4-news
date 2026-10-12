import { CATEGORIES as ALL_CATEGORIES, findCategory } from '@b4/shared';
import type { CategoryRef } from './types';

export const SITE = {
  name: "B4 NEW'S",
  short: 'B4',
  tagline: 'חדשות. כלכלה. לפני כולם.',
  description: 'חדשות כלכלה, שוק ההון, נדל״ן, הייטק, ביטוח, צרכנות ותיירות, בשפה ברורה.',
  url: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
};

export const CATEGORIES: CategoryRef[] = ALL_CATEGORIES.map((c) => ({ slug: c.slug, name: c.name }));

export function categoryBySlug(slug: string): CategoryRef | undefined {
  const c = findCategory(slug);
  return c ? { slug: c.slug, name: c.name } : undefined;
}

/** Social profiles in display order. The addresses come from the CMS (Settings > site details); empty ones are hidden. */
export const SOCIAL = [
  { key: 'facebook', label: 'פייסבוק' },
  { key: 'instagram', label: 'אינסטגרם' },
  { key: 'telegram', label: 'טלגרם' },
  { key: 'whatsapp', label: 'וואטסאפ' },
  { key: 'x', label: 'X' },
  { key: 'tiktok', label: 'טיקטוק' },
  { key: 'youtube', label: 'יוטיוב' },
] as const;

export type SocialKey = (typeof SOCIAL)[number]['key'];

export function socialLinks(links: Record<string, string>): { key: SocialKey; label: string; href: string }[] {
  return SOCIAL.flatMap((s) => (links[s.key] ? [{ ...s, href: links[s.key]! }] : []));
}
export const articleHref = (article: { slug: string }) => `/article/${article.slug}`;
export const categoryHref = (slug: string) => `/category/${slug}`;

const TONES = [
  'linear-gradient(135deg, #1C2836 0%, #3E5773 100%)',
  'linear-gradient(135deg, #23262E 0%, #4A505C 100%)',
  'linear-gradient(135deg, #3A3124 0%, #86734F 100%)',
  'linear-gradient(135deg, #17302C 0%, #3E6A62 100%)',
  'linear-gradient(135deg, #2A2233 0%, #5B4B70 100%)',
  'linear-gradient(135deg, #33281F 0%, #735A44 100%)',
  'linear-gradient(135deg, #2E1416 0%, #6E2A2F 100%)',
] as const;

/** Muted color shown behind an image while it loads, or instead of a missing one. */
export function toneBackground(seed: number): string {
  return TONES[Math.abs(seed) % TONES.length]!;
}
