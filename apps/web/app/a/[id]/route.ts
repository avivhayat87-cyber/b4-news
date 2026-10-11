// Short article link used in social posts and push notifications: /a/<id>.
// The mobile app claims this path as a universal link / app link (deep linking);
// in a browser it redirects to the full article URL.
import { resolveArticleId } from '@/lib/api';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const slug = await resolveArticleId(id);
  if (!slug) return new Response('Not found', { status: 404 });

  const target = new URL(`/article/${encodeURIComponent(slug)}`, request.url);
  // Keep UTM parameters from the social post.
  new URL(request.url).searchParams.forEach((value, key) => {
    if (key.startsWith('utm_')) target.searchParams.set(key, value);
  });
  return Response.redirect(target, 308);
}
