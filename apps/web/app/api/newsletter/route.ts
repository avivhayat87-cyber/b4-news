// Newsletter sign-up from the site forms. Forwards to the backend (double opt-in);
// in sample-data mode it only validates the address.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const email = body && typeof body === 'object' && 'email' in body ? String((body as { email: unknown }).email).trim() : '';
  if (!EMAIL.test(email) || email.length > 254) {
    return Response.json({ error: 'invalid_email' }, { status: 400 });
  }

  const apiUrl = process.env.API_URL?.replace(/\/+$/, '');
  if (!apiUrl) return Response.json({ ok: true, mock: true });

  const res = await fetch(`${apiUrl}/public/newsletter`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
    cache: 'no-store',
  });
  return Response.json({ ok: res.ok }, { status: res.ok ? 200 : 502 });
}
