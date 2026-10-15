// The CMS is a client-side app that talks to the API with the staff session
// cookie. Strict headers: never framed, never indexed, scripts only from here.
const apiOrigin = new URL(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1').origin;
const mediaOrigin = new URL(process.env.NEXT_PUBLIC_MEDIA_URL ?? `${apiOrigin}/media`).origin;
const dev = process.env.NODE_ENV === 'development';

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@b4/shared'],
  poweredByHeader: false,
  // `next dev` would otherwise write an AGENTS.md here on every run (the docs it points at stay in node_modules/next/dist/docs).
  agentRules: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'" + (dev ? " 'unsafe-eval'" : ''),
              "style-src 'self' 'unsafe-inline'",
              // Original articles show their source's image (any https host), ours come from the media host.
              `img-src 'self' data: blob: https: ${mediaOrigin} ${apiOrigin}`,
              "font-src 'self'",
              `connect-src 'self' ${apiOrigin}`,
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "object-src 'none'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
