// Access tokens for Google Cloud APIs from the server's own identity. On a Google
// Cloud server the metadata server hands them out, so no key is stored anywhere.
const METADATA_TOKEN = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';

/** Returns a current OAuth access token. */
export type TokenSource = () => Promise<string>;

/** Tokens of the server's service account, kept until a minute before they expire. */
export function metadataTokens(fetchFn: typeof fetch = fetch): TokenSource {
  let cached: { token: string; until: number } | null = null;
  return async () => {
    if (cached && Date.now() < cached.until) return cached.token;
    const res = await fetchFn(METADATA_TOKEN, { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (!res?.ok) throw new Error(`this server has no Google Cloud identity (metadata server: ${res ? res.status : 'unreachable'})`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    cached = { token: body.access_token, until: Date.now() + Math.max(0, body.expires_in - 60) * 1000 };
    return cached.token;
  };
}
