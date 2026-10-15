// Called by the backend publish job: POST { "tags": ["home", "category:real-estate", "article:123"] }
// with header x-revalidate-secret: $REVALIDATE_SECRET.
import { timingSafeEqual } from 'node:crypto';
import { revalidateTag } from 'next/cache';

function secretMatches(given: string | null): boolean {
  // Development falls back to the API's development default, so publishing refreshes the local site.
  const expected = process.env.REVALIDATE_SECRET || (process.env.NODE_ENV === 'development' ? 'local-development-revalidate-secret' : undefined);
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!secretMatches(request.headers.get('x-revalidate-secret'))) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body: unknown = await request.json().catch(() => null);
  const raw = body && typeof body === 'object' && 'tags' in body ? (body as { tags: unknown }).tags : null;
  const tags = Array.isArray(raw) ? raw.filter((t): t is string => typeof t === 'string' && t.length <= 200).slice(0, 200) : [];
  if (tags.length === 0) {
    return Response.json({ error: 'body must be { "tags": string[] }' }, { status: 400 });
  }

  // Gone at once, not served stale while it refreshes: a removed or corrected article must not linger.
  for (const tag of tags) revalidateTag(tag, { expire: 0 });
  return Response.json({ revalidated: tags, at: new Date().toISOString() });
}
