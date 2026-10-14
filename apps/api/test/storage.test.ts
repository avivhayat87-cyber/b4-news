// Media in a bucket (Cloudflare R2 through its S3 API) against a stand-in for R2:
// requests are signed, files are written once and cached for good, and only
// keys the server generates are ever sent.
import { describe, expect, it } from 'vitest';
import { BucketStorage } from '../src/lib/storage';

const KEY = '2026/10/0aaecf7b-b787-4f80-92b0-d0d71ee6d21c/feed-6013e7.jpg';
const config = { endpoint: 'https://abc.r2.cloudflarestorage.com', bucket: 'b4-media', accessKeyId: 'AKID', secretAccessKey: 'secret' };

/** A stand-in bucket: stores what is PUT, answers GET and DELETE, records every request. */
function bucket() {
  const files = new Map<string, Buffer>();
  const requests: Request[] = [];
  const fetchFn = (async (input: Request) => {
    requests.push(input);
    const key = new URL(input.url).pathname.replace('/b4-media/', '');
    if (input.method === 'PUT') {
      files.set(key, Buffer.from(await input.arrayBuffer()));
      return new Response(null, { status: 200 });
    }
    if (input.method === 'DELETE') return new Response(null, { status: files.delete(key) ? 204 : 404 });
    const file = files.get(key);
    return file ? new Response(new Uint8Array(file)) : new Response('NoSuchKey', { status: 404 });
  }) as unknown as typeof fetch;
  return { storage: new BucketStorage(config, 'https://media.b4news.co.il', fetchFn), files, requests };
}

describe('media in an R2 bucket', () => {
  it('writes, reads and deletes files with signed requests', async () => {
    const { storage, files, requests } = bucket();
    await storage.put(KEY, Buffer.from('jpeg bytes'), 'image/jpeg');
    expect(files.get(KEY)?.toString()).toBe('jpeg bytes');
    const put = requests[0]!;
    expect(put.url).toBe(`https://abc.r2.cloudflarestorage.com/b4-media/${KEY}`);
    expect(put.headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 Credential=AKID\/\d{8}\/auto\/s3\/aws4_request/);
    expect(put.headers.get('content-type')).toBe('image/jpeg');
    expect(put.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');

    expect((await storage.get(KEY)).toString()).toBe('jpeg bytes');
    await storage.remove([KEY, KEY.replace('feed', 'story')]); // the second one never existed
    expect(files.size).toBe(0);
    await expect(storage.get(KEY)).rejects.toThrow('not found');
  });

  it('links to the public address, and refuses keys the server did not make', async () => {
    const { storage, requests } = bucket();
    expect(storage.url(KEY)).toBe(`https://media.b4news.co.il/${KEY}`);
    await expect(storage.put('../secrets.txt', Buffer.from('x'), 'text/plain')).rejects.toThrow(/invalid media key/);
    await expect(storage.get('2026/10/x/feed.jpg')).rejects.toThrow(/invalid media key/);
    expect(requests).toHaveLength(0);
  });
});
