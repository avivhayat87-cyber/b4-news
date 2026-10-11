// The site's sections, in navigation order. Single source of truth for the
// database seed, the API, the site, the app and the CMS.

export type CategoryKind = 'topic' | 'column';

export type CategoryDef = {
  slug: string;
  name: string;
  kind: CategoryKind;
  /** Columns that belong under a topic (e.g. "היועצים" under "שוק ההון"). */
  parent?: string;
};

export const CATEGORIES = [
  { slug: 'israeli-economy', name: 'כלכלה ישראלית', kind: 'topic' },
  { slug: 'global-economy', name: 'כלכלה עולמית', kind: 'topic' },
  { slug: 'capital-market', name: 'שוק ההון', kind: 'topic' },
  { slug: 'real-estate', name: 'נדל״ן', kind: 'topic' },
  { slug: 'insurance', name: 'ביטוח', kind: 'topic' },
  { slug: 'hi-tech', name: 'הייטק', kind: 'topic' },
  { slug: 'health', name: 'בריאות', kind: 'topic' },
  { slug: 'automotive', name: 'רכב', kind: 'topic' },
  { slug: 'entertainment', name: 'בידור', kind: 'topic' },
  { slug: 'consumerism', name: 'צרכנות', kind: 'topic' },
  { slug: 'tourism', name: 'תיירות', kind: 'topic' },
  { slug: 'the-consultants', name: 'היועצים', kind: 'column', parent: 'capital-market' },
  { slug: 'the-new-ceo', name: 'המנכ״ל החדש', kind: 'column' },
] as const satisfies readonly CategoryDef[];

export type CategorySlug = (typeof CATEGORIES)[number]['slug'];

export const CATEGORY_SLUGS = CATEGORIES.map((c) => c.slug) as [CategorySlug, ...CategorySlug[]];

export function findCategory(slug: string): (typeof CATEGORIES)[number] | undefined {
  return CATEGORIES.find((c) => c.slug === slug);
}

/** Homepage zones: exactly 7 main articles, up to 14 trending. */
export const HOMEPAGE_LIMITS = { main: 7, trending: 14 } as const;
