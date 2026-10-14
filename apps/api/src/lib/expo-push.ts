// Push notifications to the app through Expo's push service, 100 messages per request.
export type PushMessage = { to: string; title: string; body: string; data?: Record<string, unknown>; channelId?: string; sound?: 'default' };

const ENDPOINT = 'https://exp.host/--/api/v2/push/send';

export async function sendExpoPush(messages: PushMessage[], fetchFn: typeof fetch = fetch): Promise<void> {
  for (let i = 0; i < messages.length; i += 100) {
    const res = await fetchFn(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(messages.slice(i, i + 100)),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`push HTTP ${res.status}`);
  }
}
