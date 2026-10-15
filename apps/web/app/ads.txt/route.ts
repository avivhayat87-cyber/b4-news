// /ads.txt: which ad sellers may sell this site's space (the IAB standard Google AdSense checks).
// While Google ads are on, the one line AdSense asks for, with the publisher id from the CMS
// ("פרסום" > "הגדרות"); otherwise no sellers, and a "not found" as an empty site has. Refreshed with
// the "site" tag when the ad settings change.
import { getSite } from '@/lib/api';

export const revalidate = 600;

/** Google's own certification id: the same in every AdSense ads.txt line. */
const GOOGLE_TAG_ID = 'f08c47fec0942fa0';

export async function GET() {
  const { ads } = await getSite();
  if (!ads?.googleClient) return new Response('# No ad sellers authorized yet.\n', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  const publisher = ads.googleClient.replace(/^ca-/, '');
  return new Response(`google.com, ${publisher}, DIRECT, ${GOOGLE_TAG_ID}\n`, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
